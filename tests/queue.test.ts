import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueAuthorization,verifyQueueAuthorization,dispatchQueuedJob } from '../src/server/queue';

test('queue handoff is bound to the owner, exact job and a short expiration',()=>{
  const original={...process.env};
  try {
    process.env.DIAGNOSTIC_ENCRYPTION_KEY=Buffer.alloc(32,3).toString('base64');process.env.OWNER_CLERK_USER_ID='synthetic_owner';
    const now=Date.now(),token=queueAuthorization('job-a',now);
    assert.equal(verifyQueueAuthorization('job-a',token,now),true);
    for(const invalid of [null,'bad',token+'0'])assert.equal(verifyQueueAuthorization('job-a',invalid,now),false);
    assert.equal(verifyQueueAuthorization('job-b',token,now),false);
    assert.equal(verifyQueueAuthorization('job-a',token,now+90001),false);
    assert.equal(verifyQueueAuthorization('job-a',token,now-90001),false);
    process.env.OWNER_CLERK_USER_ID='other_owner';assert.equal(verifyQueueAuthorization('job-a',token,now),false);
    delete process.env.DIAGNOSTIC_ENCRYPTION_KEY;assert.throws(()=>queueAuthorization('job-a',now),/QUEUE_NOT_CONFIGURED/);
  } finally {process.env=original;}
});

test('queue dispatch uses only configured origin, rejects redirects and sends no provider keys',async()=>{
  const original={...process.env},fetcher=globalThis.fetch;let requested=false;
  try {
    process.env.DIAGNOSTIC_ENCRYPTION_KEY=Buffer.alloc(32,4).toString('base64');process.env.OWNER_CLERK_USER_ID='synthetic_owner';process.env.APP_URL='https://example.com';
    globalThis.fetch=async (url,options)=>{
      requested=true;assert.equal(String(url),'https://example.com/api/internal/queue');assert.equal(options?.redirect,'error');
      assert.deepEqual(JSON.parse(String(options?.body)),{jobId:'synthetic-job'});
      assert.equal(verifyQueueAuthorization('synthetic-job',new Headers(options?.headers).get('X-LifeRPG-Queue')),true);
      assert.equal(new Headers(options?.headers).has('Authorization'),false);
      return new Response(null,{status:202});
    };
    await dispatchQueuedJob('synthetic-job');assert.equal(requested,true);
    for(const url of ['https://example.com/path','https://user:pass@example.com','http://example.com','https://example.com?x=1']){process.env.APP_URL=url;await assert.rejects(()=>dispatchQueuedJob('synthetic-job'),/QUEUE_ORIGIN_INVALID/);}
    process.env.APP_URL='https://example.com';globalThis.fetch=async()=>new Response(null,{status:503});await assert.rejects(()=>dispatchQueuedJob('synthetic-job'),/QUEUE_HANDOFF_FAILED/);
  } finally {process.env=original;globalThis.fetch=fetcher;}
});
