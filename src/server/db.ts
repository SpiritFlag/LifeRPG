import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql, type SQL } from 'drizzle-orm';
import ws from 'ws';
import { ServiceError } from './errors';

export interface SqlDB { execute(query: SQL): Promise<{ rows: unknown[] }>; transaction<T>(fn: (tx: SqlDB) => Promise<T>): Promise<T>; }
let database: SqlDB | undefined;
let connectionPool:Pool|undefined;
export function getDB(): SqlDB {
  if (!database) {
    if (!process.env.DATABASE_URL) throw new ServiceError('DATABASE_NOT_CONFIGURED', 503);
    neonConfig.webSocketConstructor = ws;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    connectionPool=pool;
    database = drizzle(pool) as unknown as SqlDB;
  }
  return database;
}
// Injectable only in server-side test harnesses; no HTTP route exposes this.
export function useDatabaseForTest(db: SqlDB) { database = db; }
export async function closeDatabase() {await connectionPool?.end();database=undefined;connectionPool=undefined;}
export function statement(text: string, values: unknown[] = []): SQL {
  const parts: SQL[] = []; let at = 0;
  for (const match of text.matchAll(/\$(\d+)/g)) {
    parts.push(sql.raw(text.slice(at, match.index)), sql`${sql.param(values[Number(match[1])-1])}`);
    at = match.index! + match[0].length;
  }
  parts.push(sql.raw(text.slice(at)));
  return sql.join(parts, sql.raw(''));
}
export async function rows<T>(db: SqlDB, text: string, values: unknown[] = []): Promise<T[]> {
  return (await db.execute(statement(text, values))).rows as T[];
}
