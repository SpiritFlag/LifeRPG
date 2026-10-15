import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { ServiceError } from './errors';
export interface CipherBody {iv:string;tag:string;ciphertext:string;truncated:boolean;originalBytes:number;}
function key() {
  const encoded=process.env.DIAGNOSTIC_ENCRYPTION_KEY;
  if(!encoded || Buffer.from(encoded,'base64').length!==32) throw new ServiceError('DIAGNOSTIC_KEY_NOT_CONFIGURED',503);
  return Buffer.from(encoded,'base64');
}
export function encryptDiagnostic(raw:string):CipherBody {
  const original=Buffer.from(raw), data=original.subarray(0,256000), iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key(),iv);
  const ciphertext=Buffer.concat([cipher.update(data),cipher.final()]);
  return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64'),truncated:original.length>data.length,originalBytes:original.length};
}
export function decryptDiagnostic(body:CipherBody,expires:Date):string {
  if(expires.getTime()<=Date.now()) throw new ServiceError('DIAGNOSTIC_EXPIRED',410);
  const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(body.iv,'base64'));
  decipher.setAuthTag(Buffer.from(body.tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body.ciphertext,'base64')),decipher.final()]).toString();
}
