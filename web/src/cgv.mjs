import { THEATER, koreaToday, normalizeDate, normalizeSnapshot } from './detection.mjs';

const BASE = 'https://cgv.co.kr/api/v1/booking/';
// Reserve external requests for up to ten push recipients on Workers Free.
const MAX_DATES = 38;

async function cgvRequest(path, params, fetcher, signal) {
  const url = new URL(path, BASE);
  url.search = new URLSearchParams({ coCd: 'A420', siteNo: THEATER.id, ...params });
  const response = await fetcher(url, {
    headers: { Accept: 'application/json', Referer: 'https://cgv.co.kr/cnm/movieBook/ticket' },
    redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) throw new Error(`CGV 조회 실패 (HTTP ${response.status}). 기존 알림 기록을 유지합니다.`);
  let body;
  try { body = await response.json(); } catch { throw new Error('CGV가 상영정보 대신 다른 페이지를 반환했습니다.'); }
  if (body?.statusCode !== 0 || !Array.isArray(body.data)) throw new Error('CGV 응답 형식이 변경되었거나 조회가 거절되었습니다.');
  return body.data;
}

export function sessionsToMovies(sessions, requestedDate, now = new Date()) {
  const date = normalizeDate(requestedDate);
  const today = koreaToday(now);
  const localNow = new Date(now.getTime() + 9 * 3600_000);
  const minute = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
  return sessions.map(row => {
    if (row.siteNo != null && String(row.siteNo) !== THEATER.id) throw new Error('의정부 이외 지점의 응답을 받았습니다.');
    if (normalizeDate(row.scnYmd) !== date) throw new Error('요청 날짜와 시간표 날짜가 다릅니다.');
    if (!row.movNo || typeof (row.movNm ?? row.expoProdNm) !== 'string') throw new Error('CGV 시간표에 영화 식별 정보가 없습니다.');
    const seats = Number(row.frSeatCnt);
    if (row.frSeatCnt == null || row.frSeatCnt === '' || !Number.isFinite(seats) || seats < 0) throw new Error('CGV 잔여 좌석 형식을 확인할 수 없습니다.');
    if (row.cntlYn != null && !['N', 'Y'].includes(row.cntlYn)) throw new Error('CGV 예매 제어 상태를 확인할 수 없습니다.');
    const time = String(row.salEndTm ?? row.scnsrtTm ?? '');
    if (!/^\d{4}$/.test(time) || Number(time.slice(2)) > 59) throw new Error('CGV 예매 마감 시각을 확인할 수 없습니다.');
    const future = date > today || (date === today && Number(time.slice(0, 2)) * 60 + Number(time.slice(2)) > minute);
    const open = row.cntlYn !== 'Y' && future;
    return { id: String(row.movNo), title: row.movNm ?? row.expoProdNm, dates: open ? [date] : [], bookableDates: open && seats > 0 ? [date] : [] };
  });
}

// This public website contract must be verified from the deployment network.
// No cookies, credentials, proxy rotation or challenge bypass is used.
export async function fetchCgvSnapshot({ fetcher = fetch, now = new Date(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const signal = AbortSignal.timeout(180_000);
  const rawDates = await cgvRequest('searchSiteScnscYmdListBySite', {}, fetcher, signal);
  const dates = [...new Set(rawDates.map(row => normalizeDate(row.scnYmd)))].filter(date => date >= koreaToday(now)).sort();
  if (dates.length > MAX_DATES) throw new Error(`예매 날짜가 ${MAX_DATES}일을 초과해 분할 조회 설정이 필요합니다. 일부 날짜만으로 알림을 판단하지 않습니다.`);
  const movies = [];
  for (const date of dates) {
    await pause(1000);
    const sessions = await cgvRequest('searchMovScnInfo', { scnYmd: date.replaceAll('-', ''), rtctlScopCd: '08' }, fetcher, signal);
    movies.push(...sessionsToMovies(sessions, date, now));
  }
  return normalizeSnapshot(movies, koreaToday(now));
}
