import { requireWebOwner } from '@/server/auth';
import { readPlayer } from '@/server/service';
import { privateJson,httpError } from '@/server/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {try{return privateJson(await readPlayer(await requireWebOwner(request)));}catch(error){return httpError(error);}}
