import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { getDB,useDatabaseForTest,closeDatabase,rows,type SqlDB } from '../src/server/db';
import { submitCommand as submitRaw,readPlayer,continueJob as continueRaw,deleteEvent,useGMForTest } from '../src/server/service';
import { inspectReceipt,type Receipt } from '../src/server/gm';
import type { GMEnvelope,CommandInput } from '../src/lib/contracts';

config({path:'.env.local',quiet:true});
const schema=`test_${randomUUID().replaceAll('-','')}`;
let realDB:SqlDB, testDB:SqlDB;
const owner=`synthetic_${randomUUID()}`;
let calls=0;
let gate:Promise<void>|null=null;
const observed:Promise<void>[]=[];
const observe=(promise:Promise<void>)=>{observed.push(promise);};
async function submitCommand(...args:Parameters<typeof submitRaw>) {const result=await submitRaw(...args);if(result.judgmentStatus==='running'&&!gate){await Promise.all(observed);return (await readPlayer(args[0])).jobs.find(j=>j.jobId===result.jobId)!;}return result;}
async function continueJob(...args:Parameters<typeof continueRaw>) {const result=await continueRaw(...args);if(result.judgmentStatus==='running'&&!gate){await Promise.all(observed);return (await readPlayer(args[0])).jobs.find(j=>j.jobId===result.jobId)!;}return result;}
const envelope:GMEnvelope={contractVersion:'liferpg.1',decision:'apply',recordAccepted:true,question:null,title:'합성 수신 검증',scene:'합성 장면',changes:['합성 변화'],level:1,totalXp:0,alive:true,abilities:[],entities:[{id:'hero',kind:'character',name:'합성 여행자',summary:'합성 탄생',detail:'합성 본문',visibility:'public',truth:'canon',relatedIds:[],quantity:null,status:null,attributes:[],realTaskId:null}],questCompletions:[],rationale:'GM_SECRET_SYNTHETIC',memories:[{id:'identity',kind:'identity',content:'GM_SECRET_SYNTHETIC',reason:'합성 기억',previousId:null,important:true,relatedIds:[]}]};
let nextEnvelope=envelope,broken=false,usageKnown=true;
const syntheticAdapter=async()=>{calls++;if(gate)await gate;return receipt();};
function receipt():Receipt {return inspectReceipt(JSON.stringify({id:'resp_synthetic',status:'completed',model:'synthetic-injection',service_tier:'default',usage:usageKnown?{input_tokens:100,output_tokens:50}:null,output:[{type:'message',content:[{type:'output_text',text:broken?'{broken':JSON.stringify(nextEnvelope)}]}]}),'req_synthetic',200);}
const cmd=(kind:CommandInput['kind'],revision:number,extra:Partial<CommandInput>={}):CommandInput=>({kind,text:`SYNTHETIC_FACT_${randomUUID()}`,requestKey:randomUUID(),expectedRevision:revision,occurredAt:null,uncertainty:null,targetId:null,consent:null,...extra});
before(async()=>{
  realDB=getDB();await realDB.execute(sql.raw(`CREATE SCHEMA ${schema}`));
  testDB={execute:async()=>{throw new Error('Test queries need a transaction');},transaction:async fn=>realDB.transaction(async tx=>{await tx.execute(sql.raw(`SET LOCAL search_path TO ${schema}`));return fn(tx);})};
  useDatabaseForTest(testDB);
  const migration=await readFile(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8');
  await testDB.transaction(async tx=>{for(const command of migration.split(';').filter(s=>s.trim())) await rows(tx,command);});
  process.env.OWNER_CLERK_USER_ID=owner;process.env.GM_PAID_CALLS_ENABLED='true';process.env.OPENAI_API_KEY='synthetic-not-a-network-call';process.env.DIAGNOSTIC_ENCRYPTION_KEY=Buffer.alloc(32,1).toString('base64');process.env.GM_BUDGET_SCOPE='synthetic';
  useGMForTest(syntheticAdapter,observe);
});
after(async()=>{useDatabaseForTest(realDB);await realDB.execute(sql.raw(`DROP SCHEMA ${schema} CASCADE`));await closeDatabase();});
test('Neon DB boundary: receipt, atomic commit, read, idempotency and privacy projection',async()=>{
  const command=cmd('start',0), result=await submitCommand(owner,command);
  assert.equal(result.judgmentStatus,'committed');assert.equal(result.recordStatus,'recorded');
  const snapshot=await readPlayer(owner);assert.equal(snapshot.revision,1);assert.equal(snapshot.level,1);assert.equal(snapshot.totalXp,0);assert.ok(!JSON.stringify(snapshot).includes('GM_SECRET_SYNTHETIC'));
  assert.equal((await submitCommand(owner,command)).jobId,result.jobId);assert.equal(calls,1);
  await assert.rejects(()=>submitCommand(owner,{...command,text:'DIFFERENT'}),/REQUEST_KEY_CONFLICT/);
  await assert.rejects(()=>readPlayer('other-owner'),/OWNER_REQUIRED/);
  const before=JSON.stringify(await readPlayer(owner));await readPlayer(owner);assert.equal(JSON.stringify(await readPlayer(owner)),before);assert.equal(calls,1);
});
test('Neon DB boundary: two concurrent claims, waiting order and explicit continuation',async()=>{
  let release!:()=>void;gate=new Promise(resolve=>{release=resolve;});
  const a=submitCommand(owner,cmd('experience',1));
  for(let i=0;i<50;i++){if((await readPlayer(owner)).jobs.some(j=>j.judgmentStatus==='running'))break;await new Promise(r=>setTimeout(r,20));}
  const b=await submitCommand(owner,cmd('experience',1));assert.equal(b.judgmentStatus,'waiting');assert.ok(b.predecessorJobId);
  await Promise.all([continueJob(owner,b.jobId),continueJob(owner,b.jobId)]);assert.equal(calls,2);
  release();gate=null;await a;await Promise.all(observed);
  const before=calls;await readPlayer(owner);assert.equal(calls,before);
  const done=await continueJob(owner,b.jobId);assert.equal(done.judgmentStatus,'committed');assert.equal(calls,3);
  assert.equal((await readPlayer(owner)).revision,3);
});
test('Neon DB boundary: malformed actual-shaped receipt preserves usage and encrypted failure body, forced facts survive failure',async()=>{
  broken=true;
  const result=await submitCommand(owner,cmd('force_record',3));assert.equal(result.recordStatus,'recorded');assert.equal(result.judgmentStatus,'failed');assert.equal(result.errorCode,'CONTENT_JSON_INVALID');
  const persisted=await testDB.transaction(tx=>rows<{metadata:Record<string,unknown>;diagnostic:unknown;charge_status:string}>(tx,'SELECT * FROM attempts WHERE job_id=$1',[result.jobId]));
  assert.equal(persisted[0].metadata.requestId,'req_synthetic');assert.ok(persisted[0].diagnostic);assert.equal(persisted[0].charge_status,'settled');
  assert.equal((await readPlayer(owner)).revision,3);
  const deleted=await deleteEvent(owner,result.eventId!);assert.equal(deleted.recordStatus,'deleted');
  assert.equal((await testDB.transaction(tx=>rows<{diagnostic:unknown}>(tx,'SELECT diagnostic FROM attempts WHERE job_id=$1',[result.jobId])))[0].diagnostic,null);
  broken=false;
});
test('Neon DB boundary: deletion revokes late commit and forbids diagnostic regeneration',async()=>{
  const revision=(await readPlayer(owner)).revision;
  let release!:()=>void;gate=new Promise(resolve=>{release=resolve;});
  const command=cmd('experience',revision), running=submitCommand(owner,command);
  let job:Awaited<ReturnType<typeof readPlayer>>['jobs'][number]|undefined;
  for(let i=0;i<50;i++){job=(await readPlayer(owner)).jobs.find(j=>j.judgmentStatus==='running');if(job)break;await new Promise(r=>setTimeout(r,20));}
  assert.ok(job);const result=await deleteEvent(owner,job.eventId!);broken=true;release();gate=null;await running;await Promise.all(observed);broken=false;
  const snapshot=await readPlayer(owner);assert.equal(snapshot.revision,result.revision);assert.equal(snapshot.jobs.find(j=>j.jobId===job!.jobId)?.judgmentStatus,'deleted');
  const attempt=(await testDB.transaction(tx=>rows<{diagnostic:unknown;metadata:unknown}>(tx,'SELECT * FROM attempts WHERE job_id=$1',[job!.jobId])))[0];
  assert.equal(attempt.diagnostic,null);assert.deepEqual(attempt.metadata,{});
  assert.equal((await submitCommand(owner,command)).judgmentStatus,'deleted');
});
test('Neon DB boundary: transitive input provenance purges GM memory and current mixed state text',async()=>{
  const snapshot=await readPlayer(owner), first=snapshot.events.find(e=>e.text.includes('SYNTHETIC_FACT') && snapshot.jobs.some(j=>j.eventId===e.id && j.revision && j.judgmentStatus==='committed' && j.jobId===snapshot.jobs[0].jobId));assert.ok(first);
  const deleted=await deleteEvent(owner,first.id);assert.ok(deleted.invalidatedIds.length>1);
  const after=await readPlayer(owner);assert.equal(after.entities.filter(e=>e.kind!=='character').length,0);assert.ok(after.character);assert.notEqual(after.character.name,snapshot.character?.name);assert.equal(after.totalXp,snapshot.totalXp);
  const memory=await testDB.transaction(tx=>rows(tx,"SELECT id FROM records WHERE kind='identity' AND deleted=false"));assert.equal(memory.length,0);
});
test('Neon DB boundary: exact count failure/overflow releases reservation without calling model',async()=>{
  const before=calls;
  useGMForTest(syntheticAdapter,observe,async()=>32001);
  const revision=(await readPlayer(owner)).revision;
  const result=await submitCommand(owner,cmd('force_record',revision));
  assert.equal(result.judgmentStatus,'failed');assert.equal(result.errorCode,'GM_INPUT_TOKEN_LIMIT');assert.equal(calls,before);
  const attempt=(await testDB.transaction(tx=>rows<{charge_status:string}>(tx,'SELECT * FROM attempts WHERE job_id=$1',[result.jobId])))[0];assert.equal(attempt.charge_status,'not_called');
  await deleteEvent(owner,result.eventId!);
  useGMForTest(syntheticAdapter,observe,async()=>{throw new Error('synthetic count unavailable');});
  const failure=await submitCommand(owner,cmd('force_record',(await readPlayer(owner)).revision));assert.equal(failure.errorCode,'TOKEN_COUNT_FAILED');assert.equal(calls,before);
  await deleteEvent(owner,failure.eventId!);useGMForTest(syntheticAdapter,observe);
});
test('Neon DB boundary: unknown billing preserves reservation and budget refusal preserves record',async()=>{
  usageKnown=false;
  const result=await submitCommand(owner,cmd('force_record',(await readPlayer(owner)).revision));assert.equal(result.judgmentStatus,'committed');
  const attempt=(await testDB.transaction(tx=>rows<{charge_status:string;reservation:string}>(tx,'SELECT * FROM attempts WHERE job_id=$1',[result.jobId])))[0];assert.equal(attempt.charge_status,'unknown');
  const budget=(await testDB.transaction(tx=>rows<{reserved:string}>(tx,'SELECT reserved FROM budgets LIMIT 1')))[0];assert.ok(Number(budget.reserved)>=Number(attempt.reservation));
  usageKnown=true;process.env.GM_MONTHLY_LIMIT_USD='0';const before=calls;
  const blocked=await submitCommand(owner,cmd('force_record',(await readPlayer(owner)).revision));assert.equal(blocked.judgmentStatus,'budget_blocked');assert.equal(blocked.recordStatus,'recorded');assert.equal(calls,before);
  await deleteEvent(owner,blocked.eventId!);process.env.GM_MONTHLY_LIMIT_USD='15';
});
test('Neon DB boundary: rejected birth stays retryable and cannot establish start date',async()=>{
  const birthOwner=`birth_${randomUUID()}`;process.env.OWNER_CLERK_USER_ID=birthOwner;
  try {
    nextEnvelope={...envelope,recordAccepted:false};
    const result=await submitCommand(birthOwner,cmd('start',0));assert.equal(result.judgmentStatus,'failed');assert.equal(result.errorCode,'BIRTH_REQUIRES_CHARACTER');assert.equal((await readPlayer(birthOwner)).startedAt,null);
    nextEnvelope=envelope;
    const retry=await continueJob(birthOwner,result.jobId);assert.equal(retry.judgmentStatus,'committed');assert.ok((await readPlayer(birthOwner)).startedAt);
  } finally {process.env.OWNER_CLERK_USER_ID=owner;nextEnvelope=envelope;}
});
test('Neon DB boundary: reality quest completed state cannot bypass evidence list',async()=>{
  useGMForTest(async input=>{
    calls++;const eventId=(input as {eventId:string}).eventId;
    nextEnvelope={...envelope,entities:[...envelope.entities,{id:'real-quest',kind:'quest',name:'동의 과업',summary:'합성',detail:'합성',visibility:'public',truth:'canon',relatedIds:[],quantity:null,status:'completed',attributes:[],realTaskId:eventId}],questCompletions:[]};return receipt();
  },observe);
  const result=await submitCommand(owner,cmd('quest',(await readPlayer(owner)).revision,{consent:{task:'합성 task',completionCondition:'실제 수행',context:'동의한 합성 맥락',recurrence:null}}));
  assert.equal(result.judgmentStatus,'failed');assert.equal(result.errorCode,'QUEST_COMPLETION_NEEDS_REAL_EVIDENCE');assert.equal(result.recordStatus,'recorded');
  assert.ok(!(await readPlayer(owner)).entities.some(e=>e.id==='real-quest'));
  await deleteEvent(owner,result.eventId!);nextEnvelope=envelope;useGMForTest(syntheticAdapter,observe);
});
test('Neon DB boundary: declined fact and derivatives are purged, explicit force-record can store new fact',async()=>{
  nextEnvelope={...envelope,recordAccepted:false};
  const result=await submitCommand(owner,cmd('experience',(await readPlayer(owner)).revision));assert.equal(result.recordStatus,'declined');
  const root=(await testDB.transaction(tx=>rows<{payload:unknown;deleted:boolean}>(tx,'SELECT * FROM records WHERE id=$1',[result.eventId])))[0];assert.equal(root.payload,null);assert.equal(root.deleted,true);
  nextEnvelope=envelope;
  const forced=await submitCommand(owner,cmd('force_record',(await readPlayer(owner)).revision,{targetId:result.eventId,text:'사용자가 새로 명시한 합성 기록 내용'}));assert.equal(forced.recordStatus,'recorded');assert.equal(forced.judgmentStatus,'committed');
  await deleteEvent(owner,result.eventId!);
  assert.ok(!(await readPlayer(owner)).events.some(e=>e.id===forced.eventId));
});
test('Neon DB boundary: correction projects newest record status and deletes old facts',async()=>{
  const correctionOwner=`correction_${randomUUID()}`;process.env.OWNER_CLERK_USER_ID=correctionOwner;
  try {
    await testDB.transaction(tx=>rows(tx,'INSERT INTO games(owner,started_at) VALUES($1,now())',[correctionOwner]));
    const original=await submitCommand(correctionOwner,cmd('force_record',0,{text:'SYNTHETIC_OLD_FACT'}));
    const correction=await submitCommand(correctionOwner,cmd('correct',(await readPlayer(correctionOwner)).revision,{targetId:original.eventId,text:'SYNTHETIC_CORRECTED_FACT'}));
    const snapshot=await readPlayer(correctionOwner),event=snapshot.events.find(e=>e.id===original.eventId);
    assert.equal(correction.recordStatus,'recorded');assert.equal(event?.recordStatus,'recorded');assert.equal(event?.text,'SYNTHETIC_CORRECTED_FACT');assert.equal(event?.version,2);
    const persisted=await testDB.transaction(tx=>rows<{payload:unknown;command:unknown;fingerprint:unknown}>(tx,'SELECT payload,NULL AS command,NULL AS fingerprint FROM records WHERE owner=$1 UNION ALL SELECT NULL AS payload,command,fingerprint FROM jobs WHERE owner=$1',[correctionOwner]));
    assert.ok(!JSON.stringify(persisted).includes('SYNTHETIC_OLD_FACT'));
    await deleteEvent(correctionOwner,original.eventId!);assert.equal((await readPlayer(correctionOwner)).events.length,0);
  } finally {process.env.OWNER_CLERK_USER_ID=owner;}
});
test('Neon DB boundary: deletion preserves numeric abilities, public item quantities and neutral character without source sentinels',async()=>{
  const numericOwner=`numeric_${randomUUID()}`;process.env.OWNER_CLERK_USER_ID=numericOwner;
  try {
    const item=(id:string,quantity:number|null,visibility:'public'|'secret'='public'):GMEnvelope['entities'][number]=>({id,kind:'item',name:`DELETE_SENTINEL_${id}`,summary:'DELETE_SENTINEL_SUMMARY',detail:'DELETE_SENTINEL_DETAIL',quantity,visibility,truth:'canon',relatedIds:[],status:'equipped',attributes:[{name:'DELETE_SENTINEL_ATTRIBUTE',value:'DELETE_SENTINEL_VALUE'}],realTaskId:null});
    nextEnvelope={...envelope,abilities:[{id:'DELETE_SENTINEL_ABILITY',name:'DELETE_SENTINEL_NAME',value:7,meaning:'DELETE_SENTINEL_MEANING',changeReason:null}],entities:[{...envelope.entities[0],name:'DELETE_SENTINEL_CHARACTER'},item('DELETE_SENTINEL_STACK',5),item('DELETE_SENTINEL_UNCOUNTED',null),item('DELETE_SENTINEL_SECRET',99,'secret')]};
    const birth=await submitCommand(numericOwner,cmd('start',0,{text:'DELETE_SENTINEL_REALITY'}));assert.equal(birth.judgmentStatus,'committed');const beforeCalls=calls;
    await deleteEvent(numericOwner,birth.eventId!);
    const state=await readPlayer(numericOwner);assert.equal(calls,beforeCalls);assert.ok(state.character);assert.equal(state.level,1);assert.equal(state.totalXp,0);assert.deepEqual(state.abilities.map(a=>a.value),[7]);
    const items=state.entities.filter(e=>e.kind==='item');assert.deepEqual(items.map(e=>e.quantity),[5,null]);assert.ok(items.every(e=>e.status===null&&e.relatedIds.length===0&&e.attributes?.length===0));assert.ok(!JSON.stringify(state).includes('DELETE_SENTINEL'));assert.ok(state.abilities.every(a=>a.id!=='DELETE_SENTINEL_ABILITY'));
  } finally {process.env.OWNER_CLERK_USER_ID=owner;nextEnvelope=envelope;}
});
