import { dateKey, findNewDates, koreaToday, normalizeSnapshot } from './detection.mjs';

export async function readState(db) {
  const { results } = await db.prepare('SELECT key, value FROM state').all();
  return Object.fromEntries(results.map(row => [row.key, row.value]));
}

export function stateStatement(db, key, value) {
  return db.prepare('INSERT INTO state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, String(value));
}

export async function acquirePollLock(db, now) {
  return !!await db.prepare(`INSERT INTO state(key, value) VALUES('poll_lock', ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER) <= ? RETURNING key`).bind(String(now + 240_000), now).first();
}

export async function applySnapshot(db, input, now = Date.now()) {
  const today = koreaToday(new Date(now));
  const snapshot = normalizeSnapshot(input, today);
  const [state, { results }] = await Promise.all([
    readState(db), db.prepare('SELECT movie_id, play_date FROM seen_dates WHERE play_date >= ?').bind(today).all(),
  ]);
  const seen = new Set(results.map(row => dateKey(row.movie_id, row.play_date)));
  const change = findNewDates(snapshot, seen, state.initialized === '1');
  const baseline = JSON.stringify(change.baseline);
  const events = JSON.stringify(change.notifications);
  // These statements commit together. A crash cannot record a date without its
  // pending deliveries, and a restart cannot send all existing dates again.
  await db.batch([
    db.prepare("UPDATE movies SET dates='[]', bookable_dates='[]'"),
    db.prepare(`INSERT INTO movies(id, title, dates, bookable_dates, updated_at)
      SELECT json_extract(value, '$.id'), json_extract(value, '$.title'), json_extract(value, '$.dates'), json_extract(value, '$.bookableDates'), ? FROM json_each(?) WHERE 1
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, dates=excluded.dates, bookable_dates=excluded.bookable_dates, updated_at=excluded.updated_at`).bind(now, JSON.stringify(snapshot)),
    db.prepare(`INSERT OR IGNORE INTO seen_dates(movie_id, play_date, first_seen_at)
      SELECT json_extract(value, '$.movieId'), json_extract(value, '$.date'), ? FROM json_each(?)`).bind(now, baseline),
    db.prepare(`INSERT OR IGNORE INTO deliveries(id, token_hash, movie_id, play_date, title, created_at)
      SELECT w.token_hash || ':' || json_extract(e.value, '$.movieId') || ':' || json_extract(e.value, '$.date'), w.token_hash,
        json_extract(e.value, '$.movieId'), json_extract(e.value, '$.date'), json_extract(e.value, '$.title'), ?
      FROM json_each(?) e JOIN watches w ON w.movie_id=json_extract(e.value, '$.movieId') WHERE w.created_at <= ?`).bind(now, events, now),
    stateStatement(db, 'initialized', '1'), stateStatement(db, 'last_success', now), stateStatement(db, 'last_error', ''),
    db.prepare('DELETE FROM deliveries WHERE play_date < ?').bind(today),
    db.prepare('DELETE FROM seen_dates WHERE play_date < ?').bind(today),
  ]);
  return change.notifications;
}

export async function getCatalog(db) {
  const [state, { results }] = await Promise.all([readState(db), db.prepare('SELECT * FROM movies ORDER BY title').all()]);
  const today = koreaToday();
  return { state, movies: results.map(row => ({ id: row.id, title: row.title, dates: JSON.parse(row.dates).filter(d => d >= today), bookableDates: JSON.parse(row.bookable_dates).filter(d => d >= today) })) };
}

export async function saveSubscription(db, tokenHash, subscription, movieIds, maxSubscribers, now = Date.now()) {
  const existing = await db.prepare('SELECT token_hash FROM subscribers WHERE token_hash=?').bind(tokenHash).first();
  if (!existing) {
    const count = await db.prepare('SELECT COUNT(*) AS count FROM subscribers').first();
    if (count.count >= maxSubscribers) throw Object.assign(new Error('현재 알림 신청 인원이 가득 찼어요.'), { status: 409 });
  }
  const known = await db.prepare(`SELECT COUNT(*) AS count FROM movies WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(movieIds)).first();
  if (known.count !== movieIds.length) throw Object.assign(new Error('영화 목록을 새로고침한 뒤 다시 선택해 주세요.'), { status: 400 });
  // An endpoint is never transferred to a different bearer token.
  const owner = await db.prepare('SELECT token_hash FROM subscribers WHERE endpoint=?').bind(subscription.endpoint).first();
  if (owner && owner.token_hash !== tokenHash) throw Object.assign(new Error('기존 브라우저 알림을 해제한 뒤 다시 신청해 주세요.'), { status: 409 });
  await db.batch([
    db.prepare(`INSERT INTO subscribers(token_hash, endpoint, subscription, created_at) VALUES(?, ?, ?, ?)
      ON CONFLICT(token_hash) DO UPDATE SET endpoint=excluded.endpoint, subscription=excluded.subscription`).bind(tokenHash, subscription.endpoint, JSON.stringify(subscription), now),
    db.prepare('DELETE FROM watches WHERE token_hash=? AND movie_id NOT IN (SELECT value FROM json_each(?))').bind(tokenHash, JSON.stringify(movieIds)),
    db.prepare(`INSERT OR IGNORE INTO watches(token_hash, movie_id, created_at) SELECT ?, value, ? FROM json_each(?)`).bind(tokenHash, now, JSON.stringify(movieIds)),
    db.prepare(`DELETE FROM deliveries WHERE token_hash=? AND sent_at IS NULL AND movie_id NOT IN (SELECT value FROM json_each(?))`).bind(tokenHash, JSON.stringify(movieIds)),
  ]);
}
