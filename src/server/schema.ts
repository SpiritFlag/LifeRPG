import { pgTable, text, integer, jsonb, timestamp, numeric, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const games = pgTable('games', {
  owner: text().primaryKey(), revision: integer().notNull().default(0), privacyEpoch: integer('privacy_epoch').notNull().default(0), worldSequence: integer('world_sequence').notNull().default(0), startedAt: timestamp('started_at', {withTimezone:true}), activeAttempt: text('active_attempt'), state: jsonb().notNull(), stateSources: text('state_sources').array().notNull().default([]),
});
export const records = pgTable('records', {
  id: text().primaryKey(), owner: text().notNull(), kind: text().notNull(), version: integer().notNull().default(1), payload: jsonb(), sources: text().array().notNull().default([]), important: boolean().notNull().default(false), deleted: boolean().notNull().default(false), createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const jobs = pgTable('jobs', {
  id: text().primaryKey(), owner: text().notNull(), requestKey: text('request_key').notNull(), fingerprint: text(), command: jsonb(), kind: text().notNull(), eventId: text('event_id'), status: text().notNull(), recordStatus: text('record_status').notNull(), resultId: text('result_id'), errorCode: text('error_code'), createdAt: timestamp('created_at',{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
});
export const attempts = pgTable('attempts', {
  id: text().primaryKey(), jobId: text('job_id').notNull(), owner: text().notNull(), baseRevision: integer('base_revision').notNull(), privacyEpoch: integer('privacy_epoch').notNull(), leaseUntil: timestamp('lease_until',{withTimezone:true}).notNull(), sources: text().array().notNull(), metadata: jsonb().notNull(), diagnostic: jsonb(), diagnosticExpires: timestamp('diagnostic_expires',{withTimezone:true}), reservation: numeric({precision:12,scale:6}).notNull(), chargeStatus: text('charge_status').notNull(), month: text().notNull(), budgetKeys:text('budget_keys').array().notNull(), createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const budgets = pgTable('budgets', {month:text().primaryKey(), reserved:numeric({precision:12,scale:6}).notNull().default('0'), spent:numeric({precision:12,scale:6}).notNull().default('0')});
