import { requireWebOwner } from '@/server/auth';
import { continueJob } from '@/server/service';
import { privateJson,httpError } from '@/server/http';
export const runtime='nodejs';
export const maxDuration=300;
export async function POST(request:Request,{params}:{params:Promise<{jobId:string}>}) {try {const owner=await requireWebOwner(request);return privateJson(await continueJob(owner,(await params).jobId));}catch(error){return httpError(error);}}
