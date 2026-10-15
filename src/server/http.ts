import { ZodError } from 'zod';
import { AuthorizationError } from './auth';
import { ServiceError } from './errors';
export const PRIVATE_HEADERS={'Cache-Control':'private, no-store','Vary':'Cookie, Authorization'};
export function privateJson(data:unknown,status=200) {return Response.json(data,{status,headers:PRIVATE_HEADERS});}
export function httpError(error:unknown) {
  if(error instanceof AuthorizationError) return privateJson({error:error.message},error.status);
  if(error instanceof ServiceError) return privateJson({error:error.code},error.status);
  if(error instanceof ZodError) return privateJson({error:'INVALID_INPUT',fields:error.issues.map(i=>i.path.join('.'))},422);
  return privateJson({error:'SERVICE_UNAVAILABLE'},503);
}
export async function jsonBody(request:Request):Promise<unknown> {
  if(!request.headers.get('content-type')?.includes('application/json')) throw new ServiceError('JSON_REQUIRED',415);
  if(Number(request.headers.get('content-length') ?? 0)>64000) throw new ServiceError('INPUT_TOO_LARGE',413);
  const text=await request.text();
  if(Buffer.byteLength(text)>64000) throw new ServiceError('INPUT_TOO_LARGE',413);
  try{return JSON.parse(text);}catch{throw new ServiceError('INVALID_JSON',400);}
}
