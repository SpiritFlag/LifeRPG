import { config } from 'dotenv';
import { mkdir,writeFile } from 'node:fs/promises';
import { countGMInput } from '../src/server/gm';
async function main() {
  config({path:'.env.local',quiet:true});
  // Coordinator-approved count-only probe. This never calls responses.create().
  const input={contractVersion:'liferpg.1',promptVersion:'gm.1',today:new Date().toISOString().slice(0,10),state:{level:1,totalXp:0,abilities:[],entities:[]},command:{kind:'start',text:'합성 플레이어가 오늘 레벨 1로 시작합니다.'},records:[]};
  const started=Date.now(),inputTokens=await countGMInput(input);
  const report={kind:'REAL_OFFICIAL_INPUT_TOKEN_COUNT_ONLY',model:'gpt-6.1-sol',inputTokens,includesInstructionsAndStructuredSchema:true,inferenceCalled:false,elapsedMs:Date.now()-started};
  await mkdir('.local',{recursive:true});await writeFile('.local/token-count-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(()=>{console.error('Official token count check failed; no inference was called.');process.exitCode=1;});
