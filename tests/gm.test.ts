import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectReceipt,parseEnvelope,validateMeaning } from '../src/server/gm';
import { encryptDiagnostic,decryptDiagnostic } from '../src/server/diagnostics';
import type { GMEnvelope,CommandInput } from '../src/lib/contracts';
import { commandSchema } from '../src/lib/contracts';
const command:CommandInput={kind:'experience',text:'산책했다',requestKey:'test-key-123',expectedRevision:0,occurredAt:null,uncertainty:null,targetId:null,consent:null};
const valid:GMEnvelope={contractVersion:'liferpg.1',decision:'apply',recordAccepted:true,question:null,title:'새벽',scene:'문이 열린다',changes:[],level:1,totalXp:0,alive:true,abilities:[],entities:[],questCompletions:[],rationale:'짧은 근거',memories:[]};
test('synthetic provider failures retain request ID, usage and output structure before content parse',()=>{
  const r=inspectReceipt(JSON.stringify({id:'resp_synthetic',status:'completed',service_tier:'default',usage:{input_tokens:100,output_tokens:50},output:[{type:'message',content:[{type:'output_text',text:'{broken'}]}]}),'req_synthetic',200);
  assert.deepEqual(r.usage,{input:100,output:50});assert.equal(r.metadata.requestId,'req_synthetic');assert.ok(Array.isArray(r.metadata.output));assert.throws(()=>parseEnvelope(r),/CONTENT_JSON_INVALID/);
  assert.equal(inspectReceipt('{broken','req_bad_json',200).errorCode,'PROVIDER_JSON_DECODING');
  assert.equal(inspectReceipt(JSON.stringify({status:'incomplete',output:[],usage:{input_tokens:10,output_tokens:2}}),'req_incomplete',200).errorCode,'MODEL_INCOMPLETE');
  assert.equal(inspectReceipt(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}),'req_refusal',200).errorCode,'MODEL_REFUSAL');
});
test('game invariants allow free content and reasoned ability decreases',()=>{
  const old={level:1,totalXp:10,abilities:[{id:'balance',name:'균형',value:5,meaning:'가변',changeReason:null}],entities:[]};
  assert.throws(()=>validateMeaning({...valid,totalXp:9},old,command),/XP_OR_LEVEL_DECREASE/);
  assert.throws(()=>validateMeaning({...valid,level:2},{...old,totalXp:0},{...command,kind:'start'}),/BIRTH_LEVEL_ONE/);
  assert.throws(()=>validateMeaning({...valid,totalXp:10,abilities:[{...old.abilities[0],value:4}]},old,command),/ABILITY_DECREASE_NEEDS_REASON/);
  const character={id:'hero',kind:'character' as const,name:'자유로운 종족',summary:'',detail:'',visibility:'public' as const,truth:'canon' as const,relatedIds:[],quantity:null,status:null,attributes:[],realTaskId:null};
  validateMeaning({...valid,totalXp:10,abilities:[{...old.abilities[0],value:4,changeReason:'확인된 현실의 변화'}],entities:[character]},old,command);
  assert.throws(()=>validateMeaning({...valid,totalXp:10},old,command),/ABILITY_REMOVAL_NOT_ALLOWED/);
  assert.throws(()=>validateMeaning(valid,{...old,totalXp:0,abilities:[]},command),/PUBLIC_CHARACTER_REQUIRED/);
  const secret={id:'s',kind:'lore' as const,name:'숨김',summary:'',detail:'',visibility:'secret' as const,truth:'canon' as const,relatedIds:[],quantity:null,status:null,attributes:[],realTaskId:null};
  assert.throws(()=>validateMeaning({...valid,totalXp:10,abilities:old.abilities,entities:[secret,{...secret,id:'p',visibility:'public',relatedIds:['s']}]},old,command),/PRIVATE_OR_MISSING_REFERENCE/);
});
test('death and negative XP are schema errors; incomplete birth cannot commit',()=>{
  const provider=(value:unknown)=>inspectReceipt(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}),'synthetic',200);
  assert.throws(()=>parseEnvelope(provider({...valid,alive:false})),/CONTRACT_INVALID/);
  assert.throws(()=>parseEnvelope(provider({...valid,totalXp:-1})),/CONTRACT_INVALID/);
  assert.throws(()=>validateMeaning({...valid,recordAccepted:false},{level:1,totalXp:0,abilities:[],entities:[]},{...command,kind:'start'}),/BIRTH_REQUIRES_CHARACTER/);
});
test('failed response encryption and hard 24h access expiry',()=>{
  process.env.DIAGNOSTIC_ENCRYPTION_KEY=Buffer.alloc(32,9).toString('base64');
  const encrypted=encryptDiagnostic('sensitive failed body');assert.ok(!JSON.stringify(encrypted).includes('sensitive'));
  assert.equal(decryptDiagnostic(encrypted,new Date(Date.now()+1000)),'sensitive failed body');
  assert.throws(()=>decryptDiagnostic(encrypted,new Date(Date.now()-1)),/DIAGNOSTIC_EXPIRED/);
});
test('retained request keys are opaque identifiers, not reality prose',()=>{
  assert.ok(commandSchema.safeParse({...command,requestKey:'2c8dfd1a-05aa-49e6-9e44-4a38d5e336f1'}).success);
  assert.ok(commandSchema.safeParse({...command,requestKey:'exp-20261015-vercel-03'}).success);
  assert.ok(!commandSchema.safeParse({...command,requestKey:'private-reality-fact-as-request-key'}).success);
  assert.ok(!commandSchema.safeParse({...command,requestKey:'민감한 현실 내용을 요청키에 넣음'}).success);
});
