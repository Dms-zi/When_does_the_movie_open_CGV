export const THEATER = Object.freeze({ id: '0113', name: 'CGV 의정부', url: 'https://cgv.co.kr/cnm/bzplcCgv/0113001' });
export const INTERVAL_SECONDS = 300;

export function koreaToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function normalizeDate(value) {
  const text = String(value ?? '');
  const date = /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('CGV 응답의 날짜 형식이 변경되었습니다.');
  }
  return date;
}

// Reject a broken response; never turn a failed fetch into an empty snapshot.
export function normalizeSnapshot(input, today = koreaToday()) {
  if (!Array.isArray(input)) throw new Error('영화 목록 형식이 올바르지 않습니다.');
  const movies = new Map();
  for (const item of input) {
    if (typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || !item.title.trim() || !Array.isArray(item.dates) || !Array.isArray(item.bookableDates)) {
      throw new Error('영화 정보 형식이 올바르지 않습니다.');
    }
    const dates = item.dates.map(normalizeDate).filter(date => date >= today);
    const bookableDates = item.bookableDates.map(normalizeDate).filter(date => date >= today);
    if (bookableDates.some(date => !dates.includes(date))) throw new Error('예매 가능 날짜와 상영 날짜가 일치하지 않습니다.');
    const previous = movies.get(item.id);
    movies.set(item.id, {
      id: item.id, title: item.title.trim(),
      dates: [...new Set([...(previous?.dates ?? []), ...dates])].sort(),
      bookableDates: [...new Set([...(previous?.bookableDates ?? []), ...bookableDates])].sort(),
    });
  }
  return [...movies.values()];
}

export function dateKey(movieId, date) { return JSON.stringify([movieId, date]); }

// The durable set is monotonic: a sold-out/disappeared date is never forgotten.
export function findNewDates(snapshot, seen, initialized) {
  const additions = [];
  for (const movie of snapshot) {
    for (const date of movie.dates) {
      if (!seen.has(dateKey(movie.id, date))) additions.push({ movieId: movie.id, title: movie.title, date });
    }
  }
  return { baseline: additions, notifications: initialized ? additions : [] };
}
