# LifeRPG 현재 구현

2026-10-15 · `develop` · 승인 설계 `66967f2` 기반

제품 의도는 [DESIGN.md](DESIGN.md), 승인한 구조와 제약은 [ARCHITECTURE.md](docs/ARCHITECTURE.md), 작업·전환 원칙은 [WORKFLOW.md](docs/WORKFLOW.md)에 있다. 이 문서는 현재 코드와 실행 증거를 기록한다. 구현 여부와 사용자 환경의 인수 완료를 구분한다.

## 구성과 실행

Next.js App Router 하나에서 웹, HTTP API와 무상태 Streamable HTTP MCP를 제공한다. Node.js 런타임, TypeScript strict, Tailwind CSS를 사용한다. PostgreSQL은 Neon serverless Pool과 Drizzle로 접근하며 모델을 기다리는 동안 DB 트랜잭션을 유지하지 않는다. 별도 큐, Cron, Redis, 벡터 DB, 자체 채팅 앱은 없다. 패키지 버전은 `package-lock.json`에 고정한다.

```powershell
npm ci
# .env.example의 항목을 비공개 .env.local에 설정한다.
npm run db:migrate
npm run dev
```

`/`는 실제 플레이어 모험 서재, `/sign-in`은 Clerk 로그인, `/demo`는 명확하게 합성 데이터라고 표시한 화면 미리보기다. `/demo?scenario=long`, `pending`, `empty`로 긴 콘텐츠·대기·빈 상태를 확인할 수 있다. 자격증명이 없는 새 checkout도 `/demo`를 볼 수 있고 실제 API는 닫힌 상태로 실패한다.

`npm run typecheck`, `npm test`, `npm run build`가 기본 검증이다. `npm run test:db`는 새 개발 DB 안에 실행마다 격리 스키마를 만들고 그 스키마만 정리한다. 실제 모델을 호출하지 않고 공급자 응답을 주입하는 DB 경계 검증이다. 레거시 DB를 지정하지 않는다.

## 게임과 저장 계약

`src/lib/contracts.ts`가 도구 입력, 플레이어 DTO, `liferpg.1` GM 응답 계약의 기준이다. 종족·직업·이름·서사·능력 이름과 수치는 GM이 생성한다. 콘텐츠 분류는 character/item/quest/place/npc/faction/lore/relationship/skill/trait/title/achievement/class이며, 고정 직업표나 여섯 스탯으로 제한하지 않는다. entity의 상태와 자유 속성으로 장비·소모 등의 내용을 표현한다.

- 첫 탄생은 명시적 시작 요청으로만 생성하며 레벨 1·누적 XP 0·공개 캐릭터를 요구한다. 시작일은 DB에 기록한다.
- 캐릭터 사망과 XP·레벨 감소를 거부한다. 기존 능력 수치 감소에는 이유가 필요하다. 현실 변화나 교환이 적절한지는 GM 판단이며 스키마가 의미 전체를 증명하지 않는다.
- 세계 순서는 확정된 판정에서만 진행한다. 조회, 화면 버튼, 비접속 시간은 게임 진행이나 모델 호출을 만들지 않는다.
- GM 판단·정체성·철학·성찰·설정·복선과 상태 전후 이력을 DB에 저장한다. 이전 메모리 연결과 입력 출처를 보존하고, 정체성·중요 기억을 조용히 개수 제한으로 버리지 않는다. 필요한 맥락이 입력 한도를 넘으면 판정을 실패로 남긴다.
- 기억의 DB ID와 GM에게 전달하는 기억 ID를 일치시킨다. 새 기억의 이전 연결은 canonical ID로 저장하며, 이전 구현의 이름형 ID는 같은 소유자의 살아 있는 기억 한 개와 정확히 일치할 때만 해석한다. 없는·삭제된·다른 소유자·중복 별칭의 기억을 임의로 연결하지 않는다. GM은 기존 기억 전체가 아닌 신규·수정 기억만 반환한다.
- 플레이어용 응답은 허용 필드로 다시 구성한다. 비공개 entity, 숨은 관계, GM 메모리는 노출하지 않는다. 공개 자유 서술에 잘못 포함된 비밀의 의미까지 완전히 검출하는 장치는 아니다.

DB 테이블은 `games`(현재 상태·revision·개인정보 epoch·활성 실행), `records`(현실/퀘스트/공개 결과/GM 기억/상태 이력), `jobs`(접수와 판정 상태), `attempts`(호출·진단·예산 예약), `budgets`(월별 및 실험 누계)다. 마이그레이션은 `migrations/`에서 관리한다.

현실 사건 입력은 `start`, `experience`, `force_record`, `correct`, `quest`, `quest_update`, `answer`, `appeal`을 지원한다. 모든 명령에 `requestKey`, `expectedRevision`, 사실 내용·시각·불확실성·선택 대상·퀘스트 동의가 들어간다. `requestKey`는 삭제 후 중복 방지에 남으므로 일반 명령은 현실 내용을 포함하지 않는 UUID를 사용한다. 같은 요청 키 재전송은 저장된 결과를 반환하며 다른 내용으로 재사용하면 충돌한다. 삭제·거부된 요청의 재전송도 내용을 부활시키지 않는다. 정확히 같은 내용과 발생 시각의 경험 후보는 확인을 요구한다. 자연어로 다르게 표현한 사건의 동일성 판단은 버디가 기존 사건을 조회하고 처리해야 한다.

현실 퀘스트는 과업·완료 조건·동의 맥락·반복 조건을 보존한다. 판타지 quest entity의 `realTaskId`가 동의된 현실 과업을 연결하며, 완료 전환에는 실제 경험 사건의 근거가 필요하다. 클릭·등록·독려만으로 완료되지 않고 같은 근거의 중복 완료를 차단한다. 순수 판타지 퀘스트는 `realTaskId: null`이다.

## 접수, 대기와 이어 처리

현실 기록 상태(`pending/recorded/declined/deleted`)와 판정 상태(`waiting/running/committed/failed/interrupted/budget_blocked/deleted`)를 분리한다. `JobDTO`는 사건·작업·결과 ID, 현재 revision, 공개 결과, `nextAction`, 선행 작업, 미처리 수와 제한된 오류 코드를 돌려준다.

한 소유자의 활성 실행은 하나다. 행 잠금으로 먼저 접수된 미처리 작업부터 claim하고, 다음 작업은 `waiting`으로 보존한다. 작업 완료 후 서버가 다음 `waiting` 작업을 자동 실행한다. 각 작업은 같은 Vercel 앱의 별도 함수 실행으로 이어져 여러 GM 호출의 시간이 한 실행 제한에 누적되지 않는다. 내부 `POST /api/internal/queue`는 기존 서버 키에서 용도를 분리해 만든 HMAC과 소유자·작업 ID·90초 기한을 검증하며 사용자 OAuth 토큰이나 공급자 키를 전달하지 않는다. 추가 큐 서비스·Cron·환경변수는 없다. 정상 대기는 `nextAction: poll`이며 사용자 재개 버튼을 요구하지 않는다. 실패·중단·예산 차단된 선행 작업은 자동 재시도하지 않고 순서를 유지하며 멈춘다. 조회는 유료 실행을 시작하지 않는다. 기존 작업의 명시적 재시도는 계속 지원하며 새 사건을 생성하지 않는다. 외부 장애로 인계가 실패하면 고정 오류 로그를 남기며 별도 복구 스케줄러는 두지 않는다.

실행 Promise를 한 번 만들고 같은 Promise를 Next.js `after()`에 등록한다. 최대 8초 기다린 뒤 아직 완료되지 않으면 처리 중 상태를 반환한다. 입력 토큰 계산은 15초, 모델 요청은 180초, 실행 lease는 240초다. lease가 끝난 실행은 다음 조회에서 `interrupted`로 판별하고, 뒤늦은 응답은 revision·privacy epoch·활성 실행을 다시 검사하여 적용을 차단한다. SDK 자동 재시도는 없다.

## 연결과 인증

| 경로 | 책임 |
| --- | --- |
| `GET /api/player` | 소유자의 현재 공개 상태·결과·사건·작업 조회 |
| `POST /api/commands` | 검증된 명령 접수와 실행 시작 |
| `POST /api/jobs/[jobId]/continue` | 접수된 작업의 명시적 이어 처리 |
| `DELETE /api/events/[eventId]` | 현실 사건과 드러나는 파생 정보 삭제 |
| `/mcp` | 같은 응용 서비스를 사용하는 MCP 도구와 UI resource |
| `/.well-known/oauth-protected-resource/mcp` | canonical resource와 Clerk issuer/scopes 공개 메타데이터 |

웹 API는 Clerk session token과 지정한 `OWNER_CLERK_USER_ID`를 검사한다. 쓰기에는 정확한 `APP_URL` origin을 요구한다. 최초 방문자를 소유자로 자동 등록하지 않는다. 개인 응답은 `private, no-store`이고 공개 CDN 캐시에 저장하지 않는다.

MCP는 웹 세션 대신 Clerk의 공식 OAuth access-token verify를 사용한다. issuer는 publishable key의 인스턴스 도메인과 일치해야 하며, `/mcp` audience·만료·취소·token 종류·소유자·허용 client ID를 검사한다. 읽기/쓰기/삭제마다 `life:read`, `life:write`, `life:delete`를 요구한다. 필수 설정이 없으면 503으로 닫고, 인증 실패는 JSON과 Bearer challenge를 반환한다.

MCP 도구는 `get_player_context`, `submit_life_command`, `continue_life_job`, `delete_life_event`다. 서버 instructions에 대화 시작 시 현재 상태와 대기 작업 확인, 작은 결과 표현, 중복 사건 확인, 실제 과업 동의, 강제 기록·삭제 권리와 별도 RPG 행동 입력 금지를 전달한다. ChatGPT의 자동 도구 선택이나 모든 대화에서의 호출을 보장하지는 않는다.

MCP 도구에는 자동 UI 표시를 연결하는 `_meta.ui.resourceUri`를 제공하지 않는다. 네 도구의 OAuth scope와 `content`·`structuredContent` 반환은 유지하며, ChatGPT에서는 버디가 반환 데이터로 결과를 표현한다. `ui://liferpg/player-result.html` 정적 resource는 남아 있지만 도구에 연결하지 않는다. 웹 RPG 화면은 이 변경과 무관하다.

## 비용과 진단

GM은 공식 OpenAI Responses API의 `gpt-6.1-sol`, reasoning `medium`, tier `default`, `store: false`, 출력 상한 24,576토큰을 사용한다. 같은 입력·instructions·schema를 공식 token-count endpoint에 보내 32,000 입력토큰 상한을 검사한다. 메모리 보호용 2MB 입력 제한은 별도다.

`GM_PAID_CALLS_ENABLED=true`, 키·진단 암호화키·예산 조건을 모두 만족해야 모델 요청을 시작한다. 실험에는 `GM_BUDGET_SCOPE=experiment`와 실행별 `EXPERIMENT_AUTHORIZATION`도 필요하다. 실험 원장은 전체 팀 누계 $3, 운영 월 상한은 최대 $15다. 실험도 해당 월 원장에 함께 반영한다. 한도는 지출 목표가 아니다.

한 번의 최대 예약은 $0.389760이다. 입력을 캐시 쓰기까지 포함한 보수적 $4.5/백만, 출력을 $10/백만으로 계산한다. 확인된 usage와 tier로 보수적으로 정산하며 과금 불명은 예약을 유지한다. 모델 호출 전 토큰 검사 실패는 미호출로 정리한다. 공급자 청구서와 동일한 금액이라고 표현하지 않는다.

실제 HTTP 응답 본문을 구조 해석 전에 수신하고 request/response ID, 모델·tier, 상태, usage, 길이·타입, 타이밍과 검증 경로를 남긴다. 실패 본문은 AES-256-GCM으로 최대 256,000바이트를 암호화하여 24시간 접근 기한을 적용한다. 이후 요청 또는 진단 조회에서 만료 ciphertext를 정리하므로 정확히 24시간에 물리 삭제된다고 보장하지 않는다. 성공 응답 원문을 추가 진단 로그로 계속 쌓지 않는다.

진단은 웹·MCP 게임 도구에 없다. 제한된 로컬 `scripts/diagnose.ts`가 `DIAGNOSTIC_OPERATOR_TOKEN`과 별도로 제공한 `DIAGNOSTIC_ACCESS_TOKEN`을 확인해 `.local/diagnostic-[attempt].txt`에 쓴다. 이 파일에는 민감한 원문이 포함될 수 있으므로 공유·커밋하지 않는다. 일반 실행 로그와 오류 응답은 사건 본문·비밀값을 출력하지 않는다.

## 정정과 삭제

강제 기록은 모델 성공이나 보상 여부와 무관하게 먼저 저장한다. 일반 경험을 GM이 거부하면 임시 사실과 파생 내용을 제거하고 거부 상태를 반환한다. 사용자는 명시적 새 사실과 함께 강제 기록할 수 있다.

정정은 기존 현실 사실을 교체하기 전에 이전 내용에서 나온 기록·기억·결과·진단을 정리한다. 삭제도 같은 출처 관계를 따라 현실 정보와 드러나는 파생 내용을 제거하며 진행 중 응답의 재생성을 차단한다. 섞인 현재 상태에 원래 사건의 영향이 있으면 레벨·누적 XP·능력 수치·공개 소지품 수량과 존재를 보존한다. 원래 식별자·이름·설명·관계·속성·상태는 제거하고 새 UUID와 사건과 무관한 정적 허구 이름으로 치환한다. 캐릭터는 '안개 여행자', 능력은 '무명의 힘', 공개 물건은 '이름 없는 유물'로 남으며 수량이 없던 물건에 새 수량을 발명하지 않는다. 이 정리는 추가 모델 호출 없이 수행한다.

현실 퀘스트·NPC·비공개 물건·설정과 관련 장면은 오염된 혼합 상태에서 제거한다. 개별 필드의 독립 출처를 추정해 원래 명칭을 살리는 구현은 아니므로 다른 기억과 장면도 함께 비워질 수 있다. 플레이 수치 보존과 현실정보 제거를 우선하는 현재의 보수적 삭제 범위다.

서비스가 관리하는 현행 데이터의 삭제 완료와 외부 보존을 구분한다. 이미 표시된 ChatGPT 대화·메모리, OpenAI 보안 보존, Neon 복구 이력까지 즉시 삭제한다고 약속하지 않는다. 새 개발 DB의 복구 보존은 6시간이다.

## 환경과 검증 상태

MCP 인증 거부는 서버 런타임 로그에 `mcp_auth_rejected`로 기록한다. Bearer 헤더, Clerk 검증, 토큰 claims, owner/client 정책 중 실패 단계와 고정된 사유 코드, 응답 HTTP 상태를 구분한다. Clerk 검증 실패는 숫자 상태와 허용 목록의 오류 코드만 추가하며 토큰·키·사용자 식별자·claims 값·공급자 원문/stack은 기록하지 않는다. 검증 조건과 외부 오류 응답은 유지한다. 실제 ChatGPT 연결 실패 원인은 이 진단 배포 후 재현으로 확인해야 한다.

새 자원은 레거시와 분리했다. Neon `small-cherry-34193327` / 기본 develop branch `br-wild-bird-b3rbqb4s` / `liferpg` DB와 Vercel `prj_PV5JTHOVjv8ZWb02pIszbNHNEzUq`의 `liferpg` 프로젝트를 사용한다. 최초 시험용 Clerk 개발 인스턴스 대신 사용자가 설정한 공통 SpiritFlag Universe 앱 `app_3Kj7lRQfbcy6npdKPFG5BRmpwL6`의 Production 인스턴스를 사용한다. issuer는 `https://clerk.spiritflag.work`이며 Google 로그인, CIMD와 Include Audience 설정을 사용한다. Preview와 운영은 현재 같은 DB를 사용하므로 Preview 변경도 실제 게임에 영향을 줄 수 있다. 운영 전환은 기존 탄생 데이터를 유지하고 Production `APP_URL`을 `https://liferpg.spiritflag.work`로 구분한다. Neon 무료 플랜과 기존 Vercel 계정을 재사용했으며 새 유료 구독은 만들지 않았다.

| 검증 | 실제 확인한 범위 |
| --- | --- |
| 실제 Sol → Neon | `exp-20261015-birth-01`: 합성 principal로 실제 Sol HTTP 200·completed, 계약 검증, 레벨 1·XP 0·revision 1 저장 및 재조회. 약 33초. Clerk/MCP HTTP를 통과한 실험은 아니다. |
| 실제 OAuth → 로컬 MCP → Sol → Neon → 웹 | `exp-20261015-mcp-02`: 별도 합성 시험사용자의 실제 OTP·동의·PKCE OAuth로 HTTP MCP 시작 요청. 처음 `running` 반환 후 단일 실제 Sol 응답을 검증·저장하고 MCP와 웹 세션 조회의 동일 result/revision 1을 확인. 레벨 1·XP 0·세계 순서 1, 약 33초. 실제 ChatGPT host 및 배포 환경 증거와 구분. |
| 실제 OAuth → Vercel MCP → Sol → Neon → 웹 | `exp-20261015-vercel-03`: 별도 합성 시험사용자와 보호된 임시 Git preview에서 실제 전체 경로 성공. 초기 `running` 응답 10:27:48.548 UTC 이후 실제 응답 수신 10:28:02.017, 저장 10:28:02.079로 배포된 `after()` 지속 실행을 확인. attempt 1, 자동 재시도 없음, MCP/웹 동일 result·revision 1, 레벨 1·XP 0. 실제 ChatGPT host에서 호출한 것은 아니다. |
| 비용 증거 | 세 실험 input/output은 각각 1,093/1,349, 1,198/1,203, 1,196/1,113. 보수적 비용 $0.018409/$0.017421/$0.016512, 팀 전체 누적 $0.052342, 예약 잔액 0. 실제 공급자 청구 확정값과 구분. |
| 실제 token-count API | 883 tokens 반환 확인. 모델 추론 성공 실험과 별도. |
| 실제 Clerk/OAuth와 로컬 HTTP | 새 개발 인스턴스의 합성 시험사용자로 이메일 OTP·동의·PKCE S256을 거쳐 실제 scoped OAuth token 발급. 공식 SDK와 실제 인증 모듈의 audience/owner/client/scope·변조 검증, 로컬 HTTP MCP 읽기 200와 Neon 미시작 상태, 별도 웹 세션 조회 200, OAuth→웹 및 웹 세션→MCP 교차 사용 401을 확인. Naver 실사용자 OTP와 ChatGPT 연결은 별도 검증 대상. |
| 합성 실패·실제 DB | 잘못된 형식·refusal·incomplete, 중복·동시성·FIFO·이어 처리, lease 만료, 늦은 응답, 강제 기록·정정·삭제, 비공개 투영, 현실 퀘스트 완료근거, 월/누적 cap, 과금 불명 예약, 진단 만료를 격리 Neon에서 검증. 모델 응답은 주입한 것이다. |
| 화면과 카드 | 새 Chromium context의 1440/390px 화면, 긴/빈/대기 상태, 12개 가변 능력, 키보드 dialog, 수정·삭제 UI 연결, 안전한 텍스트, 합성 MCP bridge·펼치기·가시성별 조회를 검증. 실제 ChatGPT host 및 실물 모바일 검증은 아니다. |

실토큰 검증에서 Clerk의 BAPI 반환값에 `type`이 생략되는 것을 확인했다. 전용 OAuth verifier가 검증한 결과에서만 생략을 허용하고, 명시적으로 다른 type이 있거나 audience·만료·소유자·client·scope가 맞지 않으면 거부한다. 모의 응답과 실제 응답 형식의 차이를 수정한 사례다. 독립 검수는 이 변경과 기존 P1/P2, 삭제 후 수치 보존·늦은 응답·다음 입력의 삭제 정보 부재를 재확인했고 미해결 중대 결함을 보고하지 않았다.

실제 OAuth scoped token → MCP → Sol → 저장 → 웹 재조회는 로컬과 Vercel preview 모두 확인했다. 원격 실험의 정확한 소스는 `871593e`와 같은 tree인 시험 트리거 커밋 `d53e806`이며, 이후 requestKey 형식 제한·도구 설명 수정에는 단위·실제 Neon 회귀·빌드 검증을 적용했다. 선택된 실사용자의 브라우저 로그인, 실제 ChatGPT client 연결·동의·카드·프로젝트·모바일 제공 여부와 자연스러운 버디 사용감은 별도 인수 대상이다. 내부 세부 증거는 비공개 `.local/` 아래에 두며 공개 저장소에 올리지 않는다.

사용자의 최신 배포 선택은 GitHub 연동이며 `develop` 검증·`main` 운영을 기본으로 한다. 사용자는 기존 공개 `SpiritFlag/LifeRPG` 저장소에 비밀값·개인정보·내부 로그·사용자 `.agents/`를 제외한 구현 코드와 승인 문서의 푸시를 명시적으로 승인했다. 새 Vercel 프로젝트를 해당 GitHub 저장소에 연결하고 `productionBranch=main`, `autoAssignCustomDomains=false`를 API로 확인했다.

2026-10-15 첫 CLI 배포는 `--target preview`를 명시했으나 Vercel이 신규 프로젝트의 첫 배포를 `production`으로 분류했다. API에서 이를 확인한 뒤 `dpl_HQ7br6fRuDJ1guVTWPBQ29gKw1k9`를 제거했고 배포 목록 0건을 확인했다. 해당 배포는 빈 production 환경과 Vercel 보호 상태였으며 목표 도메인·레거시는 변경하지 않았다.

원청의 구체 승인에 따라 공통 설계 커밋 `66967f2`에서 `main`을 만들고 `f6055a3`의 정적 준비 페이지 두 파일만 추가해 Git으로 배포했다. `dpl_GZ3FoLgy6mdxRoAaH3CdmkFKJtB6`는 Git/main/production/READY이고 애플리케이션 키·DB·소유자 환경변수는 없다. CLI 인증으로 준비 페이지 본문을 확인했으며 Vercel 보호와 도메인 자동할당 해제는 유지한다. 자동 생성된 Vercel 별칭은 있지만 목표 도메인을 연결하지 않았다. bootstrap은 실제 LifeRPG 운영 승격이 아니다.

첫 앱 운영 승격은 `develop`→`main` 병합으로 전달하며 bootstrap의 `public/index.html`과 정적 `vercel.json`을 제거한다. 프로젝트 기본 framework는 bootstrap 뒤 `nextjs`로 복원했다. 이후 개발 기준은 계속 `develop`, 운영 배포 기준은 `main`이다.

첫 실제 `develop` Git 배포 `8ec0c33` / `dpl_HjDSB4bS6fXXsPXNJ5MU68fxjXtQ`는 READY이며 OIDC 환경은 preview다. 검증 주소는 `https://liferpg-git-develop-jeong-sin-gis-projects.vercel.app`이다. 이 별칭에만 Vercel 보호 예외를 적용하여 로그인 화면과 OAuth metadata를 외부 클라이언트가 열 수 있게 했고 main과 다른 배포의 보호는 유지했다. 인증 없는 `/api/player`는 401·private/no-store, `/sign-in`과 명확한 합성 `/demo`는 200이다. preview의 유료 호출은 꺼져 있다.

새 LifeRPG 개발 Clerk의 관리 UI에서 공식 `https://chatgpt.com/oauth/client.json`을 CIMD로 사전등록하고 `life:read`, `life:write`, `life:delete`, `offline_access`를 부여했다. ChatGPT 이름·로고 해석, metadata refresh 후 오류 없는 등록 행을 실제 확인했다. 로컬 및 preview의 `MCP_ALLOWED_CLIENT_IDS`에는 이 공식 URL 하나만 설정했다. 환경변수 변경은 후속 Git 빌드부터 적용된다. 실제 ChatGPT의 token endpoint 인증방식 협상·사용자 동의는 이 등록 확인으로 대체하지 않는다. 공통 SpiritFlag 앱이나 Google 로그인 설정은 사용자 작업이며 이 구현에서 변경하지 않았다.

원격 실험에는 별도 `integration-check` branch의 합성 owner/client와 실행별 승인만 사용했다. 성공 후 해당 branch의 6개 환경변수 override, 시험 배포 2개, 임시 원격 branch, 자동화 우회 credential과 환경변수의 로컬 복사본을 제거했다. 시험 브라우저 세션도 폐기했으며 원본 비용·실행 증거는 비공개로 보존했다. 실사용자의 첫 탄생은 수행하지 않았다.

사용자는 실제 ChatGPT MCP 조회, 저장된 탄생 작업 재개 및 확정 결과 재조회를 확인한 뒤 운영 배포를 승인했다. 서버 DB에서도 해당 탄생 작업 `committed`, 오류 없음, revision/world sequence 1, 진행 중 attempt 없음을 읽기 전용으로 확인했다. 유료 호출은 운영 scope와 월 최대 $15 설정을 사용한다. 정식 도메인의 OAuth audience는 Preview와 다르므로 ChatGPT는 운영 `/mcp` 주소로 새 연결이 필요하다. 레거시 앱·Clerk·DB는 유지하며 정식 도메인을 새 프로젝트에 연결한다. 배포 READY와 도메인 연결 및 공개 접근 확인은 별도 배포 증거로 검증한다.
