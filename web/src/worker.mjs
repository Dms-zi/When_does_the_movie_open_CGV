import { fetchCgvSnapshot } from './cgv.mjs';
import { INTERVAL_SECONDS, THEATER, koreaToday } from './detection.mjs';
import { acquirePollLock, applySnapshot, getCatalog, readState, saveSubscription, stateStatement } from './store.mjs';
import { flushPending, pushConfigured, sha256, validateSubscription } from './push.mjs';

const STALE_AFTER_MS = 15 * 60_000;
const PAUSED_MESSAGE = '현재 상영정보 자동 조회를 중지했습니다.';
const collectionEnabled = env => env.CGV_COLLECTION_ENABLED === 'true';
const failure = (message, status = 400) => Object.assign(new Error(message), { status });

async function bearerHash(request) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) throw failure('이 브라우저의 알림 등록 정보를 확인할 수 없어요.', 401);
  return sha256(token);
}

async function jsonBody(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw failure('JSON 요청이 필요합니다.', 415);
  // Stream the limit instead of trusting Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw failure('요청 내용이 없습니다.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) { await reader.cancel(); throw failure('요청 내용이 너무 큽니다.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw failure('JSON 형식이 올바르지 않습니다.'); }
}

export async function handleRequest(request, env) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
  const origin = request.headers.get('Origin');
  const allowedOrigins = (env.PUBLIC_ORIGIN || '').split(',').map(value => value.trim());
  if (origin && allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
  try {
    if (origin && !allowedOrigins.includes(origin)) throw failure('허용되지 않은 웹사이트의 요청입니다.', 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' } });
    if (!env.DB) throw failure('상영정보 연결을 준비하고 있어요.', 503);
    const path = new URL(request.url).pathname;
    if (path === '/api/internal/poll' && request.method === 'POST') {
      const supplied = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
      if (!env.POLL_TOKEN || await sha256(supplied) !== await sha256(env.POLL_TOKEN)) throw failure('인증이 필요합니다.', 401);
      if (!collectionEnabled(env)) throw failure(PAUSED_MESSAGE, 503);
      await runMonitor(env);
      const state = await readState(env.DB);
      return respond({ lastCheckedAt: Number(state.last_success) || null, error: state.last_error || null }, state.last_error ? 503 : 200);
    }
    if (path === '/api/movies' && request.method === 'GET') {
      const { state, movies } = await getCatalog(env.DB);
      const lastCheckedAt = state.last_success ? Number(state.last_success) : null;
      return respond({
        theater: THEATER, movies, intervalSeconds: INTERVAL_SECONDS, lastCheckedAt, collectionPaused: !collectionEnabled(env),
        status: !lastCheckedAt ? 'unverified' : !collectionEnabled(env) || state.last_error || Date.now() - lastCheckedAt > STALE_AFTER_MS ? 'stale' : 'ok',
        message: !collectionEnabled(env) ? PAUSED_MESSAGE : state.last_error || (!lastCheckedAt ? '아직 CGV 상영정보 연결을 확인하지 못했어요.' : ''),
        pushReady: collectionEnabled(env) && pushConfigured(env), publicKey: env.VAPID_PUBLIC_KEY || null,
      });
    }
    if (path === '/api/subscription') {
      const tokenHash = await bearerHash(request);
      if (request.method === 'GET') {
        const subscriber = await env.DB.prepare('SELECT token_hash FROM subscribers WHERE token_hash=?').bind(tokenHash).first();
        const { results } = await env.DB.prepare('SELECT movie_id FROM watches WHERE token_hash=? ORDER BY movie_id').bind(tokenHash).all();
        return respond({ active: !!subscriber, movieIds: results.map(row => row.movie_id) });
      }
      if (!origin || !allowedOrigins.includes(origin)) throw failure('웹사이트에서 알림을 설정해 주세요.', 403);
      if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM subscribers WHERE token_hash=?').bind(tokenHash).run();
        return respond({ active: false });
      }
      if (request.method === 'PUT') {
        if (!collectionEnabled(env)) throw failure(PAUSED_MESSAGE, 503);
        if (!pushConfigured(env)) throw failure('아직 알림 연결을 준비하고 있어요.', 503);
        const state = await readState(env.DB);
        if (!state.last_success || state.last_error || Date.now() - Number(state.last_success) > STALE_AFTER_MS) throw failure('최신 상영정보를 확인한 뒤 알림을 신청할 수 있어요.', 503);
        const body = await jsonBody(request);
        let subscription;
        try { subscription = validateSubscription(body.subscription); } catch (error) { throw failure(error.message); }
        if (!Array.isArray(body.movieIds) || body.movieIds.length > 30 || body.movieIds.some(id => typeof id !== 'string' || !id || id.length > 80)) throw failure('알림 받을 영화 목록을 확인해 주세요.');
        const ids = [...new Set(body.movieIds)];
        await saveSubscription(env.DB, tokenHash, subscription, ids, Number(env.MAX_SUBSCRIBERS) || 30);
        return respond({ active: true, movieIds: ids });
      }
    }
    throw failure('요청한 페이지를 찾을 수 없습니다.', 404);
  } catch (error) {
    if (!error.status) console.error('API operation failed:', error.name);
    return respond({ error: error.status ? error.message : '연결 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' }, error.status || 500);
  }
}

export async function runMonitor(env, provider = fetchCgvSnapshot, sender, now = Date.now()) {
  if (!collectionEnabled(env)) return;
  if (!await acquirePollLock(env.DB, now)) return;
  try {
    const state = await readState(env.DB);
    if (state.poll_blocked || Number(state.poll_retry_at || 0) > now) return;
    if (state.poll_last_attempt && now - Number(state.poll_last_attempt) < INTERVAL_SECONDS * 1000) return;
    const day = koreaToday(new Date(now));
    const count = state.poll_day === day ? Number(state.poll_count || 0) : 0;
    if (count >= 288) return;
    await env.DB.batch([
      stateStatement(env.DB, 'poll_last_attempt', now),
      stateStatement(env.DB, 'poll_day', day),
      stateStatement(env.DB, 'poll_count', count + 1),
    ]);
    try {
      const snapshot = await provider();
      await applySnapshot(env.DB, snapshot, now);
      await env.DB.batch([stateStatement(env.DB, 'poll_failures', '0'), stateStatement(env.DB, 'poll_retry_at', '0')]);
    } catch (error) {
      const blocked = [403, 429].includes(error.cgvStatus);
      const failures = Math.min(Number(state.poll_failures || 0) + 1, 5);
      const message = blocked ? `CGV 조회가 거절되어 자동 확인을 중지했습니다 (HTTP ${error.cgvStatus}).`
        : /[가-힣]/.test(error.message) ? error.message.slice(0, 240) : '상영정보 조회 중 문제가 생겼어요. 잠시 후 다시 확인해 주세요.';
      await env.DB.batch([
        stateStatement(env.DB, 'last_error', message),
        stateStatement(env.DB, 'poll_failures', failures),
        stateStatement(env.DB, 'poll_retry_at', now + Math.min(3600_000, 300_000 * 2 ** (failures - 1))),
        ...(blocked ? [stateStatement(env.DB, 'poll_blocked', error.cgvStatus)] : []),
      ]);
      console.error('CGV monitor failed:', error.message);
      if (blocked) return;
    }
    // Retry already confirmed openings even if this poll failed. Never send a
    // health-check, unchanged-snapshot or scraper-error notification.
    await flushPending(env.DB, env, sender, now);
  } finally {
    await stateStatement(env.DB, 'poll_lock', '0').run();
  }
}

export default {
  fetch: handleRequest,
  scheduled(_event, env, ctx) { ctx.waitUntil(runMonitor(env)); },
};
