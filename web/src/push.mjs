import { buildPushPayload } from '@block65/webcrypto-web-push';
import { koreaToday } from './detection.mjs';

export async function sha256(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validateSubscription(subscription) {
  let url;
  try { url = new URL(subscription?.endpoint); } catch { throw new Error('브라우저 알림 주소가 올바르지 않습니다.'); }
  const hosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'];
  const allowed = hosts.includes(url.hostname) || url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com');
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !allowed || url.href.length > 2048) throw new Error('지원하지 않는 브라우저 알림 주소입니다.');
  function validKey(value, size) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return false;
    try { return atob(value.replaceAll('-', '+').replaceAll('_', '/')).length === size; } catch { return false; }
  }
  if (!validKey(subscription.keys?.p256dh, 65) || !validKey(subscription.keys?.auth, 16)) throw new Error('브라우저 알림 키가 올바르지 않습니다.');
  return { endpoint: url.href, expirationTime: subscription.expirationTime ?? null, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } };
}

export function pushConfigured(env) {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && /^mailto:|^https:\/\//.test(env.VAPID_SUBJECT ?? '') && /^https?:\/\//.test(env.PUBLIC_URL ?? ''));
}

export async function sendPush(subscription, data, env) {
  const payload = await buildPushPayload({ data, options: { ttl: 3600 } }, subscription, {
    subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY,
  });
  return fetch(subscription.endpoint, { ...payload, redirect: 'error', signal: AbortSignal.timeout(10_000) });
}

export async function flushPending(db, env, sender = sendPush, now = Date.now()) {
  if (!pushConfigured(env)) return;
  const { results } = await db.prepare(`SELECT d.*, s.subscription FROM deliveries d JOIN subscribers s USING(token_hash)
    JOIN watches w ON w.token_hash=d.token_hash AND w.movie_id=d.movie_id
    WHERE d.sent_at IS NULL AND d.attempts < 6 AND d.next_attempt_at <= ? AND d.claimed_until <= ? AND d.play_date >= ?
    ORDER BY d.created_at, d.id LIMIT 200`).bind(now, now, koreaToday(new Date(now))).all();
  const groups = new Map();
  for (const row of results) {
    if (!groups.has(row.token_hash)) groups.set(row.token_hash, []);
    groups.get(row.token_hash).push(row);
  }
  for (const [tokenHash, rows] of [...groups].slice(0, 10)) {
    const chosen = [];
    const data = { events: [], url: env.PUBLIC_URL };
    for (const row of rows) {
      const event = { id: `${row.movie_id}:${row.play_date}`, movieId: row.movie_id, title: row.title, date: row.play_date };
      const candidate = { ...data, events: [...data.events, event] };
      if (new TextEncoder().encode(JSON.stringify(candidate)).length > 3500) break;
      chosen.push(row); data.events.push(event);
    }
    if (!chosen.length) continue;
    const ids = JSON.stringify(chosen.map(row => row.id));
    const claim = await db.prepare(`UPDATE deliveries SET claimed_until=? WHERE id IN (SELECT value FROM json_each(?)) AND claimed_until <= ? AND sent_at IS NULL RETURNING id`).bind(now + 120_000, ids, now).all();
    if (!claim.results.length) continue;
    const claimedIds = new Set(claim.results.map(row => row.id));
    const claimedRows = chosen.filter(row => claimedIds.has(row.id));
    data.events = data.events.filter((_, index) => claimedIds.has(chosen[index].id));
    const claimedJson = JSON.stringify([...claimedIds]);
    try {
      const response = await sender(JSON.parse(claimedRows[0].subscription), data, env);
      if (response.status === 404 || response.status === 410) {
        await db.prepare('DELETE FROM subscribers WHERE token_hash=?').bind(tokenHash).run();
      } else if (response.ok) {
        await db.prepare('UPDATE deliveries SET sent_at=?, claimed_until=0 WHERE id IN (SELECT value FROM json_each(?))').bind(now, claimedJson).run();
      } else {
        throw new Error(`Push HTTP ${response.status}`);
      }
    } catch {
      const attempts = Math.max(...claimedRows.map(row => row.attempts)) + 1;
      await db.prepare(`UPDATE deliveries SET attempts=attempts+1, next_attempt_at=?, claimed_until=0 WHERE id IN (SELECT value FROM json_each(?))`).bind(now + Math.min(3600, 300 * 2 ** (attempts - 1)) * 1000, claimedJson).run();
    }
  }
}
