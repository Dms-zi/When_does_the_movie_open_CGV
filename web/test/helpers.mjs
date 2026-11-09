import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function database(filename = ':memory:', initialize = true) {
  const sql = new DatabaseSync(filename); sql.exec('PRAGMA foreign_keys=ON');
  if (initialize) sql.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  const db = { sql, prepare(query) { let values = []; const statement = {
    bind(...args) { values = args; return statement; },
    async all() { return {results:sql.prepare(query).all(...values)}; },
    async first() { return sql.prepare(query).get(...values) ?? null; },
    async run() { return sql.prepare(query).run(...values); },
  }; return statement; }, async batch(statements) {
    sql.exec('BEGIN'); try { const results=[]; for(const statement of statements)results.push(await statement.run()); sql.exec('COMMIT'); return results; } catch(error) {sql.exec('ROLLBACK');throw error;}
  }};
  return db;
}
export const now = Date.parse('2026-11-09T03:00:00Z');
export const movie = (id = 'a', dates = ['2026-11-10'], bookableDates = dates) => ({id,title:`영화 ${id}`,dates,bookableDates});
export const sub = {endpoint:'https://fcm.googleapis.com/fcm/send/example',keys:{p256dh:Buffer.alloc(65,1).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}};
export async function subscribe(db, token = 'owner', movieIds = ['a'], at = now + 1) {
  const {saveSubscription} = await import('../src/store.mjs');
  await saveSubscription(db, token, {...sub,endpoint:sub.endpoint+token}, movieIds, 30, at);
}
export async function deliveries(db) { return (await db.prepare('SELECT * FROM deliveries ORDER BY movie_id,play_date').all()).results; }
