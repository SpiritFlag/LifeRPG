import { config } from 'dotenv';
import { timingSafeEqual } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { getDB,rows,closeDatabase } from '../src/server/db';
import { decryptDiagnostic,type CipherBody } from '../src/server/diagnostics';
async function main() {
  config({path:'.env.local',quiet:true});
  const expected=Buffer.from(process.env.DIAGNOSTIC_OPERATOR_TOKEN ?? ''), supplied=Buffer.from(process.env.DIAGNOSTIC_ACCESS_TOKEN ?? '');
  if(expected.length<32||expected.length!==supplied.length||!timingSafeEqual(expected,supplied)) throw new Error('Restricted operator authorization required');
  const id=process.argv[2];if(!id || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Attempt UUID required');
  const record=await getDB().transaction(async tx=>{
    await rows(tx,'UPDATE attempts SET diagnostic=NULL,diagnostic_expires=NULL WHERE diagnostic_expires<=now()');
    return (await rows<{diagnostic:CipherBody|null;diagnostic_expires:Date}>(tx,'SELECT diagnostic,diagnostic_expires FROM attempts WHERE id=$1 AND diagnostic_expires>now()',[id]))[0];
  });
  if(!record?.diagnostic) throw new Error('Diagnostic unavailable, expired or removed');
  const body=decryptDiagnostic(record.diagnostic,new Date(record.diagnostic_expires));
  await mkdir('.local',{recursive:true});
  await writeFile(`.local/diagnostic-${id}.txt`,body,{mode:0o600});
  console.log(`Restricted diagnostic written locally for ${id}. Do not publish or attach it to player responses.`);
}
main().catch(()=>{console.error('Diagnostic access denied or unavailable.');process.exitCode=1;}).finally(()=>closeDatabase());
