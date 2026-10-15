import { z } from 'zod';
import { verifyQueueAuthorization } from '@/server/queue';
import { runQueuedJob } from '@/server/service';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function POST(request:Request) {
  const headers={'Cache-Control':'private, no-store'};
  const input=z.object({jobId:z.uuid()}).strict().safeParse(await request.json().catch(()=>null));
  if(!input.success) return Response.json({error:'Invalid queue request'},{status:400,headers});
  try {
    if(!verifyQueueAuthorization(input.data.jobId,request.headers.get('X-LifeRPG-Queue'))) return Response.json({error:'Unauthorized'},{status:401,headers});
    const started=await runQueuedJob(process.env.OWNER_CLERK_USER_ID!,input.data.jobId);
    return Response.json({started},{status:started?202:200,headers});
  } catch {
    console.error(JSON.stringify({event:'queue_dispatch_failed',jobId:input.data.jobId}));
    return Response.json({error:'Queue unavailable'},{status:503,headers});
  }
}
