import { requireWebOwner } from '@/server/auth';
import { submitCommand } from '@/server/service';
import { commandSchema } from '@/lib/contracts';
import { privateJson,httpError,jsonBody } from '@/server/http';
export const runtime='nodejs';
export const maxDuration=300;
export async function POST(request:Request) {try {const owner=await requireWebOwner(request);return privateJson(await submitCommand(owner,commandSchema.parse(await jsonBody(request))));}catch(error){return httpError(error);}}
