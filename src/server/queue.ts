import { createHmac, timingSafeEqual } from 'node:crypto';

const path='/api/internal/queue';
function signingKey() {
  const key=Buffer.from(process.env.DIAGNOSTIC_ENCRYPTION_KEY ?? '', 'base64');
  if(key.length!==32 || !process.env.OWNER_CLERK_USER_ID) throw new Error('QUEUE_NOT_CONFIGURED');
  return createHmac('sha256',key).update('liferpg:queue-handoff:v1').digest();
}
function signature(jobId:string,time:string) {
  return createHmac('sha256',signingKey()).update(JSON.stringify([path,process.env.OWNER_CLERK_USER_ID,jobId,time])).digest('hex');
}
export function queueAuthorization(jobId:string,now=Date.now()) {
  const time=String(now);return `${time}.${signature(jobId,time)}`;
}
export function verifyQueueAuthorization(jobId:string,authorization:string|null,now=Date.now()) {
  const match=/^(\d{13})\.([a-f0-9]{64})$/.exec(authorization ?? '');
  if(!match || Math.abs(now-Number(match[1]))>90000) return false;
  return timingSafeEqual(Buffer.from(match[2],'hex'),Buffer.from(signature(jobId,match[1]),'hex'));
}
export async function dispatchQueuedJob(jobId:string) {
  const origin=new URL(process.env.APP_URL ?? '');
  if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||
    (origin.protocol!=='https:' && !(origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname)))) throw new Error('QUEUE_ORIGIN_INVALID');
  const response=await fetch(new URL(path,origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{'Content-Type':'application/json','X-LifeRPG-Queue':queueAuthorization(jobId)},body:JSON.stringify({jobId})});
  if(!response.ok) throw new Error('QUEUE_HANDOFF_FAILED');
}
