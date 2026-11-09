const $ = id => document.getElementById(id);
const apiBase = (window.CGV_CONFIG?.apiBase || '').replace(/\/$/, '');
const demo = new URLSearchParams(location.search).get('demo') === '1';
const selected = new Set();
let catalog = null, movies = [], active = false, filter = 'all', busy = false, registration, token;
const saved = new Set();
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const supportsPush = isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function feedback(message, error = false) { $('feedback').textContent = message; $('feedback').classList.toggle('error', error); }
function base64(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function getToken() {
  if (token) return token;
  try { token = localStorage.getItem('cgv-client-token'); } catch { /* private browsing */ }
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) {
    token = base64(crypto.getRandomValues(new Uint8Array(32)));
    try { localStorage.setItem('cgv-client-token', token); } catch { throw new Error('브라우저 저장공간을 사용할 수 없어 알림 설정을 저장하지 못했어요. 일반 브라우저 창에서 열어주세요.'); }
  }
  return token;
}
async function api(path, options = {}, authenticated = false) {
  const headers = { ...options.headers };
  if (authenticated) headers.Authorization = `Bearer ${getToken()}`;
  const response = await fetch(`${apiBase}${path}`, { ...options, headers, signal: AbortSignal.timeout(20_000), cache: 'no-store' });
  let data;
  try { data = await response.json(); } catch { throw new Error('상영정보 서버에 연결하지 못했어요. 잠시 후 다시 확인해 주세요.'); }
  if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했어요.');
  return data;
}
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function dateLabel(date) { return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(`${date}T12:00:00+09:00`)); }
function toggle(id) { selected.has(id) ? selected.delete(id) : selected.add(id); feedback(''); render(); }

function render() {
  const query = $('search').value.trim().toLocaleLowerCase('ko-KR');
  const bookable = movies.filter(movie => movie.bookableDates.length);
  const visible = movies.filter(movie => (filter === 'watching' ? selected.has(movie.id) : movie.bookableDates.length > 0) && movie.title.toLocaleLowerCase('ko-KR').includes(query));
  $('movie-count').textContent = String(bookable.length);
  $('selected-count').textContent = String(selected.size);
  $('movie-grid').replaceChildren();
  visible.forEach((movie, index) => {
    const card = element('button', `movie-card${selected.has(movie.id) ? ' selected' : ''}`);
    card.type = 'button'; card.setAttribute('aria-pressed', String(selected.has(movie.id))); card.setAttribute('aria-label', `${movie.title} 알림 ${selected.has(movie.id) ? '선택 해제' : '선택'}`);
    const top = element('div', 'card-top');
    top.append(element('span', 'movie-mark', `MOVIE ${String(index + 1).padStart(2, '0')}`), element('span', 'check', '✓'));
    const chips = element('div', 'date-chips');
    movie.bookableDates.slice(0, 3).forEach(date => chips.append(element('span', 'date-chip', dateLabel(date))));
    if (movie.bookableDates.length > 3) chips.append(element('span', 'date-chip', `+${movie.bookableDates.length - 3}일`));
    card.append(top, element('h3', '', movie.title), element('p', 'date-label', movie.bookableDates.length ? '현재 예매 가능한 날짜' : '지금은 예매 가능한 날짜가 없어요'), chips);
    card.addEventListener('click', () => toggle(movie.id)); $('movie-grid').append(card);
  });
  $('empty').hidden = visible.length > 0;
  if (!catalog || catalog.status === 'unverified') {
    $('empty-title').textContent = '상영정보 연결을 확인하고 있어요';
    $('empty-message').textContent = '아직 CGV에서 상영정보를 가져오지 못했어요.\n연결이 확인되면 실제 영화 목록이 표시됩니다.';
  } else if (query) {
    $('empty-title').textContent = '검색한 영화가 없어요'; $('empty-message').textContent = '다른 제목으로 검색해 주세요.';
  } else if (filter === 'watching') {
    $('empty-title').textContent = '기다리는 영화를 골라주세요'; $('empty-message').textContent = '예매 가능한 영화에서 작품을 누르면 여기에 모아볼 수 있어요.';
  } else {
    $('empty-title').textContent = '지금은 예매 가능한 영화가 없어요'; $('empty-message').textContent = '다음 확인 때 다시 살펴볼게요. 이미 신청한 알림은 유지됩니다.';
  }
  $('selection-list').replaceChildren();
  if (!selected.size) $('selection-list').append(element('p', 'muted', '기다리는 영화를 골라주세요.'));
  for (const id of selected) {
    const movie = movies.find(item => item.id === id);
    const row = element('div', 'selected-row');
    const remove = element('button', 'remove-selection', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `${movie?.title || '영화'} 선택 해제`); remove.addEventListener('click', () => toggle(id));
    row.append(element('span', '', movie?.title || '선택한 영화'), remove); $('selection-list').append(row);
  }
  const changed = selected.size !== saved.size || [...selected].some(id => !saved.has(id));
  $('enable').disabled = busy || demo || (!selected.size && !active) || !catalog?.pushReady || catalog?.status !== 'ok' || !supportsPush || (ios && !standalone) || (active && !changed);
  $('enable').textContent = busy ? '설정하고 있어요…' : demo ? '미리보기에서는 알림을 보낼 수 없어요' : active && !changed ? `${saved.size}편의 새 날짜를 기다리고 있어요` : active ? '선택한 영화 저장' : selected.size ? `알림 켜기 · ${selected.size}편` : '영화를 먼저 선택해 주세요';
  $('disable').hidden = !active; $('disable').disabled = busy;
  $('ios-help').hidden = !ios || standalone;
  if (!supportsPush && !(ios && !standalone)) $('push-help').textContent = '이 브라우저는 웹 알림을 지원하지 않아요. 지원하는 최신 브라우저에서 열어주세요.';
  else if (catalog && !catalog.pushReady && !demo) $('push-help').textContent = '아직 알림 연결을 준비하고 있어요. 연결이 완료되면 신청할 수 있습니다.';
  else if (active) $('push-help').textContent = '설정은 이 브라우저에 연결됩니다. 알림 수신은 기기·브라우저 설정의 영향을 받아요.';
}

async function loadMovies() {
  $('refresh').disabled = true;
  try {
    if (demo) {
      const day = offset => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
      catalog = { status: 'ok', lastCheckedAt: Date.now(), pushReady: false, movies: ['푸른 밤의 여행', '우리가 만난 계절', '달빛 아래 우체국', '작은 우주의 기록'].map((title, index) => ({ id: `demo-${index}`, title, dates: [day(1), day(2)], bookableDates: [day(1), day(2)] })) };
    } else {
      catalog = await api('/api/movies');
      if (!Array.isArray(catalog.movies) || catalog.movies.some(movie => typeof movie.id !== 'string' || !Array.isArray(movie.bookableDates))) throw new Error('상영정보 형식을 확인하지 못했어요.');
    }
    movies = catalog.movies;
    $('connection').className = `connection ${catalog.status === 'ok' ? 'ok' : 'error'}`;
    const time = catalog.lastCheckedAt ? new Intl.DateTimeFormat('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Seoul' }).format(new Date(catalog.lastCheckedAt)) : '성공한 조회 없음';
    $('connection-text').textContent = demo ? '미리보기용 예시 정보' : catalog.status === 'ok' ? `마지막 확인 ${time} · 5분 간격 확인` : `${catalog.message || '최근 조회가 지연되고 있어요.'} · 마지막 확인: ${time}`;
  } catch (error) {
    if (catalog) catalog.status = 'stale';
    $('connection').className = 'connection error';
    $('connection-text').textContent = `${error.message || '연결에 실패했어요.'}${catalog?.lastCheckedAt ? ' 이전 조회 결과를 표시합니다.' : ''}`;
  } finally { $('refresh').disabled = false; render(); }
}

async function restore() {
  try {
    const result = await api('/api/subscription', {}, true);
    active = result.active; saved.clear(); selected.clear();
    for (const id of result.movieIds) { saved.add(id); selected.add(id); }
  } catch { /* The movie connection state already reports connectivity issues. */ }
  render();
}

$('enable').addEventListener('click', async () => {
  if (busy || demo) return;
  busy = true; feedback(''); render();
  let createdSubscription;
  try {
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('알림이 허용되지 않았어요. 브라우저의 사이트 설정에서 알림을 허용해 주세요.');
    }
    registration ||= await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const key = Uint8Array.from(atob(catalog.publicKey.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      createdSubscription = subscription;
    }
    const result = await api('/api/subscription', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({subscription:subscription.toJSON(), movieIds:[...selected]}) }, true);
    active = result.active; saved.clear(); result.movieIds.forEach(id => saved.add(id));
    feedback('저장했어요. 지금 열려 있는 날짜는 알리지 않고, 새 날짜가 열릴 때 알려드릴게요.');
  } catch (error) {
    if (createdSubscription) await createdSubscription.unsubscribe().catch(() => {});
    feedback(error.message || '알림 설정에 실패했어요. 다시 시도해 주세요.', true);
  } finally { busy = false; render(); }
});
$('disable').addEventListener('click', async () => {
  busy = true; render();
  try {
    await api('/api/subscription', {method:'DELETE'}, true);
    const sub = await registration?.pushManager.getSubscription(); if (sub) await sub.unsubscribe();
    active = false; saved.clear(); feedback('이 브라우저의 모든 영화 알림을 껐어요.');
  } catch (error) { feedback(error.message, true); }
  finally { busy = false; render(); }
});
$('refresh').addEventListener('click', loadMovies);
$('search').addEventListener('input', render);
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  render();
}));
$('demo-banner').hidden = !demo;
if ('serviceWorker' in navigator && !demo) navigator.serviceWorker.register('./sw.js', {scope:'./'}).then(value => {registration=value;}).catch(() => feedback('알림 기능을 시작하지 못했어요. 페이지를 다시 열어주세요.', true));
await loadMovies();
if (!demo) await restore();
setInterval(() => { if (!document.hidden && !demo && !catalog?.collectionPaused) loadMovies(); }, 300_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !demo && !catalog?.collectionPaused) loadMovies(); });
