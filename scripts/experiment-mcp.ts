import { config } from 'dotenv';
import { mkdir,writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { PlayerSnapshot,JobDTO } from '../src/lib/contracts';
import { getDB,rows,closeDatabase } from '../src/server/db';
import { MAX_RESERVATION_USD } from '../src/server/gm';

interface ExperimentOptions {url:string;accessToken:string;sessionToken:string|(()=>Promise<string>);authorization:string;automationBypass?:{origin:string;token:string};}
function structured<T>(result:Awaited<ReturnType<Client['callTool']>>):T {
  if(result.isError)throw new Error('MCP_TOOL_REJECTED');
  if(!result.structuredContent)throw new Error('MCP_STRUCTURED_CONTENT_MISSING');
  return result.structuredContent as T;
}
// Invoke only after the coordinator grants a single explicit experiment allocation.
// Authentication tokens are received in memory, never printed or written to evidence.
export async function runMcpExperiment(options:ExperimentOptions) {
  if(!/^exp-[a-zA-Z0-9-]+$/.test(options.authorization)||!options.accessToken||!options.sessionToken)throw new Error('Explicit allocation and separate real OAuth/web session required');
  const url=new URL(options.url);
  if(url.pathname!=='/mcp'||url.username||url.password||url.search||url.hash)throw new Error('Canonical MCP endpoint required');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('HTTPS or local test endpoint required');
  if(options.automationBypass&&(options.automationBypass.origin!==url.origin||url.protocol!=='https:'||!options.automationBypass.token))throw new Error('Automation bypass must bind the exact HTTPS experiment origin');
  const automationHeaders:Record<string,string>=options.automationBypass?{'x-vercel-protection-bypass':options.automationBypass.token}:{};
  const reportPath=`.local/${options.authorization}.json`;
  if(existsSync(reportPath))throw new Error('Original experiment report already exists; no new call permitted');
  const acceptedBefore=await getDB().transaction(tx=>rows(tx,'SELECT id FROM jobs WHERE request_key=$1 LIMIT 1',[options.authorization]));
  if(acceptedBefore.length)throw new Error('Allocation already accepted; inspect saved job instead of retrying');
  const client=new Client({name:'LifeRPG-authorized-synthetic-experiment',version:'1'});
  const started=Date.now();
  try {
    await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{...automationHeaders,Authorization:`Bearer ${options.accessToken}`},redirect:'error'}}));
    const read=async()=>structured<PlayerSnapshot>(await client.callTool({name:'get_player_context',arguments:{}}));
    const before=await read();
    if(before.startedAt||before.jobs.length)throw new Error('Fresh synthetic principal required; no replay or paid retry was attempted');
    const accepted=structured<JobDTO>(await client.callTool({name:'submit_life_command',arguments:{kind:'start',requestKey:options.authorization,expectedRevision:before.revision,text:'이것은 실연결 검증 전용 합성 플레이어의 명시적인 오늘 탄생 요청입니다. 실제 사용자 과거 경험은 없습니다.',occurredAt:null,uncertainty:null,targetId:null,consent:null}}));
    const submissionReturnedAt=new Date().toISOString();
    let snapshot=await read();
    while(snapshot.jobs.find(j=>j.jobId===accepted.jobId)?.judgmentStatus==='running'&&Date.now()-started<245000) {
      await new Promise(resolve=>setTimeout(resolve,1500));snapshot=await read();
    }
    const job=snapshot.jobs.find(j=>j.jobId===accepted.jobId);
    // This branch deliberately never calls continue/retry, even for a failed accepted job.
    if(job?.judgmentStatus!=='committed')throw new Error(`EXPERIMENT_NOT_COMMITTED_${job?.judgmentStatus ?? 'unknown'}`);
    // Clerk web JWTs are short lived. A real browser session can refresh its JWT
    // here after a long model call; this does not retry the paid judgment.
    const webSessionToken=typeof options.sessionToken==='function'?await options.sessionToken():options.sessionToken;
    const webResponse=await fetch(new URL('/api/player',url),{headers:{...automationHeaders,Authorization:`Bearer ${webSessionToken}`},cache:'no-store',redirect:'error'});
    if(!webResponse.ok)throw new Error('SYNTHETIC_WEB_SESSION_READ_FAILED');
    const web=await webResponse.json() as PlayerSnapshot;
    if(web.revision!==snapshot.revision||!web.results.some(r=>r.id===job.resultId))throw new Error('WEB_MCP_RESULT_MISMATCH');
    const attempts=await getDB().transaction(tx=>rows(tx,'SELECT id,metadata,charge_status,reservation FROM attempts WHERE job_id=$1 ORDER BY created_at',[job.jobId]));
    const ledger=await getDB().transaction(tx=>rows(tx,"SELECT * FROM budgets WHERE month='experiment:lifetime'"));
    const report={kind:'REAL_OAUTH_HTTP_MCP_OPENAI_NEON_WEB',authorization:options.authorization,syntheticPrincipal:true,actualChatGPT:false,deployedPreview:url.hostname!=='localhost'&&url.hostname!=='127.0.0.1',automationProtectionUsed:!!options.automationBypass,maxReservation:MAX_RESERVATION_USD,automaticRetry:false,elapsedMs:Date.now()-started,submissionReturnedAt,finalObservedAt:new Date().toISOString(),initialJudgmentStatus:accepted.judgmentStatus,jobId:job.jobId,resultId:job.resultId,mcpRevision:snapshot.revision,webRevision:web.revision,worldSequence:snapshot.worldSequence,level:snapshot.level,totalXp:snapshot.totalXp,characterPresent:!!snapshot.character,attemptCount:attempts.length,attempts,experimentLedger:ledger};
    await mkdir('.local',{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2),{flag:'wx'});
    return report;
  } finally {await client.close();await closeDatabase();}
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/scripts/experiment-mcp.ts')) {
  config({path:'.env.local',quiet:true});
  runMcpExperiment({url:process.env.MCP_TEST_URL ?? '',accessToken:process.env.MCP_TEST_ACCESS_TOKEN ?? '',sessionToken:process.env.MCP_TEST_SESSION_TOKEN ?? '',authorization:process.env.EXPERIMENT_AUTHORIZATION ?? ''}).then(report=>console.log(JSON.stringify(report))).catch(()=>{console.error('MCP experiment failed. Inspect saved job/attempt before any explicit retry; no automatic paid retry was made.');process.exitCode=1;});
}
