import { requireWebOwner } from '@/server/auth';
import { deleteEvent } from '@/server/service';
import { privateJson,httpError } from '@/server/http';
export const runtime='nodejs';
export async function DELETE(request:Request,{params}:{params:Promise<{eventId:string}>}) {try {const owner=await requireWebOwner(request);return privateJson(await deleteEvent(owner,(await params).eventId));}catch(error){return httpError(error);}}
