# 의정부 영화 알림

CGV 의정부(지점 코드 `0113`)의 전체 상영관을 대상으로 한 웹 푸시 알리미입니다. 기존 Python/Discord 구현은 상위 저장소의 `v1/`에 보존되어 있습니다.

## 동작

- 현재 예매 가능한 영화 중에서 관심 있는 영화를 선택합니다. 회원가입은 없습니다.
- 모든 날짜의 전체 시간표를 5분 간격으로 확인하고 `(영화 ID, 날짜)`의 최초 개방만 감지합니다.
- 첫 성공 조회는 기준선으로 저장하고 알리지 않습니다. 신청 이전에 확인한 날짜에도 알리지 않습니다.
- 같은 날짜의 회차 추가, 좌석 수 변화, 취소표, 매진 후 재등장은 알림 대상이 아닙니다.
- HTTP/스키마 오류가 발생하면 전체 주기를 실패로 처리하고 기존 기록을 보존합니다. 오류나 변경 없는 결과는 푸시로 보내지 않습니다.
- 조회 기록, 구독, 발송 대기열을 D1에 저장합니다. 재시작 시에도 날짜별 중복을 방지합니다.
- 일시적인 푸시 오류는 재시도하고, 만료된 구독은 삭제합니다. 브라우저에서도 이벤트 ID별 수신 기록으로 중복을 억제합니다. 네트워크와 기기 특성상 정확히 한 번 수신하거나 정시에 도착하는 것을 보장하지는 않습니다.

## 현재 연결 검증 상태

2026-11-09 작업 환경에서 CGV 홈페이지·의정부 페이지·예매 페이지를 Chromium으로 직접 열었으나 모두 HTTP 403 이용 제한 화면이었습니다. 사용자의 일반 브라우저에서는 페이지가 열린다고 확인받았습니다. **이것만으로 배포 서버의 API나 웹 푸시가 검증된 것은 아닙니다.** 성공한 실제 시간표 응답 전에는 웹 화면에 연결 미확인/조회 실패를 표시합니다. 샘플을 실데이터로 대체하지 않습니다.

CGV의 공개 웹 클라이언트 계약을 참고해 다음 경로를 연결했습니다. 공식 지원 API가 아니므로 응답 변경에 맞춘 유지보수가 필요합니다.

- `GET https://cgv.co.kr/api/v1/booking/searchSiteScnscYmdListBySite?coCd=A420&siteNo=0113`
- `GET https://cgv.co.kr/api/v1/booking/searchMovScnInfo?coCd=A420&siteNo=0113&scnYmd=YYYYMMDD&rtctlScopCd=08`
- 지점 확인: <https://cgv.co.kr/cnm/bzplcCgv/0113001>
- 계약 참고: <https://github.com/Henryshin/cgv-imax-monitor/blob/main/monitor.js>, <https://github.com/reomoon/check-cgv/blob/main/cgv_api.py>

`npm run verify:cgv`는 실행한 네트워크에서 실제 연결을 확인하며, 실패하면 종료 코드 1을 반환합니다. 차단 우회, 프록시 회전, 사용자 쿠키 수집은 사용하지 않습니다.

## 개발·검증

Node.js 22 이상과 Python 3이 필요합니다.

```sh
npm ci
npm test
npm run check
npm run preview
# 다른 터미널에서, Chromium이 설치되어 있을 때:
CHROMIUM_PATH=/path/to/chromium npm run test:browser
npm run build
```

로컬 화면: `http://127.0.0.1:4173/`. API가 없으면 연결 오류가 정상 표시됩니다. `?demo=1`은 명확하게 표시한 가상 데이터 미리보기이며 실제 알림 신청은 비활성화합니다. 브라우저 QA는 푸시 권한과 발송을 모의 처리합니다.

## 배포

`public/` 또는 빌드된 `dist/client/`는 GitHub Pages에 올릴 수 있습니다. `public/config.js`의 `apiBase`에 API 서버의 HTTPS origin을 지정하고 서버의 `PUBLIC_ORIGIN`을 Pages origin과 일치시킵니다. Pages는 Python/Worker나 감시 작업을 실행하지 않습니다.

백엔드는 Cloudflare Workers + D1용이며 `wrangler.toml`에 `*/5 * * * *` Cron을 포함합니다. `wrangler d1 create cgv-alerts`로 생성한 실제 ID로 설정의 예시 ID를 바꾸고 `npm run db:remote`를 실행합니다. 필요한 환경 변수는 다음과 같습니다.

| 변수 | 용도 |
| --- | --- |
| `PUBLIC_ORIGIN` | 공개 웹사이트 origin, CORS 허용 대상 |
| `PUBLIC_URL` | 공개 웹사이트 전체 URL |
| `VAPID_PUBLIC_KEY` | 브라우저에 전달하는 공개 키 |
| `VAPID_PRIVATE_KEY` | 서버 secret으로만 저장하는 개인 키 |
| `VAPID_SUBJECT` | 운영자의 HTTPS 연락 페이지 또는 mailto 주소 |
| `POLL_TOKEN` | 외부 스케줄러의 보호된 조회 호출용 secret |
| `MAX_SUBSCRIBERS` | 기본 30개 브라우저; 예상 사용자는 약 10명 |

`npm run keys`의 출력은 공개 저장소나 채팅에 올리지 말고 개인 키와 `POLL_TOKEN`을 배포 서비스의 secrets에 저장합니다. `wrangler secret put VAPID_PRIVATE_KEY`, `wrangler secret put POLL_TOKEN`을 사용합니다.

Sites에도 `dist/server/index.js`를 배포할 수 있습니다. `.openai/hosting.json`에서 D1 논리 바인딩 `DB`를 선언하고, 생성된 `drizzle/` 마이그레이션을 함께 배포합니다. Sites에 배포한 경우 `wrangler.toml`의 Cron이 자동으로 등록된다고 가정하지 않습니다. 외부 스케줄러는 `POST /api/internal/poll`에 `Authorization: Bearer <POLL_TOKEN>`을 전달해야 합니다. GitHub Actions를 사용하면 5분 간격 예약은 가능하지만 실행 지연·누락이 있을 수 있고 공개 저장소 60일 무활동 시 비활성화될 수 있습니다.

## 규모와 한도

5분 주기는 하루 288회 실행입니다. 날짜 D개를 확인할 때 한 번에 `1 + D`번 CGV에 요청합니다. 이용자 10명이 같은 결과를 공유합니다. Workers 무료 외부 요청 수를 고려해 현재는 38일까지 한 주기에서 처리하고, 초과하면 일부를 누락시키지 않고 오류로 표시합니다. 한 번에 최대 10명에게 묶음 푸시를 보냅니다. CPU·DB·호스팅 한도와 실제 발송량을 함께 확인해야 하며 무조건 무료라고 보장하지 않습니다.

아이폰·아이패드는 지원하는 iOS에서 홈 화면에 추가한 사이트로 열고 알림을 허용해야 합니다. 기기별 수신 테스트는 실제 기기에서 수행해야 합니다.

## 라이선스

상위 프로젝트의 AGPL-3.0을 유지합니다. 원본: <https://github.com/0w0i0n0g0/cgv-open-push>. 빌드할 때 `public/source.zip`으로 이 버전의 소스와 라이선스를 제공하며 비밀값은 포함하지 않습니다.
