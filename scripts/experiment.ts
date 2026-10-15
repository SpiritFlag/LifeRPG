import { config } from 'dotenv';
import { mkdir,writeFile } from 'node:fs/promises';
import { getDB,rows,closeDatabase } from '../src/server/db';
import { readPlayer,submitCommand,useGMForTest } from '../src/server/service';
import { callGM,countGMInput,MAX_RESERVATION_USD } from '../src/server/gm';
async function main() {
  config({path:'.env.local',quiet:true});
  const index=process.argv.indexOf('--authorization'), authorization=index>=0?process.argv[index+1]:null;
  if(!authorization || !/^exp-[a-zA-Z0-9-]+$/.test(authorization)) throw new Error('Explicit coordinator experiment authorization required');
  process.env.EXPERIMENT_AUTHORIZATION=authorization;
  process.env.GM_BUDGET_SCOPE='experiment';
  process.env.GM_PAID_CALLS_ENABLED='true';
  // Process-only synthetic principal. Never overwrite .env.local or a real player's character.
  const owner=`experiment:${authorization}`;
  process.env.OWNER_CLERK_USER_ID=owner;
  const before=await readPlayer(owner);
  const existing=before.jobs[0];
  let pending:Promise<void>|null=null;
  useGMForTest(callGM,p=>{pending=p;},countGMInput);
  const started=Date.now();
  const result=existing ?? await submitCommand(owner,{kind:'start',requestKey:authorization,expectedRevision:before.revision,text:'실연결 검증용 합성 플레이어가 오늘부터 새로운 캐릭터 탄생을 명시적으로 요청합니다. 실제 사용자 과거 기록은 없습니다.',occurredAt:null,uncertainty:null,targetId:null,consent:null});
  if(pending) await pending;
  const snapshot=await readPlayer(owner);
  const evidence=await getDB().transaction(tx=>rows<{id:string;metadata:Record<string,unknown>;charge_status:string;reservation:string}>(tx,'SELECT id,metadata,charge_status,reservation FROM attempts WHERE job_id=$1 ORDER BY created_at',[result.jobId]));
  const ledger=await getDB().transaction(tx=>rows(tx,"SELECT * FROM budgets WHERE month='experiment:lifetime'"));
  const report={kind:'REAL_OPENAI_AND_NEON_SERVICE_PATH',authorization,syntheticPrincipal:true,clerkHttpOrMcpVerified:false,automaticRetry:false,maxReservation:MAX_RESERVATION_USD,elapsedMs:Date.now()-started,job:snapshot.jobs.find(j=>j.jobId===result.jobId),revision:snapshot.revision,level:snapshot.level,characterPresent:!!snapshot.character,attempts:evidence,experimentLedger:ledger};
  await mkdir('.local',{recursive:true});await writeFile(`.local/${authorization}.json`,JSON.stringify(report,null,2));
  // No player text, keys, diagnostics or raw response in normal output.
  console.log(JSON.stringify({...report,job:report.job?{jobId:report.job.jobId,status:report.job.judgmentStatus,errorCode:report.job.errorCode}:null},null,2));
  if(report.job?.judgmentStatus!=='committed') process.exitCode=1;
}
main().catch(()=>{console.error('Experiment failed. Inspect saved job/attempt metadata; do not repeat a paid call automatically.');process.exitCode=1;}).finally(()=>closeDatabase());
