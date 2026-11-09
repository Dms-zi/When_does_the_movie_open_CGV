const date = document.querySelector('#date');
const button = document.querySelector('#check');
const result = document.querySelector('#result');
const direct = document.querySelector('#direct');
const cooldown = 5 * 60 * 1000;
const storageKey = 'cgv-direct-connection-last-attempt';
let lastAttempt = 0;
let busy = false;
try { lastAttempt = Number(localStorage.getItem(storageKey)) || 0; } catch {}

date.value = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

function requestUrl() {
  if (!date.validity.valid || !/^\d{4}-\d{2}-\d{2}$/.test(date.value)) return null;
  const url = new URL('https://cgv.co.kr/api/v1/booking/searchMovScnInfo');
  url.search = new URLSearchParams({coCd:'A420', siteNo:'0113', scnYmd:date.value.replaceAll('-', ''), rtctlScopCd:'08'});
  return url.href;
}

function refreshControls() {
  const remaining = Math.max(0, lastAttempt + cooldown - Date.now());
  const url = requestUrl();
  if (url) direct.href = url;
  else direct.removeAttribute('href');
  button.disabled = busy || remaining > 0 || !url;
  button.textContent = busy ? 'CGV 응답을 확인하고 있습니다…' : remaining > 0
    ? `${Math.ceil(remaining / 1000)}초 뒤에 다시 검사할 수 있습니다` : '이 브라우저에서 조회하기';
}

date.addEventListener('input', refreshControls);
setInterval(refreshControls, 1000); // Updates the countdown only; never makes a request.
refreshControls();

button.addEventListener('click', async () => {
  const url = requestUrl();
  // Re-read the shared cooldown in case another tab has just run the check.
  try { lastAttempt = Math.max(lastAttempt, Number(localStorage.getItem(storageKey)) || 0); } catch {}
  if (busy || !url || Date.now() < lastAttempt + cooldown) { refreshControls(); return; }
  lastAttempt = Date.now();
  try { localStorage.setItem(storageKey, String(lastAttempt)); } catch {}
  busy = true;
  refreshControls();
  result.textContent = '조회 중…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const details = [`검사 시각: ${new Date(lastAttempt).toISOString()}`, `페이지: ${location.origin}`, `상영 날짜: ${date.value}`];
  try {
    const response = await fetch(url, {
      method:'GET', mode:'cors', credentials:'omit', redirect:'error', cache:'no-store',
      headers:{Accept:'application/json'}, signal:controller.signal,
    });
    details.push(`HTTP 상태: ${response.status}`);
    if (!response.ok) {
      details.push('CGV가 정상 상영시간표를 반환하지 않았습니다. 자동 재시도하지 않습니다.');
    } else {
      let body;
      try { body = await response.json(); } catch {}
      if (body?.statusCode === 0 && Array.isArray(body.data)) {
        const ownRows = body.data.filter(row => row?.siteNo === '0113');
        if (ownRows.length !== body.data.length) {
          details.push('JSON은 읽었지만 의정부 상영시간표 형식과 일치하지 않습니다.');
        } else {
          details.push('성공: 이 웹페이지에서 CGV JSON을 직접 읽었습니다.',
            `의정부 상영 회차: ${ownRows.length}개`,
            `영화: ${new Set(ownRows.map(row => row.movNo).filter(Boolean)).size}편`,
            '이 결과는 한 번의 웹 조회 성공이며, 지속적인 조회나 iOS 앱 실행을 보장하지 않습니다.');
        }
      } else {
        details.push('응답은 읽었지만 정상 CGV 상영시간표 JSON이 아닙니다.');
      }
    }
  } catch {
    details.push(controller.signal.aborted ? '실패: 15초 안에 응답을 읽지 못했습니다.' : '실패: 이 웹페이지에서 CGV 응답을 읽지 못했습니다.',
      'HTTP 상태: 브라우저에서 확인할 수 없음',
      'CORS 제한, 네트워크 오류, 서버의 요청 거부 등이 원인일 수 있습니다.',
      '아래의 새 탭 링크와 비교해 주세요. 이 실패만으로 iOS 앱도 접근할 수 없다고 판단할 수는 없습니다.');
  } finally {
    clearTimeout(timeout);
    result.textContent = details.join('\n');
    busy = false;
    refreshControls();
  }
});
