# 비니네 오니네 가계부 — Apps Script 프로젝트

Google 스프레드시트에 연결된(컨테이너 바인딩) Apps Script 웹앱. clasp으로 로컬에서 관리한다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `Code.js` | 공통 상수·유틸, 정기 자동입력, onEdit/onOpen, 정렬, 백업, 마이그레이션, 아카이빙 |
| `Dashboard.js` | 웹앱 진입점(`doGet`), 권한 검사, CRUD API |
| `Router.html` | PC/모바일 판별 후 리디렉션 |
| `Index.html` | PC 대시보드 |
| `Mobile.html` | 모바일 대시보드 |
| `Common.html` | 공통 JS + 등록/수정 모달 (양쪽에서 `include('Common')`) |
| `appsscript.json` | 매니페스트 (타임존·런타임·웹앱 배포 설정) |

> **파일명 주의:** 서버 파일명과 로컬 파일명이 정확히 일치해야 한다.
> `Dashboard.js`가 `include('Common')`, `createTemplateFromFile('Mobile')`로 참조하므로
> `Common.html` / `Mobile.html`의 대소문자를 바꾸면 런타임 오류가 난다.

## 다른 PC에서 작업하기 (Windows 기준)

`.clasp.json`(Script ID)과 `.clasp-prod`(운영 배포 ID = 웹앱 URL)는 **저장소에 커밋하지 않는다.**
저장소가 나중에 공개로 바뀌어도 노출되지 않게 하기 위함이다.
그래서 clone 직후에는 clasp 명령이 동작하지 않으며, `npm run setup`으로 재생성한다.

### 사전 준비 (해당 PC에서 한 번만)

| 프로그램 | 확인 | 비고 |
|---|---|---|
| [Node.js LTS](https://nodejs.org) | `node -v` `npm -v` | 설치 후 터미널을 새로 열어야 PATH가 잡힌다 |
| [Git for Windows](https://git-scm.com/download/win) | `git --version` | Git Bash 또는 PowerShell 모두 가능 |

### 설정 (PowerShell 또는 Git Bash)

```powershell
git clone https://github.com/adminkcs/bini-oni-budget.git
cd bini-oni-budget

npm install                      # node_modules 복원 (clasp 포함)
npx clasp login                  # 브라우저 승인. 이 PC에서 한 번만
npm run setup -- <Script ID>     # .clasp.json + .clasp-prod 생성
```

**Script ID 확인:** 가계부 시트 → 확장 프로그램 → Apps Script → ⚙️ 프로젝트 설정 → 스크립트 ID

`npm run setup`은 로그인 상태를 확인하고 배포 목록에서 **버전이 매겨진 최신 배포**를 운영으로
판단해 `.clasp-prod`에 기록한다. 특정할 수 없으면 후보를 나열하고 직접 고르게 한다.

### 커밋 신원 (이 저장소에만)

```powershell
git config --local user.email "본인이메일"
git config --local user.name  "본인이름"
```

> `--global`은 쓰지 않는다. 같은 PC의 다른 프로젝트 커밋 신원까지 바뀐다.

### 확인

```powershell
npm test                 # 174건. clasp·네트워크 없이 동작한다
npm run pull             # 서버 -> 로컬
git status               # 변경이 없으면 서버와 로컬이 동일
```

### Windows 관련 참고

- npm 스크립트는 `cmd`로 실행된다. `&&` 연결과 `npm run xxx -- 인자` 모두 정상 동작한다
- `scripts/*.mjs`는 `npx.cmd` 분기를 넣어 두어 Windows에서도 그대로 동작한다
- 줄바꿈(CRLF)은 건드리지 않았다. 문제가 생기면 `git config --local core.autocrlf false`

## clasp 사용법

```bash
npm run setup -- <ID>  # 새 PC 최초 설정 (.clasp.json / .clasp-prod 생성)
npm run whoami       # 로그인 계정 확인
npm run status       # push 대상 파일 미리보기 (전송 안 함)
npm run pull         # 서버 -> 로컬
npm run push         # 로컬 -> 서버 (서버 덮어씀)
npm run deployments  # 배포 목록
npm run redeploy -- -d "설명"   # 운영 배포(@11) 갱신 — URL 유지
```

- `clasp deploy`(신규 배포)는 **쓰지 않는다.** 새 URL이 발급되어 가족의 북마크가 깨진다.
- 운영 배포 ID는 `.clasp-prod`에 있고 git에서 제외된다(웹앱 URL과 동일한 값이므로).
- `npm run push --watch`류의 자동 감시 푸시는 사용하지 않는다.

## 배포 설정 근거 (`appsscript.json` → `webapp`)

JSON은 주석을 지원하지 않으므로 여기에 기록한다.

```json
"executeAs": "USER_ACCESSING",
"access":    "ANYONE"
```

**`executeAs: "USER_ACCESSING"` (= "웹 앱에 액세스하는 사용자")**

`Dashboard.js`의 `assertAuthorized()`는 `Session.getActiveUser().getEmail()`로
접속자를 식별해 `ALLOWED_USERS`와 대조한다.

- `USER_DEPLOYING`(= "나")이면 스크립트가 항상 소유자 권한으로 실행되고 접속자 신원이
  스크립트에 전달되지 않아, **소유자 외에는 `getEmail()`이 빈 문자열**이 된다.
  `allowedUsers.indexOf('') === -1` → `throw` → 배우자 계정이 전면 차단된다.
- `USER_ACCESSING`이면 접속자 본인 권한으로 실행되어 `getEmail()`이 항상 유효하다.

**전제 조건:** 접속하는 계정이 **스프레드시트 자체에 편집 권한**을 가져야 한다.
스크립트가 접속자 권한으로 시트를 읽고 쓰기 때문이다. 또 계정별로 **첫 접속 시 1회
권한 승인**이 필요하다.

**`access: "ANYONE"` (= "Google 계정이 있는 모든 사용자")**

`ANYONE_ANONYMOUS`(로그인 불필요)가 아니라 Google 로그인을 요구하는 값이다.
로그인을 강제해야 `getActiveUser()`가 동작하고, 실제 접근 통제는 `ALLOWED_USERS`
화이트리스트가 담당한다.

> **변경 적용 시점:** 매니페스트 변경은 push만으로는 운영 배포에 반영되지 않는다.
> 기존 배포는 고정된 버전의 설정을 유지하므로, `npm run redeploy`로 갱신해야 적용된다.
> 테스트용 `@HEAD`(`/dev` URL)는 항상 최신 코드·매니페스트를 반영한다.

## 데이터 규칙

### 시트 컬럼 (가계부_내역 / 수입 공통)

| 열 | 항목 | 비고 |
|---|---|---|
| A | 일련번호 | UUID 앞 8자. 생성 시 시트 내 중복 검사 |
| B | 날짜 | **Date 객체**, 표시형식 `yyyy-MM-dd` |
| C | 대분류 | |
| D | 소분류 | |
| E | 내용 | |
| F | 금액 | **지출은 음수, 수입은 양수** (`normalizeAmount`가 강제) |
| G | 결제수단 | |
| H | 비고 | 정기 자동입력은 `정기지출 자동입력#<정기항목ID>` 형식 |
| I | 입력자 | 등록한 계정 이메일. 정기 자동입력은 `SYSTEM` |
| J | 입력시각 | 등록 시각 `yyyy-MM-dd HH:mm:ss` |
| K | 수정시각 | 수정·삭제 표시 시각. 삭제 후 정리 유예의 기준 |
| L | 삭제여부 | 소프트 삭제 표시(`Y`). 대시보드에서 제외됨 |

> I~L은 **[가계부 도구 > [1회성] 감사 컬럼 추가]** 를 실행해야 생성된다.
> 마이그레이션 전에는 A~H만 기록되도록 `appendRowsSafely`가 자동으로 잘라 쓴다.
> 기존 행의 입력자/입력시각은 알 수 없어 비워 둔다(허위 기록 방지).

### 정기 항목 실행 규칙 (`정기_수입지출_설정_및_휴일기준` E열 "지정일")

| 입력 예 | 동작 |
|---|---|
| `매주 월요일` | `요일`이 포함되면 요일 기준으로만 판정 |
| `말일` | 매월 마지막 날 실행 |
| `25` | 매월 25일 실행 |
| `5, 15, 25` | 해당 일자마다 실행 |
| `31` (2월) | **그 달의 말일에 실행** (건너뛰지 않음) |

- 지정일이 29/30/31인데 해당 월에 없으면 말일에 실행한다. 월세·카드대금이 짧은 달에
  누락되면 안 되고, 은행 자동이체도 관례상 말일에 집행되기 때문이다.
- **휴일/공휴일 보정은 구현하지 않았다.** `CalendarApp`을 사용하지 않으며, 시트의 휴일
  관련 컬럼도 읽지 않는다(시트명은 기존 데이터 호환을 위해 유지).
- **멱등성:** 같은 날 같은 정기항목은 비고의 `#<정기항목ID>`로 판별해 다시 입력하지
  않는다. ID가 없는 구 형식 데이터는 `날짜 + 내용`으로 보완 판정한다.

### 정기 설정 시트 정렬

`정렬가중치` 보조 컬럼(자동 생성·숨김)에 가중치를 기록하고 `Range.sort()`로 시트
자체를 정렬한다. `setValues` 방식은 데이터 유효성 검사(드롭다운)·서식·메모가 따라오지
않아 값과 드롭다운이 어긋나는 문제가 있었다. 오늘 실행 항목 강조(`#fff2cc`)는 셀에
직접 칠하지 않고 조건부서식으로 처리한다.

## 시트 메뉴 — [가계부 도구]

`onOpen`으로 생성된다. 시트를 새로 열면 나타난다.

| 메뉴 | 함수 | 용도 |
|---|---|---|
| 내역 정렬 | `sortLogSheetByDate` | 날짜 내림차순 + 일련번호 오름차순 |
| 정기 항목 수동 실행 | `insertRegularExpenses` | 트리거와 동일. 멱등성이 있어 중복 입력되지 않음 |
| 중복 일련번호 검사 | `checkAndFixDuplicateUUIDs` | 두 시트 교차 중복까지 검사·수정 |
| 분류 설정 점검 | `validateCategorySheet` | 서로 다른 대분류에 중복된 소분류 탐지 |
| 삭제 대기 행 정리 | `purgeDeletedRows` | 30일 지난 소프트 삭제 행을 실제 제거 |
| 트리거 설치/재설치 | `installTriggers` | 시간 기반 트리거를 코드로 재생성 |
| [1회성] 감사 컬럼 추가 | `migrateAddAuditColumns` | I~L 컬럼 생성 (멱등) |
| [1회성] 날짜 타입 정규화 | `normalizeExistingDates` | B열 문자열 → Date 변환 |
| [1회성] 금액 부호 정규화 | `fixExistingAmountSigns` | 지출 음수 / 수입 양수 강제 |
| [주의] 과거 데이터 이관 | `archiveOldTransactions` | 작년 이전 데이터를 보관함으로 이동 |

## 트리거 — `installTriggers()` 로 설치

트리거는 clasp 관리 대상이 아니라 재배포 시 재현이 어렵다. 코드로 고정했다.
**[가계부 도구 > 트리거 설치/재설치]** 를 실행하면 아래가 생성된다.
같은 함수의 기존 트리거는 제거 후 재생성하므로 여러 번 실행해도 중복되지 않는다.

| 함수 | 유형 | 권장 시각 |
|---|---|---|
| `insertRegularExpenses` | 시간 기반 · 일 단위 | 00:00 ~ 01:00 |
| `makeBackup` | 시간 기반 · 일 단위 | 03:00 ~ 04:00 |
| `scheduledSortLogSheet` | 시간 기반 · 매시간 | — |
| `scheduledArchiveOldTransactions` | 시간 기반 · 매월 2일 | 04:00 ~ 05:00 |
| `onEdit` | 스프레드시트 · 수정 시 | 단순 트리거(자동) |

> `onEdit`에서 자동 정렬을 제거했다. 편집마다 전체 시트를 재정렬하면 입력 중인 행이
> 화면에서 사라지기 때문이다. 정렬은 메뉴에서 수동 실행한다.

## 백업 정책 (`makeBackup` / `cleanUpOldBackups`)

| 접두사 | 보관 개수 | 생성 시점 |
|---|---|---|
| `[일일백업]` | 7 | 매일 |
| `[주간백업]` | 4 | 일요일 |
| `[월간백업]` | 12 | 매월 1일 |
| `[이관전백업]` | 3 | `archiveOldTransactions` 실행 시 |

## 스크립트 속성

**실제 값은 저장소에 두지 않는다.** 편집기의
**[프로젝트 설정 > 스크립트 속성]** 에서 직접 입력한다.

| 키 | 필수 | 용도 |
|---|---|---|
| `ALLOWED_USERS` | ✅ | 접근 허용 이메일 JSON 배열. 예: `["a@example.com","b@example.com"]` |
| `BACKUP_FOLDER_ID` | ✅ | 백업 파일 저장 Drive 폴더 ID |
| `ADMIN_EMAIL` | | 실패 알림 수신 주소. 없으면 `ALLOWED_USERS[0]` 사용 |

**[가계부 도구 > 스크립트 속성 점검]** 으로 설정 상태를 확인한다. 값은 마스킹되어
설정 여부만 보여주고, 누락된 키가 있으면 입력 방법을 함께 안내한다.

> **왜 코드에 두지 않는가:** 예전 `setupScriptProperties()`는 민감값을 코드에서 빼내려고
> 만든 함수인데 정작 실제 이메일과 폴더 ID를 하드코딩해 두고 그대로 써 넣었다.
> 저장소를 원격에 올리면 그대로 노출된다. 지금은 값을 쓰지 않고 **점검만** 한다.
> `Code.js`의 `getBackupFolderId()`도 하드코딩 폴백을 제거해, 속성이 없으면
> 조용히 넘어가지 않고 명확히 실패하며 실행로그·메일로 알린다.

`ALLOWED_USERS` 미설정 시 `assertAuthorized()`가
`초기 설정 미완료: setupScriptProperties()를 1회 실행하세요.`를 던진다.

## 과거 데이터 이관 — 자동 / 수동

핵심 로직은 `archiveCore()` 한 벌이고 진입점만 둘이다. 이 프로젝트에서 가장 위험한
코드라 복사본을 만들지 않는다.

| 진입점 | 실행 | 통지 |
|---|---|---|
| `archiveOldTransactions` | 메뉴 — 사람이 확인하고 실행 | `ui.alert` |
| `scheduledArchiveOldTransactions` | 트리거 — 매월 2일 04시 | 실행로그 + 메일 |

`archiveCore()`는 **이관 대상이 없으면 백업도 락도 잡지 않고 즉시 끝난다.**
그래서 매월 돌아도 비용이 없고 `[이관전백업]` 사본도 쌓이지 않는다.
보관 기준이 `올해 + 작년`이므로 실제 작업은 **해가 바뀐 뒤 한 번만** 일어난다.

반환하는 `status` — `none`(대상 없음) / `done` / `formula`(수식 발견) / `busy` / `error`.
자동 실행은 `none`일 때 로그조차 남기지 않고, 그 외에는 관리자 메일로 결과를 보낸다.

> **자동 실행의 전제:** `clearContents` 이후 구간은 롤백이 불가능하다. 아무도 지켜보지
> 않는 상태에서 실패하면 `[이관전백업]` 파일로 수동 복구해야 하며, 실패 메일에 파일명이 담긴다.

## archiveOldTransactions 실행 전 확인

1. 대상 시트(`가계부_내역`, `수입`) 전 컬럼에 **수식이 없어야 한다.**
   하나라도 있으면 백업 생성 전에 중단된다. 합계 수식은 별도 요약 시트로 분리할 것.
2. **`normalizeExistingDates`를 먼저 실행**해야 한다. B열에 문자열과 Date가 섞여
   있으면 한쪽만 이관되어 데이터가 쪼개진다.
3. `clearContents()` 이후 구간은 롤백이 불가능하다. 실패 시 `[이관전백업]` 파일에서
   수동 복구해야 하며, 오류 팝업이 파일명을 안내한다.

## 소프트 삭제

`deleteTransaction`은 행을 지우지 않고 **L열에 `Y`** 를 기록한다.

- `deleteRow`는 복구가 불가능하고 다른 시트의 범위 수식을 깨뜨린다.
- `getDashboardData`가 `삭제여부=Y` 행을 걸러내므로 화면에서는 사라진다.
- **[가계부 도구 > 삭제 대기 행 정리]** 가 수정시각 기준 30일이 지난 행만 실제로 제거한다.
- 감사 컬럼 마이그레이션 전이라면 기존 동작(행 삭제)으로 폴백한다.

## 실행 로그와 실패 알림

`insertRegularExpenses` / `makeBackup` / 마이그레이션 함수는 실행 결과를 **`실행로그` 시트**에
기록한다. 시트는 처음 기록될 때 자동 생성되고 최근 500건만 유지된다.

| 컬럼 | 내용 |
|---|---|
| 실행시각 / 함수명 / 결과 / 처리건수 / 메시지 | 성공·실패와 처리 건수 |

트리거 함수가 실패하면 `ADMIN_EMAIL`(없으면 `ALLOWED_USERS[0]`)로 **메일 알림**이 발송된다.
이전에는 트리거가 며칠째 실패해도 알 방법이 없었다.

## 시간대 주의사항

날짜 변환은 **스프레드시트 시간대**(`파일 > 설정 > 시간대`)를 기준으로 한다.
스크립트 시간대(`appsscript.json`의 `Asia/Seoul`)와 다르면 `getSheetTz()`가 로그에 경고를 남긴다.

> 실제 사고: 시트가 `(GMT-08:00) 태평양`(9월엔 서머타임 -07:00), 스크립트가 `Asia/Seoul`(+09:00)로
> 16시간 어긋나 `2026-09-11` 요청이 `2026-09-10 08:00`으로 저장됐다.
> 지금은 시트 시간대 기준으로 보정하므로 두 값이 달라도 안전하지만, **맞춰 두는 것을 권장**한다.

## 테스트

```bash
npm test
```

| 파일 | 내용 |
|---|---|
| `test/_stub.js` | Apps Script 런타임 스텁 (임의 시간대 주입 가능) |
| `test/schedule.test.js` | 말일 처리·요일 판정·정렬 가중치·날짜 유틸 |
| `test/timezone.test.js` | 시트/스크립트 시간대 불일치 회귀 |
| `test/audit.test.js` | 감사 컬럼 스키마·`buildTxnRow` |
| `test/budget.test.js` | 예산 집행률·전월 대비·검색/드릴다운 필터 |
| `test/local-apply.test.js` | 낙관적 UI 로컬 반영·롤백 |
| `test/quickadd.test.js` | 자주 쓰는 항목 (2주 윈도우·정기 제외·상위 3개) |

`test/`는 `.claspignore`에 있어 서버로 push되지 않는다.

## 라우팅과 `/dev` 테스트

`Router.html`은 화면 폭·UA로 PC/모바일을 판별해 `?view=pc` / `?view=mobile`로 이동시킨다.

Apps Script는 페이지를 **샌드박스 iframe**에서 실행하므로 상위 창 이동
(`window.top.location`)이 차단될 수 있고, **예외조차 나지 않고 조용히 무시**되기도 한다.
그래서 라우터는 try/catch + 타임아웃으로 실패를 감지해 **수동 진입 버튼**을 노출한다.
(실제로 "가계부 환경을 확인하고 있습니다..."에서 영구히 멈추는 문제가 있었다)

`ScriptApp.getService().getUrl()`은 항상 **`/exec`(운영)** 를 반환한다.
따라서 `/dev`에서 라우터를 거치면 운영 배포로 튕긴다. **테스트할 때는 view를 직접 지정한다.**

```
https://script.google.com/macros/s/<ID>/dev?view=pc
https://script.google.com/macros/s/<ID>/dev?view=mobile
```

## 운영 배포 절차

```bash
npm test                                          # 1) 회귀 테스트
npm run push                                      # 2) 서버 반영 (HEAD / dev URL에 적용)
                                                  # 3) /dev?view=pc 로 검증
npx clasp create-version "변경 요약"               # 4) 롤백 지점 고정
npm run redeploy -- -V <버전> -d "설명"            # 5) 운영 배포 갱신 (URL 유지)
```

**롤백:** 문제가 생기면 이전 버전 번호로 다시 배포하면 된다. URL은 그대로다.

```bash
npm run redeploy -- -V 11 -d "롤백"
```

| 버전 | 내용 |
|---|---|
| 11 | 소스 git통한 자동화 (STEP1.7까지) |
| 12 | STEP2 + STEP3A |
| 13 | STEP3B + 성능개선 |
| 14 | 퀵등록/소분류 표기/구분 토글 개선 |
| 15 | 홈 화면 아이콘 적용 (현재 운영) |

## 성능 설계 메모

저장이 7초 이상 걸리던 원인과 조치. (실측: `getDashboardData` 2.6~4.2초,
`saveTransaction` 3.9초 → 저장 1건에 서버 왕복 2회로 약 8초)

| 조치 | 내용 |
|---|---|
| **변경 후 전체 재조회 제거** | 저장/수정/삭제가 변경된 행(`txn`/`removed`)을 반환하고, 프런트 `applyLocalChange()`가 메모리에 반영한다. 서버 왕복 2회 → 1회 |
| **저장 경로에서 시트 정렬 제거** | 대시보드는 클라이언트에서 정렬하므로 화면과 무관했다. 대신 `scheduledSortLogSheet`를 **매시간** 트리거로 돌려 시트 가독성을 유지한다 (락을 잡고, 못 잡으면 다음 시간에 재시도) |
| **조회 대상 축소** | 프런트에서 전혀 쓰지 않던 `정기_수입지출_설정_및_휴일기준` 시트를 `getDashboardData`에서 제외 |
| **컬럼 투영** | 거래 시트는 화면이 쓰는 **A~H만** 전송. 입력자/입력시각/수정시각은 행마다 `Utilities.formatDate`를 호출하고 있었다(행 수 × 3회) |
| **날짜 포맷 캐시** | 같은 날짜가 반복되므로 포맷 결과를 재사용 |
| **행 조회 축소** | 수정/삭제의 행 찾기를 `getDataRange()`(전 컬럼) → `findRowsById()`(A열 단독)로 변경 |
| **UUID 스캔 제거** | 저장마다 A열 전체를 읽어 중복 확인하던 로직 제거. 길이를 8 → 12자(48비트)로 늘려 충돌 확률을 무시 가능한 수준으로 낮추고, 사후 검사 메뉴를 안전망으로 둔다 |

**라우터 우회:** `ScriptApp.getService().getUrl()` 리디렉션은 페이지를 두 번 로드한다.
`?view=pc` / `?view=mobile`을 직접 북마크하면 초기 로딩에서 1~3초를 줄일 수 있다.

### 2차 개선 (부트스트랩 · 낙관적 UI)

| 조치 | 내용 |
|---|---|
| **초기 데이터 부트스트랩** | `doGet`이 서버에서 이미 실행되므로 그 자리에서 데이터를 페이지에 심어 보낸다(`getBootstrapJson()`). 화면은 `BOOTSTRAP`이 있으면 그대로 쓰고, 없거나 실패(`null`)하면 기존 비동기 경로로 폴백한다. 초기 로딩의 서버 왕복 2회 → 1회 |
| **낙관적 UI** | 저장/수정/삭제가 서버 응답을 기다리지 않고 모달을 닫고 화면을 먼저 갱신한다. 실패하면 되돌리고 토스트로 사유를 알린다. 저장은 임시 ID(`__tmp_…`)로 먼저 표시하고 응답이 오면 확정 행으로 교체하며, 그 사이에는 수정/삭제를 막는다 |
| **Session 호출 1회** | `getCurrentEmail()`로 캐시. 저장 1건에 권한검사 + 입력자 기록으로 2번 호출되고 있었다 |
| **표시형식 열 단위 지정** | `ensureTxnColumnFormats()`가 열 전체에 서식을 지정해, 저장할 때마다 `setNumberFormat`을 2번 호출하던 것을 제거 |
| **`_row` 전송 제거** | 프런트 사용처가 없고 정렬 후엔 의미도 없다 |
| **Chart.js `defer`** | 차트는 데이터 로드 후에 그리므로 초기 렌더를 막을 이유가 없다 |

> **⚠️ 부트스트랩의 보안 전제:** `<?!= ?>`는 이스케이프 없이 출력되고 `JSON.stringify`는
> `<`, `>`, `/`를 건드리지 않는다. 시트 값에 `</script>`가 들어오면 스크립트 블록이 끊겨
> XSS가 성립하므로 **반드시 `toSafeJson()`을 거쳐야 한다.** 렌더링 시점의 `escapeHtml()`은
> 계층이 달라 이 문제를 막지 못한다.

> **페이로드 크기:** `archiveOldTransactions`가 올해와 작년만 남기므로 데이터는 **최대 약 24개월**로
> 제한된다. 별도의 기간 제한 로직을 두지 않은 이유다. 다만 **아카이빙은 수동 실행**이므로,
> 한 번도 돌리지 않으면 이 상한이 성립하지 않는다. 연 1회 정도는 실행할 것.

## 자주 쓰는 항목 (등록 모달)

등록 모달 상단의 빠른 입력 칩. 집계 규칙은 `buildQuickAddItems()`에 있다.

| 조건 | 값 |
|---|---|
| 기간 | 최근 **14일** (오늘 포함), `QUICK_ADD_DAYS` |
| 개수 | 최대 **3개**, `QUICK_ADD_MAX` |
| 집계 단위 | **소분류** (내용이 아님) |
| 대상 | **지출**만 |
| 제외 | `정기_수입지출_설정_및_휴일기준`의 **소분류(D열)와 일치하는 것** |
| 제외 | 비고가 `정기지출/정기수입 자동입력`으로 시작하는 행 (이중 방어) |
| 정렬 | 사용 횟수 내림차순 → 동률이면 최근 사용순 |

내용(`점심 김밥`)은 매번 달라지지만 소분류(`대중교통`)는 반복되므로 빠른 입력에 더 맞는다.
칩을 누르면 소분류와 결제수단이 채워지고 **내용 입력란에 포커스**가 간다.

정기 항목을 **손으로 직접 입력한 경우**에도 제외해야 하므로 비고만으로는 부족하다.
그래서 `getDashboardData`가 정기 시트의 **소분류(D열) 한 컬럼만** 읽어
`_정기소분류`로 함께 내려보낸다. (이 시트는 성능상 전체 조회 대상에서 빠져 있다)

### 소분류 선택지 표기

`subCatOptionLabel()`이 `분류_설정`의 설명을 괄호로 덧붙인다 — `대중교통 (지하철, 버스)`.
설명이 `SUBCAT_DESC_MAX`(16자)를 넘으면 `…`로 줄인다. `<option>`의 **value는 순수 소분류명**을
유지해야 한다(저장·조회가 이 값을 쓴다).

> **제약:** 네이티브 `<select>`의 `<option>`은 내부 글자 크기를 부분적으로 다르게 할 수 없다.
> 특히 Android는 드롭다운을 OS가 그려 CSS가 거의 적용되지 않는다. '설명을 소분류명보다 작게'는
> 커스텀 드롭다운을 직접 구현해야만 가능하다.

> 후보가 없을 때 영역을 통째로 숨기면 고장인지 데이터가 없는 건지 구분되지 않아,
> "최근 14일 내 반복 사용한 항목이 없습니다" 안내를 표시한다.

## 홈 화면 아이콘

`assets/` 의 아이콘을 `Dashboard.js`의 `ICON_URL`이 공개 URL로 참조한다.

| 파일 | 용도 |
|---|---|
| `assets/icon-192.png` | 파비콘·홈 화면 아이콘 (실제 사용) |
| `assets/icon-512.png` | 고해상도 예비 |
| `assets/icon-source-2048.png` | 원본. 재가공용 보관 |

```js
.setFaviconUrl(ICON_URL)
.addMetaTag('theme-color', '#EFF5FC')
```

**Android(갤럭시)** 는 '홈 화면에 추가' 시 파비콘을 아이콘으로 쓴다.
`HtmlService`에는 `<link>` 태그를 넣을 방법이 없어(우리 HTML은 샌드박스 iframe 안이라
최상위 문서의 `head`에 닿지 않는다) `setFaviconUrl()`이 유일한 경로다.

> **iOS는 이 방법이 통하지 않는다.** `apple-touch-icon`(`<link>`)을 요구하기 때문이다.
> iOS에서 아이콘을 지정하려면 단축어 앱으로 바로가기를 만들어야 한다.

> **저장소가 공개여야 한다.** 비공개면 `raw.githubusercontent.com`이 익명 요청에 404를
> 반환하고, 브라우저는 파비콘 요청에 토큰을 붙이지 않으므로 아이콘이 뜨지 않는다.

**아이콘 교체:** `assets/icon-192.png`만 바꿔 커밋하면 된다. `ICON_URL`은 그대로 둔다.
브라우저·CDN 캐시 때문에 반영에 시간이 걸릴 수 있다.

### 홈 화면 등록 시 주의

`?view=mobile`이 붙은 주소를 등록한다. 라우터를 거치지 않아 **1~3초 빨라지고**,
리디렉션이 차단되는 문제도 피할 수 있다.
