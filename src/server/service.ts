import { createHash, randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { commandSchema, type CommandInput, type JobDTO, type PlayerSnapshot, type PlayerResult, type GMEnvelope, type DeleteResult, type RealityRecord } from '../lib/contracts';
import { getDB, rows, type SqlDB } from './db';
import { ServiceError, safeError } from './errors';
import { callGM, countGMInput, parseEnvelope, validateMeaning, inputUpperBound, MAX_RESERVATION_USD, MAX_INPUT_BYTES, MAX_INPUT_TOKENS, MODEL, MAX_OUTPUT, PROMPT_VERSION, type Receipt, type GameState } from './gm';
import { encryptDiagnostic } from './diagnostics';

interface Game {owner:string;revision:number;privacy_epoch:number;world_sequence:number;started_at:Date|null;active_attempt:string|null;state:GameState;state_sources:string[];}
interface Job {id:string;owner:string;request_key:string;fingerprint:string|null;command:CommandInput|null;kind:CommandInput['kind'];event_id:string|null;status:JobDTO['judgmentStatus'];record_status:JobDTO['recordStatus'];result_id:string|null;error_code:string|null;created_at:Date;}
interface RecordRow {id:string;owner:string;kind:string;version:number;payload:Record<string,unknown>|null;sources:string[];important:boolean;deleted:boolean;created_at:Date;}
interface Attempt {id:string;job_id:string;owner:string;base_revision:number;privacy_epoch:number;lease_until:Date;sources:string[];metadata:Record<string,unknown>;reservation:string;charge_status:string;month:string;budget_keys:string[];}
const EMPTY_STATE:GameState={level:1,totalXp:0,abilities:[],entities:[]};
const pendingStatuses=['waiting','running','failed','interrupted','budget_blocked'];
let gmAdapter: (input:unknown)=>Promise<Receipt> = callGM;
let tokenCounter:(input:unknown)=>Promise<number> = countGMInput;
let backgroundObserver: ((promise:Promise<void>)=>void)|undefined;
export function useGMForTest(adapter:(input:unknown)=>Promise<Receipt>, observer:(promise:Promise<void>)=>void, counter:(input:unknown)=>Promise<number>=async()=>100) {gmAdapter=adapter;backgroundObserver=observer;tokenCounter=counter;}
function ownerCheck(owner:string) { if(!process.env.OWNER_CLERK_USER_ID || owner!==process.env.OWNER_CLERK_USER_ID) throw new ServiceError('OWNER_REQUIRED',403); }
function json(value:unknown) {return JSON.stringify(value);}
async function gameLock(tx:SqlDB,owner:string) {
  await rows(tx,'INSERT INTO games(owner) VALUES($1) ON CONFLICT DO NOTHING',[owner]);
  return (await rows<Game>(tx,'SELECT * FROM games WHERE owner=$1 FOR UPDATE',[owner]))[0];
}
async function maintenance(tx:SqlDB,g:Game) {
  // Expiry affects access immediately; this opportunistic cleanup is not a 24-hour physical deletion promise.
  await rows(tx,'UPDATE attempts SET diagnostic=NULL, diagnostic_expires=NULL WHERE owner=$1 AND diagnostic_expires<=now()',[g.owner]);
  if(!g.active_attempt) return;
  const a=(await rows<Attempt>(tx,'SELECT * FROM attempts WHERE id=$1',[g.active_attempt]))[0];
  if(a && new Date(a.lease_until).getTime()<=Date.now()) {
    await rows(tx,"UPDATE jobs SET status='interrupted',error_code='EXECUTION_LEASE_EXPIRED' WHERE id=$1 AND status='running'",[a.job_id]);
    await rows(tx,"UPDATE attempts SET charge_status=CASE WHEN charge_status='reserved' THEN 'unknown' ELSE charge_status END WHERE id=$1",[a.id]);
    await rows(tx,'UPDATE games SET active_attempt=NULL WHERE owner=$1',[g.owner]);
    g.active_attempt=null;
  }
}
function jobDTO(job:Job,g:Game,all:Job[],results:Map<string,PlayerResult>):JobDTO {
  const unresolved=all.filter(j=>pendingStatuses.includes(j.status));
  const preceding=unresolved.find(j=>j.id!==job.id && (new Date(j.created_at).getTime()<new Date(job.created_at).getTime() || (new Date(j.created_at).getTime()===new Date(job.created_at).getTime() && j.id<job.id)));
  const result=job.result_id ? results.get(job.result_id) ?? null : null;
  const nextAction:JobDTO['nextAction']=job.status==='running' ? 'poll' : job.status==='waiting' ? (preceding?'poll':'continue') : ['failed','interrupted','budget_blocked'].includes(job.status) ? 'retry' : result?.question ? 'answer' : 'none';
  return {requestId:job.id,jobId:job.id,eventId:job.event_id,recordStatus:job.record_status,judgmentStatus:job.status,resultId:job.result_id,revision:g.revision,playerResult:result,nextAction,predecessorJobId:preceding?.id ?? null,unprocessedCount:unresolved.length,errorCode:job.error_code};
}
async function snapshotInTransaction(tx:SqlDB,g:Game):Promise<PlayerSnapshot> {
  const all=await rows<Job>(tx,'SELECT * FROM jobs WHERE owner=$1 ORDER BY created_at,id',[g.owner]);
  const data=await rows<RecordRow>(tx,"SELECT * FROM records WHERE owner=$1 AND deleted=false AND kind IN ('result','event','quest') ORDER BY created_at DESC,id",[g.owner]);
  const results=data.filter(r=>r.kind==='result').map(r=>r.payload as unknown as PlayerResult);
  const resultMap=new Map(results.map(r=>[r.id,r]));
  // Always reconstruct an allowlist DTO; never spread GM entities, including _meta or secret fields.
  const entities=g.state.entities.filter(e=>e.visibility==='public').map(e=>({id:e.id,kind:e.kind,name:e.name,summary:e.summary,detail:e.detail,truth:e.truth,relatedIds:e.relatedIds.filter(id=>g.state.entities.some(other=>other.id===id && other.visibility==='public')),quantity:e.quantity,status:e.status,attributes:e.attributes,realTaskId:e.realTaskId}));
  const events:RealityRecord[]=data.filter(r=>r.kind!=='result' && r.payload).map(r=>({id:r.id,kind:r.kind,version:r.version,text:String(r.payload!.text ?? ''),occurredAt:typeof r.payload!.occurredAt==='string'?r.payload!.occurredAt:null,uncertainty:typeof r.payload!.uncertainty==='string'?r.payload!.uncertainty:null,consent:(r.payload!.consent ?? null) as CommandInput['consent'],recordStatus:all.findLast(j=>j.event_id===r.id)?.record_status ?? 'pending'}));
  return {revision:g.revision,worldSequence:g.world_sequence,startedAt:g.started_at ? new Date(g.started_at).toISOString():null,level:g.state.level,totalXp:g.state.totalXp,character:entities.find(e=>e.kind==='character') ?? null,abilities:g.state.abilities.map(({id,name,value,meaning,changeReason})=>({id,name,value,meaning,changeReason})),entities,results,jobs:all.map(j=>jobDTO(j,g,all,resultMap)),events,unprocessedCount:all.filter(j=>pendingStatuses.includes(j.status)).length};
}
export async function readPlayer(owner:string):Promise<PlayerSnapshot> {
  ownerCheck(owner);
  return getDB().transaction(async tx=> { const g=await gameLock(tx,owner);await maintenance(tx,g);return snapshotInTransaction(tx,g); });
}
async function readJob(owner:string,id:string):Promise<JobDTO> {
  const result=(await readPlayer(owner)).jobs.find(j=>j.jobId===id);
  if(!result) throw new ServiceError('JOB_NOT_FOUND',404);
  return result;
}
async function addRecord(tx:SqlDB,owner:string,kind:string,payload:unknown,sources:string[],important=false,id=randomUUID()) {
  await rows(tx,'INSERT INTO records(id,owner,kind,payload,sources,important) VALUES($1,$2,$3,$4::jsonb,$5::text[],$6)',[id,owner,kind,json(payload),sources,important]);
  return id;
}
export async function submitCommand(owner:string,input:CommandInput):Promise<JobDTO> {
  ownerCheck(owner);
  const command=commandSchema.parse(input), fingerprint=createHash('sha256').update(json(command)).digest('hex');
  let created=false;
  const jobId=await getDB().transaction(async tx=>{
    const g=await gameLock(tx,owner);await maintenance(tx,g);
    const existing=(await rows<Job>(tx,'SELECT * FROM jobs WHERE owner=$1 AND request_key=$2',[owner,command.requestKey]))[0];
    if(existing) {
      if(existing.status==='deleted'||existing.record_status==='declined') return existing.id;
      if(existing.fingerprint!==fingerprint) throw new ServiceError('REQUEST_KEY_CONFLICT');
      return existing.id;
    }
    if(command.expectedRevision!==g.revision) throw new ServiceError('REVISION_CONFLICT');
    if(command.kind==='start' && (g.started_at || (await rows<Job>(tx,"SELECT id FROM jobs WHERE owner=$1 AND kind='start' AND status<>'deleted'",[owner])).length)) throw new ServiceError('ALREADY_STARTED');
    if(command.kind!=='start' && !g.started_at) throw new ServiceError('START_REQUIRED');
    if(command.kind==='quest' && !command.consent) throw new ServiceError('QUEST_CONSENT_REQUIRED',422);
    if(command.kind==='experience' && command.targetId) throw new ServiceError('USE_CORRECT_FOR_EXISTING_EVENT',422);
    if(command.kind==='experience' && !command.targetId) {
      const candidates=await rows<RecordRow>(tx,"SELECT * FROM records WHERE owner=$1 AND kind='event' AND deleted=false AND payload->>'text'=$2 AND (payload->>'occurredAt') IS NOT DISTINCT FROM $3",[owner,command.text,command.occurredAt]);
      if(candidates.length) throw new ServiceError('POSSIBLE_DUPLICATE_REVIEW_EVENTS',409);
    }
    let target:RecordRow|undefined, declinedTarget=false;
    if(command.targetId) {
      target=(await rows<RecordRow>(tx,'SELECT * FROM records WHERE owner=$1 AND id=$2',[owner,command.targetId]))[0];
      if(target?.deleted) {
        const declined=command.kind==='force_record' && (await rows<Job>(tx,"SELECT id FROM jobs WHERE owner=$1 AND event_id=$2 AND record_status='declined'",[owner,target.id])).length;
        if(!declined) throw new ServiceError('TARGET_DELETED',410);
        // The user supplies a new explicit fact; never recover the declined old body.
        target=undefined;declinedTarget=true;
      }
      if(!target && !declinedTarget) throw new ServiceError('TARGET_NOT_FOUND',404);
      if(target && !['event','quest','result'].includes(target.kind)) throw new ServiceError('TARGET_NOT_PUBLIC',404);
      if(['start','quest'].includes(command.kind)) throw new ServiceError('TARGET_NOT_ALLOWED',422);
      if(['answer','appeal'].includes(command.kind)&&target?.kind!=='result') throw new ServiceError('RESULT_TARGET_REQUIRED',422);
      if(command.kind==='answer'&&!target?.payload?.question) throw new ServiceError('QUESTION_TARGET_REQUIRED',422);
    }
    if(['correct','quest_update','answer','appeal'].includes(command.kind) && !target) throw new ServiceError('TARGET_REQUIRED',422);
    if(command.kind==='quest_update' && target?.kind!=='quest') throw new ServiceError('QUEST_TARGET_REQUIRED',422);
    if(command.kind==='correct' && target && !['event','quest'].includes(target.kind)) throw new ServiceError('REALITY_TARGET_REQUIRED',422);
    // Facts change immediately; all dependent text is conservatively purged before any new GM call.
    if(command.kind==='correct' && target) await redactDerived(tx,g,target.id,false);
    const id=randomUUID();
    const eventKind=command.kind==='quest'||command.kind==='quest_update' ? 'quest' : 'event';
    const recordStatus=command.kind==='force_record'||command.kind==='correct'||eventKind==='quest' ? 'recorded':'pending';
    let eventId:string;
    if(command.kind==='correct' && target) {
      eventId=target.id;
      await rows(tx,'UPDATE records SET payload=$1::jsonb,version=version+1,deleted=false,sources=$2::text[] WHERE id=$3',[json({...command,previousVersion:target.version}),[],eventId]);
    } else eventId=await addRecord(tx,owner,eventKind,command,target?[target.id,...target.sources]:declinedTarget&&command.targetId?[command.targetId]:[]);
    await rows(tx,"INSERT INTO jobs(id,owner,request_key,fingerprint,command,kind,event_id,status,record_status) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,'waiting',$8)",[id,owner,command.requestKey,fingerprint,json(command),command.kind,eventId,recordStatus]);
    created=true;
    return id;
  });
  // Idempotent retransmission returns the stored state and never creates another paid attempt.
  const current=await readJob(owner,jobId);
  if(!created||current.judgmentStatus!=='waiting') return current;
  return startJob(owner,jobId,false);
}

interface Claimed {attempt:Attempt;job:Job;game:Game;input:unknown;}
async function claim(owner:string,jobId:string,retry:boolean):Promise<Claimed|null> {
  return getDB().transaction(async tx=>{
    const g=await gameLock(tx,owner);await maintenance(tx,g);
    const j=(await rows<Job>(tx,'SELECT * FROM jobs WHERE id=$1 AND owner=$2',[jobId,owner]))[0];
    if(!j) throw new ServiceError('JOB_NOT_FOUND',404);
    if(j.status==='committed'||j.status==='deleted'||j.status==='running'||g.active_attempt) return null;
    if(j.status!=='waiting' && !retry) return null;
    const first=(await rows<Job>(tx,"SELECT * FROM jobs WHERE owner=$1 AND status IN ('waiting','failed','interrupted','budget_blocked') ORDER BY created_at,id LIMIT 1",[owner]))[0];
    if(first?.id!==j.id) return null;
    if(!j.command || !j.event_id) throw new ServiceError('INPUT_REMOVED',410);
    // Always include identity and important unresolved setting; retrieve older related facts and recent scenes.
    const required=await rows<RecordRow>(tx,`SELECT r.* FROM records r WHERE owner=$1 AND deleted=false AND payload IS NOT NULL AND
      (important=true OR kind IN ('identity','philosophy')) AND NOT EXISTS(SELECT 1 FROM records n WHERE n.owner=r.owner AND n.deleted=false AND n.payload->>'previousId'=r.id)
      ORDER BY created_at,id`,[owner]);
    const selected=await rows<RecordRow>(tx,`SELECT * FROM records WHERE owner=$1 AND deleted=false AND payload IS NOT NULL AND
      (id=$2 OR id=$3 OR sources @> ARRAY[$3]::text[] OR payload::text ILIKE $4 OR kind='result')
      ORDER BY created_at DESC,id LIMIT 40`,[owner,j.event_id,j.command.targetId ?? '',`%${j.command.text.slice(0,32).replace(/[%_\\]/g,'')}%`]);
    const anchors=await rows<RecordRow>(tx,'SELECT * FROM records WHERE owner=$1 AND id IN ($2,$3) AND deleted=false',[owner,j.event_id,j.command.targetId ?? '']);
    const context=[...new Map([...required,...selected,...anchors].map(r=>[r.id,r])).values()];
    const input={contractVersion:'liferpg.1',promptVersion:PROMPT_VERSION,today:new Date().toISOString().slice(0,10),startedAt:g.started_at,state:g.state,command:j.command,eventId:j.event_id,records:context.map(r=>({id:r.id,version:r.version,kind:r.kind,content:r.payload}))};
    if(inputUpperBound(input)>MAX_INPUT_BYTES) {
      await rows(tx,"UPDATE jobs SET status='failed',error_code='GM_INPUT_LIMIT' WHERE id=$1",[j.id]);return null;
    }
    if(process.env.GM_PAID_CALLS_ENABLED!=='true' || !process.env.OPENAI_API_KEY || !process.env.DIAGNOSTIC_ENCRYPTION_KEY || Buffer.from(process.env.DIAGNOSTIC_ENCRYPTION_KEY,'base64').length!==32) {
      await rows(tx,"UPDATE jobs SET status='budget_blocked',error_code='PAID_CALLS_NOT_AUTHORIZED_OR_CONFIGURED' WHERE id=$1",[j.id]);return null;
    }
    const month=new Date().toISOString().slice(0,7);
    const experiment=process.env.GM_BUDGET_SCOPE==='experiment';
    if(experiment && !process.env.EXPERIMENT_AUTHORIZATION) throw new ServiceError('EXPERIMENT_NOT_AUTHORIZED',403);
    const budgetKeys=experiment?['experiment:lifetime',month]:[month];
    const configured=Number(process.env.GM_MONTHLY_LIMIT_USD ?? 15), limit=Number.isFinite(configured)?Math.min(configured,15):0;
    for(const budgetKey of budgetKeys) {
      await rows(tx,'INSERT INTO budgets(month) VALUES($1) ON CONFLICT DO NOTHING',[budgetKey]);
      const budget=(await rows<{reserved:string;spent:string}>(tx,'SELECT * FROM budgets WHERE month=$1 FOR UPDATE',[budgetKey]))[0];
      if(Number(budget.reserved)+Number(budget.spent)+MAX_RESERVATION_USD>(budgetKey==='experiment:lifetime'?3:limit)) {
        await rows(tx,"UPDATE jobs SET status='budget_blocked',error_code='BUDGET_EXCEEDED' WHERE id=$1",[j.id]);return null;
      }
    }
    const sources=[...new Set([j.event_id,...g.state_sources,...context.flatMap(r=>[r.id,...r.sources])])];
    const id=randomUUID(), metadata={requestedModel:MODEL,reasoning:'medium',contractVersion:'liferpg.1',promptVersion:PROMPT_VERSION,deployment:process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',startedAt:new Date().toISOString(),maxOutputTokens:MAX_OUTPUT,inputBytesUpperBound:inputUpperBound(input),experimentAuthorization:experiment?process.env.EXPERIMENT_AUTHORIZATION:null,inputProvenance:context.map(r=>({id:r.id,version:r.version})),stateRevision:g.revision};
    for(const budgetKey of budgetKeys) await rows(tx,'UPDATE budgets SET reserved=reserved+$1 WHERE month=$2',[MAX_RESERVATION_USD,budgetKey]);
    const a=(await rows<Attempt>(tx,"INSERT INTO attempts(id,job_id,owner,base_revision,privacy_epoch,lease_until,sources,metadata,reservation,charge_status,month,budget_keys) VALUES($1,$2,$3,$4,$5,now()+interval '240 seconds',$6::text[],$7::jsonb,$8,'reserved',$9,$10::text[]) RETURNING *",[id,j.id,owner,g.revision,g.privacy_epoch,sources,json(metadata),MAX_RESERVATION_USD,month,budgetKeys]))[0];
    await rows(tx,"UPDATE jobs SET status='running',error_code=NULL WHERE id=$1",[j.id]);
    await rows(tx,'UPDATE games SET active_attempt=$1 WHERE owner=$2',[id,owner]);
    return {attempt:a,job:j,game:g,input};
  });
}
function stillValid(g:Game,a:Attempt) {return g.active_attempt===a.id && g.revision===a.base_revision && g.privacy_epoch===a.privacy_epoch && new Date(a.lease_until).getTime()>Date.now();}
async function settle(tx:SqlDB,a:Attempt,receipt:Receipt) {
  if(a.charge_status==='settled') return;
  if(receipt.usage && receipt.metadata.serviceTier==='default') {
    // Charge all input at the conservative uncached+write rate; no unverified cache discount.
    const cost=Math.ceil((receipt.usage.input*4.5+receipt.usage.output*10))/1000000;
    for(const budgetKey of a.budget_keys) await rows(tx,'UPDATE budgets SET reserved=GREATEST(0,reserved-$1),spent=spent+$2 WHERE month=$3',[Number(a.reservation),cost,budgetKey]);
    await rows(tx,"UPDATE attempts SET charge_status='settled' WHERE id=$1",[a.id]);
  } else await rows(tx,"UPDATE attempts SET charge_status='unknown' WHERE id=$1",[a.id]);
}
async function captureReceipt(claimed:Claimed,receipt:Receipt):Promise<boolean> {
  return getDB().transaction(async tx=>{
    const g=await gameLock(tx,claimed.game.owner);
    const a=(await rows<Attempt>(tx,'SELECT * FROM attempts WHERE id=$1 FOR UPDATE',[claimed.attempt.id]))[0];
    // Numeric usage may settle after deletion; content/diagnostic metadata must never be recreated.
    await settle(tx,a,receipt);
    if(!stillValid(g,a)) return false;
    await rows(tx,'UPDATE attempts SET metadata=metadata || $1::jsonb WHERE id=$2',[json(receipt.metadata),a.id]);
    return true;
  });
}
async function commitEnvelope(c:Claimed,next:GMEnvelope) {
  await getDB().transaction(async tx=>{
    const g=await gameLock(tx,c.game.owner), a=(await rows<Attempt>(tx,'SELECT * FROM attempts WHERE id=$1',[c.attempt.id]))[0];
    if(!stillValid(g,a)) throw new ServiceError('STALE_ATTEMPT');
    const job=(await rows<Job>(tx,'SELECT * FROM jobs WHERE id=$1',[a.job_id]))[0];
    if(job.status!=='running') throw new ServiceError('ALREADY_APPLIED');
    validateMeaning(next,g.state,job.command!);
    const linkedQuests=next.entities.filter(e=>e.kind==='quest'&&e.realTaskId);
    for(const quest of linkedQuests) {
      const task=(await rows<RecordRow>(tx,"SELECT * FROM records WHERE owner=$1 AND id=$2 AND kind='quest' AND deleted=false",[g.owner,quest.realTaskId]))[0];
      if(!task?.payload?.consent) throw new ServiceError('QUEST_CONSENT_REQUIRED',422);
      if(!['proposed','active','paused','completed','failed','cancelled'].includes(quest.status ?? '')) throw new ServiceError('REAL_QUEST_STATUS_INVALID',422);
      const previous=g.state.entities.find(e=>e.id===quest.id);
      if(quest.status==='completed'&&previous?.status!=='completed'&&!next.questCompletions.some(c=>c.questId===quest.realTaskId)) throw new ServiceError('QUEST_COMPLETION_NEEDS_REAL_EVIDENCE',422);
    }
    for(const previous of g.state.entities.filter(e=>e.kind==='quest'&&e.realTaskId)) {
      const current=next.entities.find(e=>e.id===previous.id);
      if(current && current.realTaskId!==previous.realTaskId) throw new ServiceError('REAL_QUEST_LINK_IMMUTABLE',422);
    }
    if(['quest','quest_update'].includes(job.kind)&&!linkedQuests.some(q=>q.realTaskId===job.event_id || q.realTaskId===job.command?.targetId)) throw new ServiceError('REAL_QUEST_LINK_REQUIRED',422);
    if(!next.recordAccepted && !['force_record','correct','quest','quest_update'].includes(job.kind) && job.event_id) {
      // A rejected temporary fact must not survive in memory, scenes, diagnostics or mixed state.
      await redactDerived(tx,g,job.event_id,true);
      const resultId=randomUUID();
      const result:PlayerResult={id:resultId,title:'접수한 경험을 검토했습니다',scene:'이 경험은 현실 기록으로 보존하지 않았습니다. 원하면 명시적으로 기록을 요구할 수 있습니다.',changes:[],question:null,createdAt:new Date().toISOString(),revision:g.revision};
      await addRecord(tx,g.owner,'result',result,[],false,resultId);
      await rows(tx,"UPDATE jobs SET status='committed',record_status='declined',result_id=$1 WHERE id=$2",[resultId,job.id]);
      return;
    }
    for(const completion of next.questCompletions) {
      const facts=await rows<RecordRow>(tx,'SELECT * FROM records WHERE owner=$1 AND id IN ($2,$3) AND deleted=false',[g.owner,completion.questId,completion.evidenceEventId]);
      const quest=facts.find(r=>r.id===completion.questId), evidence=facts.find(r=>r.id===completion.evidenceEventId);
      if(quest?.kind!=='quest'||!quest.payload?.consent||!evidence||evidence.kind!=='event'||!['experience','force_record','correct','answer'].includes(String(evidence.payload?.kind))) throw new ServiceError('QUEST_COMPLETION_NEEDS_REAL_EVIDENCE',422);
      if(!linkedQuests.some(q=>q.realTaskId===completion.questId&&q.status==='completed')) throw new ServiceError('QUEST_COMPLETION_LINK_REQUIRED',422);
      const prior=await rows<RecordRow>(tx,"SELECT * FROM records WHERE owner=$1 AND kind='quest_completion' AND deleted=false AND payload->>'questId'=$2",[g.owner,completion.questId]);
      const recurrence=(quest.payload!.consent as CommandInput['consent'])?.recurrence;
      if(prior.some(r=>r.payload?.evidenceEventId===completion.evidenceEventId)|| (prior.length && !recurrence)) throw new ServiceError('QUEST_ALREADY_COMPLETED',422);
      await addRecord(tx,g.owner,'quest_completion',completion,a.sources);
    }
    const revision=g.revision+1, resultId=randomUUID();
    const result:PlayerResult={id:resultId,title:next.title,scene:next.scene,changes:next.changes,question:next.question,createdAt:new Date().toISOString(),revision};
    await addRecord(tx,g.owner,'result',result,a.sources,false,resultId);
    await addRecord(tx,g.owner,'rationale',{content:next.rationale,jobId:job.id},a.sources);
    for(const memory of next.memories) {
      if(memory.previousId && !(await rows<RecordRow>(tx,'SELECT id FROM records WHERE id=$1 AND owner=$2 AND deleted=false',[memory.previousId,g.owner])).length) throw new ServiceError('MEMORY_PREDECESSOR_MISSING',422);
      await addRecord(tx,g.owner,memory.kind,memory,a.sources,memory.important||['identity','philosophy','foreshadowing'].includes(memory.kind));
    }
    const state:GameState=next.decision==='apply'?{level:next.level,totalXp:next.totalXp,abilities:next.abilities,entities:next.entities}:g.state;
    await addRecord(tx,g.owner,'state_change',{revision,jobId:job.id,before:g.state,after:state},a.sources);
    await rows(tx,'UPDATE games SET state=$1::jsonb,state_sources=$2::text[],revision=$3,world_sequence=world_sequence+1,active_attempt=NULL,started_at=CASE WHEN $4 THEN COALESCE(started_at,CURRENT_DATE) ELSE started_at END WHERE owner=$5',[json(state),[...new Set([...g.state_sources,...a.sources])],revision,job.kind==='start',g.owner]);
    const forced=['force_record','correct','quest','quest_update'].includes(job.kind);
    const recorded=forced||next.recordAccepted;
    await rows(tx,"UPDATE jobs SET status='committed',record_status=$1,result_id=$2,command=NULL WHERE id=$3",[recorded?'recorded':'declined',resultId,job.id]);
    await rows(tx,'UPDATE attempts SET metadata=metadata || $1::jsonb WHERE id=$2',[json({validatedAt:new Date().toISOString(),committedAt:new Date().toISOString()}),a.id]);
  });
}
async function failAttempt(c:Claimed,receipt:Receipt|null,error:unknown) {
  try {
    await getDB().transaction(async tx=>{
      const g=await gameLock(tx,c.game.owner), a=(await rows<Attempt>(tx,'SELECT * FROM attempts WHERE id=$1',[c.attempt.id]))[0];
      if(!stillValid(g,a)) return;
      let diagnostic=null;
      if(receipt?.raw) {try {diagnostic=encryptDiagnostic(receipt.raw);} catch { /* preserve structural evidence even if key configuration is broken */ }}
      await rows(tx,"UPDATE attempts SET diagnostic=$1::jsonb,diagnostic_expires=CASE WHEN $1::jsonb IS NULL THEN NULL ELSE now()+interval '24 hours' END,metadata=metadata || $2::jsonb,charge_status=CASE WHEN charge_status='reserved' THEN 'unknown' ELSE charge_status END WHERE id=$3",[diagnostic?json(diagnostic):null,json({errorCode:safeError(error),failedAt:new Date().toISOString(),validation:receipt?.metadata.validation ?? null,bodyCaptured:!!diagnostic}),a.id]);
      await rows(tx,"UPDATE jobs SET status='failed',error_code=$1 WHERE id=$2",[safeError(error),c.job.id]);
      await rows(tx,'UPDATE games SET active_attempt=NULL WHERE owner=$1',[g.owner]);
    });
  } catch { console.error(json({requestId:c.job.id,attemptId:c.attempt.id,providerRequestId:receipt?.metadata.requestId ?? null,requestedModel:MODEL,contractVersion:'liferpg.1',promptVersion:PROMPT_VERSION,deployment:process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',usage:receipt?.usage ?? null,code:'FAILURE_PERSISTENCE_UNAVAILABLE'})); }
}
async function execute(c:Claimed):Promise<void> {
  let receipt:Receipt|null=null;
  try {
    let tokenCount:number|null=null, countError:string|null=null;
    try {tokenCount=await tokenCounter(c.input);if(!Number.isSafeInteger(tokenCount)||tokenCount<0)countError='TOKEN_COUNT_INVALID';else if(tokenCount>MAX_INPUT_TOKENS)countError='GM_INPUT_TOKEN_LIMIT';} catch {countError='TOKEN_COUNT_FAILED';}
    const ready=await getDB().transaction(async tx=>{
      const g=await gameLock(tx,c.game.owner),a=(await rows<Attempt>(tx,'SELECT * FROM attempts WHERE id=$1 FOR UPDATE',[c.attempt.id]))[0];
      const valid=stillValid(g,a);
      if(countError||!valid) {
        if(a.charge_status==='reserved'||a.charge_status==='unknown') {
          for(const budgetKey of a.budget_keys) await rows(tx,'UPDATE budgets SET reserved=GREATEST(0,reserved-$1) WHERE month=$2',[Number(a.reservation),budgetKey]);
          await rows(tx,"UPDATE attempts SET charge_status='not_called' WHERE id=$1",[a.id]);
        }
        if(valid) {
          await rows(tx,"UPDATE jobs SET status='failed',error_code=$1 WHERE id=$2",[countError,c.job.id]);
          await rows(tx,'UPDATE games SET active_attempt=NULL WHERE owner=$1',[g.owner]);
          await rows(tx,'UPDATE attempts SET metadata=metadata || $1::jsonb WHERE id=$2',[json({inputTokens:tokenCount,modelCalled:false,errorCode:countError}),a.id]);
        }
        return false;
      }
      await rows(tx,'UPDATE attempts SET metadata=metadata || $1::jsonb WHERE id=$2',[json({inputTokens:tokenCount,modelCalled:true,modelStartedAt:new Date().toISOString()}),a.id]);
      return true;
    });
    if(!ready)return;
    receipt=await gmAdapter(c.input);
    if(!await captureReceipt(c,receipt)) return;
    const next=parseEnvelope(receipt);
    validateMeaning(next,c.game.state,c.job.command!);
    await commitEnvelope(c,next);
  } catch(error) { await failAttempt(c,receipt,error); }
}
async function startJob(owner:string,jobId:string,retry:boolean):Promise<JobDTO> {
  const c=await claim(owner,jobId,retry);
  if(!c) return readJob(owner,jobId);
  const promise=execute(c);
  // Exactly the same promise is observed; after() must not invoke execute() again.
  if(backgroundObserver) backgroundObserver(promise); else after(()=>promise);
  let timer:ReturnType<typeof setTimeout>|undefined;
  await Promise.race([promise,new Promise<void>(resolve=>{timer=setTimeout(resolve,8000);})]);
  if(timer) clearTimeout(timer);
  return readJob(owner,jobId);
}
export async function continueJob(owner:string,jobId:string):Promise<JobDTO> {ownerCheck(owner);return startJob(owner,jobId,true);}

async function redactDerived(tx:SqlDB,g:Game,eventId:string,deleteRoot:boolean):Promise<string[]> {
  const affected=await rows<{id:string}>(tx,'SELECT id FROM records WHERE owner=$1 AND (id=$2 OR $2=ANY(sources))',[g.owner,eventId]);
  const ids=affected.map(r=>r.id);
  await rows(tx,'UPDATE records SET payload=NULL,sources=ARRAY[]::text[],deleted=true WHERE owner=$1 AND ($2=ANY(sources) OR (id=$2 AND $3))',[g.owner,eventId,deleteRoot]);
  // Revoke ALL active work on epoch change, even if a source relationship was uncertain.
  await rows(tx,"UPDATE jobs SET status='interrupted',error_code='PRIVACY_EPOCH_CHANGED' WHERE owner=$1 AND status='running'",[g.owner]);
  await rows(tx,"UPDATE jobs SET command=NULL,fingerprint=NULL,status='deleted',record_status='deleted',result_id=NULL,error_code=NULL WHERE owner=$1 AND (event_id=$2 OR result_id=ANY($3::text[]) OR command->>'targetId'=ANY($3::text[]))",[g.owner,eventId,ids]);
  await rows(tx,"UPDATE attempts SET diagnostic=NULL,diagnostic_expires=NULL,metadata='{}'::jsonb,sources=ARRAY[]::text[],charge_status=CASE WHEN charge_status='reserved' THEN 'unknown' ELSE charge_status END WHERE owner=$1 AND ($2=ANY(sources) OR id=$3)",[g.owner,eventId,g.active_attempt]);
  // Current state is a mixed summary: discard text wholesale if this fact reached it. Preserve only numerical growth.
  const state=g.state_sources.includes(eventId)?{...EMPTY_STATE,level:g.state.level,totalXp:g.state.totalXp}:g.state;
  const retainedSources=g.state_sources.includes(eventId)?[]:g.state_sources;
  g.revision++;g.privacy_epoch++;g.active_attempt=null;g.state=state;g.state_sources=retainedSources;
  await rows(tx,'UPDATE games SET revision=$1,privacy_epoch=$2,active_attempt=NULL,state=$3::jsonb,state_sources=$5::text[] WHERE owner=$4',[g.revision,g.privacy_epoch,json(state),g.owner,retainedSources]);
  return ids;
}
export async function deleteEvent(owner:string,eventId:string):Promise<DeleteResult> {
  ownerCheck(owner);
  return getDB().transaction(async tx=>{
    const g=await gameLock(tx,owner), record=(await rows<RecordRow>(tx,'SELECT * FROM records WHERE owner=$1 AND id=$2',[owner,eventId]))[0];
    if(!record || !['event','quest'].includes(record.kind)) throw new ServiceError('EVENT_NOT_FOUND',404);
    const ids=await redactDerived(tx,g,eventId,true);
    return {deletionId:randomUUID(),recordStatus:'deleted',cleanupStatus:'complete',invalidatedIds:ids,revision:g.revision,externalRetention:'LifeRPG 서버의 현실 정보와 파생 연결을 제거했습니다. ChatGPT 대화·메모리, 공급자 보안 보존과 DB 복구 이력은 별도 보존 범위입니다.'};
  });
}
