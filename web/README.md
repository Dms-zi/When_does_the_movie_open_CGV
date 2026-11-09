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

2026-11-09 기준, 사용자 브라우저에서는 CGV가 열리지만 작업 환경과 배포 서버의 자동 조회는 HTTP 403으로 거절됩니다. 사용자가 제공한 응답의 필수 항목은 현재 파서에서 8개 관·46회차·16개 영화로 처리됐습니다. 이는 실시간 서버 연결 검증이 아닙니다. **현재 자동 조회를 중지했고, 실제 영화 목록과 알림 신청은 사용할 수 없습니다. 기기 푸시 수신도 검증 전입니다.**

CGV 약관 제11조 제4항 제19호에는 사전 승낙 없는 정보 복제·유통·제3자 제공을 제한하는 내용이 있습니다. 공개 API 응답이 보인다는 사실만으로 이 서비스의 운영이 허용된다고 판단하지 않습니다. 자동 조회와 공개 알림 제공의 허용 범위·호출 한도를 먼저 확인해야 합니다. [CGV 약관](https://cgv.co.kr/mem/login?nmbrAtktFlag=N)

`CGV_COLLECTION_ENABLED`의 기본값은 `false`이며, 이 상태에서는 예약 작업과 수동 호출 모두 CGV 조회·푸시 발송을 하지 않습니다. GitHub 예약 조회와 Workers Cron도 껐습니다. 화면 새로고침은 저장된 상태만 읽으며, 중지 상태에서는 브라우저의 주기적 조회도 멈춥니다.

운영을 허용받아 활성화한 경우에도 수집은 전체 사용자에게 한 번만 수행합니다. 최소 간격은 5분, 한국 날짜 기준 하루 최대 288주기입니다. 403·429는 DB에 중지 상태를 저장해 재시작 후에도 재호출하지 않습니다. 일시적인 오류는 재시도 간격을 최대 1시간까지 늘립니다. 오류가 나도 기존 날짜와 알림 기록은 유지합니다. 이 제한은 CGV가 허용한 한도를 대신하지 않으며, 실제 운영 전 CGV가 안내한 기준에 맞춰야 합니다.

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

백엔드는 Cloudflare Workers + D1용이며 현재 배포는 Sites에서 관리합니다. 별도의 Cloudflare 계정에 직접 배포할 경우 `wrangler d1 create cgv-alerts`로 생성한 실제 ID로 설정의 예시 ID를 바꾸고 `npm run db:remote`를 실행합니다. 기본 설정의 Cron은 비어 있습니다. 필요한 환경 변수는 다음과 같습니다.

| 변수 | 용도 |
| --- | --- |
| `CGV_COLLECTION_ENABLED` | 기본 `false`. CGV 이용 허용·연결·비용 조건 확인 후에만 `true`로 설정 |
| `PUBLIC_ORIGIN` | 공개 웹사이트 origin, CORS 허용 대상 |
| `PUBLIC_URL` | 공개 웹사이트 전체 URL |
| `VAPID_PUBLIC_KEY` | 브라우저에 전달하는 공개 키 |
| `VAPID_PRIVATE_KEY` | 서버 secret으로만 저장하는 개인 키 |
| `VAPID_SUBJECT` | 운영자의 HTTPS 연락 페이지 또는 mailto 주소 |
| `POLL_TOKEN` | 외부 스케줄러의 보호된 조회 호출용 secret |
| `MAX_SUBSCRIBERS` | 기본 30개 브라우저; 예상 사용자는 약 10명 |

`npm run keys`의 출력은 공개 저장소나 채팅에 올리지 말고 개인 키와 `POLL_TOKEN`을 배포 서비스의 secrets에 저장합니다. `wrangler secret put VAPID_PRIVATE_KEY`, `wrangler secret put POLL_TOKEN`을 사용합니다.

Sites에도 `dist/server/index.js`를 배포할 수 있습니다. `.openai/hosting.json`에서 D1 논리 바인딩 `DB`를 선언하고, 생성된 `drizzle/` 마이그레이션을 함께 배포합니다. Sites에 배포한 경우 `wrangler.toml`의 Cron이 자동으로 등록된다고 가정하지 않습니다. 외부 스케줄러는 `POST /api/internal/poll`에 `Authorization: Bearer <POLL_TOKEN>`을 전달해야 합니다. 이 경로도 수집이 비활성화되어 있으면 실행되지 않습니다. GitHub Actions 조회 워크플로는 현재 수동 실행만 정의되어 있고 저장소에서도 비활성화했습니다.

403·429로 중지된 수집은 시간이 지나도 자동 재개하지 않습니다. 원인과 이용 허용 범위를 확인한 운영자만 DB의 `state` 테이블에서 `poll_blocked`, `poll_retry_at`, `poll_failures` 키를 제거할 수 있습니다. `seen_dates`와 `deliveries`는 중복 방지를 위해 유지합니다. 환경 변수 변경만으로 이용 허가를 얻는 것은 아닙니다.

## 규모와 한도

5분 주기는 하루 최대 288주기입니다. 날짜 D개를 확인할 때 한 주기에 `1 + D`번 CGV에 요청합니다. 이용자 10명이 같은 결과를 공유합니다. 현재 한 주기는 최대 38개 날짜를 처리하므로 최대 요청 수는 `288 × 39 = 11,232회/일`입니다. 38일을 넘으면 일부만 조회하지 않고 중단합니다. 이 수치는 CGV가 승인한 요청 한도가 아닙니다. 푸시는 한 번에 최대 10개 브라우저에 묶어 보내고, 총 등록은 30개 브라우저로 제한합니다.

비용 조건은 2026-11-09에 확인했습니다.

- 화면은 공개 저장소의 GitHub Pages를 사용합니다. GitHub Free에서도 제공되며 사이트 크기·전송량 등의 한도가 있습니다. [공식 한도](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- 현재 서버는 Cloudflare 개인 무료 계정이 아닌 ChatGPT Sites입니다. 공식 안내상 호스팅은 2026-12-31까지 무료이며, 2027-01-01부터는 플랜의 포함량을 넘는 사용량에 과금이 예정되어 있습니다. DB는 비어 있어도 기본 사용량이 생깁니다. [Sites 비용 안내](https://learn.chatgpt.com/docs/sites#pricing)
- 따라서 이 배포를 계속 유지해도 영구히 무료라고 보장할 수 없습니다. 2027년 운영 전에는 실제 플랜의 포함량·초과 과금 설정을 확인하거나 운영자 Linux로 서버를 이전해야 합니다. 자동 조회를 끄는 것만으로 호스팅·DB 요금까지 차단되지는 않습니다.
- 운영자 Linux를 이용하면 기존 PC의 전기·인터넷 비용은 남습니다. 자동 수집 프로그램과 재부팅 시 자동 시작 설정은 CGV의 허용 범위를 확인한 뒤 연결할 예정이며, 현재 설치·활성화하지 않았습니다.

추가 유료 서비스에 가입하거나 결제·크레딧 자동 구매 설정을 변경하지 않았습니다. 앱의 요청 횟수 제한은 호스팅 계정의 과금 상한 설정을 대신하지 않습니다.

아이폰·아이패드는 지원하는 iOS에서 홈 화면에 추가한 사이트로 열고 알림을 허용해야 합니다. 기기별 수신 테스트는 실제 기기에서 수행해야 합니다.

## 라이선스

상위 프로젝트의 AGPL-3.0을 유지합니다. 원본: <https://github.com/0w0i0n0g0/cgv-open-push>. 빌드할 때 `public/source.zip`으로 이 버전의 소스와 라이선스를 제공하며 비밀값은 포함하지 않습니다.
