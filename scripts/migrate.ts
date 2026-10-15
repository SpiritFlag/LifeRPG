import { config } from 'dotenv';
import { readFile,readdir } from 'node:fs/promises';
import { getDB, rows } from '../src/server/db';
config({path:'.env.local',quiet:true});
async function main() {
const directory=new URL('../migrations/',import.meta.url);
const migrations=await Promise.all((await readdir(directory)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFile(new URL(f,directory),'utf8')));
await getDB().transaction(async tx => {
  await rows(tx, 'SELECT pg_advisory_xact_lock(79004311)');
  for(const migration of migrations) for (const command of migration.split(';').filter(s=>s.trim())) await rows(tx, command);
});
console.log('SQL migrations applied (idempotent).');
process.exit(0);
}
main().catch(()=>{console.error('Migration failed; inspect database connectivity without printing credentials.');process.exit(1);});
