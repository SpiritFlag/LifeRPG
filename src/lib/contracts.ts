import { z } from 'zod';

export const CONTRACT_VERSION = 'liferpg.1' as const;
const text = z.string().min(1).max(12000);
export const abilitySchema = z.object({ id: z.string(), name: z.string(), value: z.number().finite(), meaning: z.string(), changeReason: z.string().nullable() });
export const entitySchema = z.object({ id: z.string(), kind: z.enum(['character','item','quest','place','npc','faction','lore','relationship','skill','trait','title','achievement','class']), name: z.string(), summary: z.string(), detail: z.string(), visibility: z.enum(['public','secret']), truth: z.enum(['canon','belief','interpretation']), relatedIds: z.array(z.string()), quantity: z.number().int().nonnegative().nullable(),status:z.string().nullable(),attributes:z.array(z.object({name:z.string(),value:z.string()})),realTaskId:z.string().nullable() });
export type PlayerEntity = Omit<z.infer<typeof entitySchema>, 'visibility'|'status'|'attributes'|'realTaskId'> & {status?:string|null;attributes?:{name:string;value:string}[];realTaskId?:string|null};
export type Ability = z.infer<typeof abilitySchema>;
export interface PlayerResult { id: string; title: string; scene: string; changes: string[]; question: string | null; createdAt: string; revision: number; }
export type JudgmentStatus = 'waiting'|'running'|'committed'|'failed'|'interrupted'|'budget_blocked'|'deleted';
export interface JobDTO { requestId: string; jobId: string; eventId: string|null; recordStatus: 'pending'|'recorded'|'declined'|'deleted'; judgmentStatus: JudgmentStatus; resultId: string|null; revision: number; playerResult: PlayerResult|null; nextAction: 'poll'|'continue'|'retry'|'answer'|'none'; predecessorJobId: string|null; unprocessedCount: number; errorCode: string|null; }
export interface RealityRecord {id:string;kind:string;version:number;text:string;occurredAt:string|null;uncertainty:string|null;consent:CommandInput['consent'];recordStatus?:JobDTO['recordStatus'];}
export interface PlayerSnapshot { revision: number; worldSequence: number; startedAt: string|null; level: number; totalXp: number; character: PlayerEntity|null; abilities: Ability[]; entities: PlayerEntity[]; results: PlayerResult[]; jobs: JobDTO[]; events:RealityRecord[]; unprocessedCount: number; }

export const commandSchema = z.object({
  requestKey: z.string().min(8).max(160),
  expectedRevision: z.number().int().nonnegative(),
  kind: z.enum(['start','experience','force_record','correct','quest','quest_update','answer','appeal']),
  text,
  occurredAt: z.string().max(100).nullable(),
  uncertainty: z.string().max(2000).nullable(),
  targetId: z.string().max(160).nullable(),
  consent: z.object({ task: text, completionCondition: text, context: text, recurrence: z.string().max(2000).nullable() }).nullable(),
});
export type CommandInput = z.infer<typeof commandSchema>;
export interface DeleteResult { deletionId: string; recordStatus: 'deleted'; cleanupStatus: 'complete'; invalidatedIds: string[]; revision: number; externalRetention: string; }

// Structured Output envelope. Content names, species, classes and abilities are free text.
export const gmEnvelopeSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  decision: z.enum(['apply','question','decline']),
  recordAccepted: z.boolean(),
  question: z.string().nullable(),
  title: z.string(), scene: z.string(), changes: z.array(z.string()),
  level: z.number().int().min(1), totalXp: z.number().int().nonnegative(), alive: z.literal(true),
  abilities: z.array(abilitySchema),
  entities: z.array(entitySchema),
  questCompletions: z.array(z.object({ questId: z.string(), evidenceEventId: z.string() })),
  rationale: z.string(),
  memories: z.array(z.object({ id: z.string(), kind: z.enum(['identity','philosophy','reflection','setting','foreshadowing','rationale']), content: z.string(), reason: z.string(), previousId: z.string().nullable(), important: z.boolean(), relatedIds: z.array(z.string()) })),
});
export type GMEnvelope = z.infer<typeof gmEnvelopeSchema>;
