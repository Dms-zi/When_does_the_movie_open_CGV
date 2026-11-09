import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySnapshot, acquirePollLock, readState, saveSubscription } from '../src/store.mjs';
import { runMonitor, handleRequest } from '../src/worker.mjs';
import { flushPending, validateSubscription } from '../src/push.mjs';
import { koreaToday, normalizeSnapshot } from '../src/detection.mjs';
import { database, now, movie, sub, subscribe, deliveries } from './helpers.mjs';

test('first successful snapshot is a quiet baseline', async()=>{
  const db=database(); await applySnapshot(db,[movie()],now); assert.deepEqual(await deliveries(db),[]);
  assert.equal((await readState(db)).initialized,'1'); db.sql.close();
});
test('unchanged polls and seat/format duplicates do not notify',async()=>{
  const db=database();await applySnapshot(db,[movie()],now);await subscribe(db);
  await applySnapshot(db,[movie(),movie('a',['2026-11-10'],[])],now+300000);
  assert.equal((await deliveries(db)).length,0);db.sql.close();
});
test('only a watched movie new date produces one event per subscriber',async()=>{
  const db=database();await applySnapshot(db,[movie(),movie('b')],now);await subscribe(db);await subscribe(db,'second');
  await applySnapshot(db,[movie('a',['2026-11-10','2026-11-11']),movie('b',['2026-11-10','2026-11-12'])],now+300000);
  const jobs=await deliveries(db);assert.equal(jobs.length,2);assert.ok(jobs.every(job=>job.movie_id==='a'&&job.play_date==='2026-11-11'));
  await applySnapshot(db,[movie('a',['2026-11-10','2026-11-11'])],now+600000);assert.equal((await deliveries(db)).length,2);db.sql.close();
});
test('movie added to a date already occupied by another movie is detected',async()=>{
  const db=database();await applySnapshot(db,[movie('a',['2026-11-10']),movie('b',['2026-11-12'])],now);await subscribe(db);
  await applySnapshot(db,[movie('a',['2026-11-10','2026-11-12']),movie('b',['2026-11-12'])],now+300000);
  assert.equal((await deliveries(db))[0].play_date,'2026-11-12');db.sql.close();
});
test('missing dates, sold-out dates and reopenings never reset history',async()=>{
  const db=database();await applySnapshot(db,[movie()],now);await subscribe(db);
  await applySnapshot(db,[],now+300000);await applySnapshot(db,[movie('a',['2026-11-10'],[])],now+600000);await applySnapshot(db,[movie()],now+900000);
  assert.equal((await deliveries(db)).length,0);db.sql.close();
});
test('newly subscribed browser receives no historical or queued openings',async()=>{
  const db=database();await applySnapshot(db,[movie()],now);await applySnapshot(db,[movie('a',['2026-11-10','2026-11-11'])],now+300000);
  await subscribe(db,'later',['a'],now+300001);await applySnapshot(db,[movie('a',['2026-11-10','2026-11-11'])],now+600000);
  assert.equal((await deliveries(db)).length,0);db.sql.close();
});
test('history survives database/process restart',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'cgv-test-')),path=join(directory,'state.sqlite');
  let db=database(path);await applySnapshot(db,[movie()],now);await subscribe(db);db.sql.close();
  db=database(path,false);await applySnapshot(db,[movie()],now+300000);assert.equal((await deliveries(db)).length,0);db.sql.close();rmSync(directory,{recursive:true});
});
test('failed/partial source fetch preserves baseline and records no alerts',async()=>{
  const db=database();await applySnapshot(db,[movie()],now);await subscribe(db);
  await runMonitor({DB:db},async()=>{throw new Error('HTTP 403');},undefined,now+300000);
  assert.equal((await readState(db)).last_success,String(now));assert.equal((await deliveries(db)).length,0);
  await runMonitor({DB:db},async()=>[movie()],undefined,now+600000);assert.equal((await deliveries(db)).length,0);db.sql.close();
});
test('invalid snapshot does not change successful data',async()=>{
  const db=database();await applySnapshot(db,[movie()],now);
  await assert.rejects(applySnapshot(db,[movie('a',['2026-02-30'])],now+300000));
  assert.equal((await readState(db)).last_success,String(now));db.sql.close();
});
test('overlapping monitors cannot acquire the same lease',async()=>{
  const db=database();assert.equal(await acquirePollLock(db,now),true);assert.equal(await acquirePollLock(db,now+1),false);assert.equal(await acquirePollLock(db,now+240001),true);db.sql.close();
});
const env={VAPID_PUBLIC_KEY:'public',VAPID_PRIVATE_KEY:'private',VAPID_SUBJECT:'https://example.com',PUBLIC_URL:'https://example.com/'};
test('push groups new dates per person and does not resend successful jobs',async()=>{
  const db=database();await applySnapshot(db,[movie()],now);await subscribe(db);await applySnapshot(db,[movie('a',['2026-11-10','2026-11-11','2026-11-12'])],now+300000);
  const sent=[];const sender=async(_sub,data)=>{sent.push(data);return new Response('',{status:201});};
  await flushPending(db,env,sender,now+300000);await flushPending(db,env,sender,now+600000);
  assert.equal(sent.length,1);assert.equal(sent[0].events.length,2);assert.ok((await deliveries(db)).every(job=>job.sent_at));db.sql.close();
});
test('push failure retries later without duplicate date records',async()=>{
  const db=database();await applySnapshot(db,[movie()],now);await subscribe(db);await applySnapshot(db,[movie('a',['2026-11-10','2026-11-11'])],now+300000);
  await flushPending(db,env,async()=>new Response('',{status:503}),now+300000);
  const jobs=await deliveries(db);assert.equal(jobs[0].attempts,1);assert.equal(jobs[0].sent_at,null);
  let count=0;await flushPending(db,env,async()=>{count++;return new Response('',{status:201});},now+600001);assert.equal(count,1);assert.equal((await deliveries(db)).length,1);db.sql.close();
});
test('expired push endpoint is deleted with watches and jobs',async()=>{
  const db=database();await applySnapshot(db,[movie()],now);await subscribe(db);await applySnapshot(db,[movie('a',['2026-11-11'])],now+300000);
  await flushPending(db,env,async()=>new Response('',{status:410}),now+300000);assert.equal((await deliveries(db)).length,0);assert.equal((await db.prepare('SELECT * FROM watches').all()).results.length,0);db.sql.close();
});
test('unwatch removes pending deliveries but preserves date history',async()=>{
  const db=database();await applySnapshot(db,[movie()],now);await subscribe(db);await applySnapshot(db,[movie('a',['2026-11-11'])],now+300000);
  await saveSubscription(db,'owner',{...sub,endpoint:sub.endpoint+'owner'},[],30,now+300001);assert.equal((await deliveries(db)).length,0);
  assert.equal((await db.prepare('SELECT * FROM seen_dates').all()).results.length,2);db.sql.close();
});
test('push subscriptions reject arbitrary URLs and malformed keys',()=>{
  assert.doesNotThrow(()=>validateSubscription(sub));
  for(const endpoint of ['http://localhost','https://127.0.0.1','https://fcm.googleapis.com.attacker.test/push','https://user@fcm.googleapis.com/push','https://fcm.googleapis.com:444/push'])assert.throws(()=>validateSubscription({...sub,endpoint}));
  assert.throws(()=>validateSubscription({...sub,keys:{p256dh:'bad',auth:'bad'}}));
});
test('HTTP API enforces origin, bearer and internal polling secret',async()=>{
  const db=database(),environment={DB:db,PUBLIC_ORIGIN:'https://example.com',POLL_TOKEN:'secret'};
  assert.equal((await handleRequest(new Request('https://api.test/api/subscription',{headers:{Origin:'https://evil.test'}}),environment)).status,403);
  assert.equal((await handleRequest(new Request('https://api.test/api/subscription'),environment)).status,401);
  assert.equal((await handleRequest(new Request('https://api.test/api/internal/poll',{method:'POST'}),environment)).status,401);
  const res=await handleRequest(new Request('https://api.test/api/movies',{headers:{Origin:'https://example.com'}}),environment);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'),'https://example.com');assert.equal((await res.json()).status,'unverified');db.sql.close();
});
test('Korean midnight and merge of different auditoriums are correct',()=>{
  assert.equal(koreaToday(new Date('2026-11-09T15:01:00Z')),'2026-11-10');
  assert.equal(normalizeSnapshot([movie(),movie()], '2026-11-09').length,1);
});
