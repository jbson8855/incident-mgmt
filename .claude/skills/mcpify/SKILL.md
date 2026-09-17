---
name: mcpify
description: 이 프로젝트가 가진 기능을 MCP 서버로 노출해 AI 에이전트가 직접 호출할 수 있게 만든다. "MCP로 만들어줘", "에이전트가 쓸 수 있게 해줘", "MCP 서버 만들어줘", "/mcpify" 같은 요청에 트리거된다.
---

# mcpify

이 프로젝트의 기능을 Model Context Protocol(MCP) 서버로 노출한다.
완료되면 Claude Code 같은 AI 에이전트가 이 서비스의 기능을 직접 호출할 수 있다.

## 0단계 — 언어

사용자가 쓴 언어로 응답한다. 한국어로 요청받았다면 끝까지 한국어로 응답한다.

## 1단계 — 기능 스캔

`app/api/**/route.ts`를 모두 찾는다. 각 파일을 읽어 **실제로 export된 HTTP 메서드만** 후보로 삼는다
(`GET` `POST` `PATCH` `PUT` `DELETE`). export되지 않은 메서드는 후보가 아니다.

- `app/api/mcp/`는 제외한다 (자기 자신)
- 후보가 **0건이면 여기서 종료한다.** 억지로 만들지 않는다:
  > 아직 MCP로 노출할 기능이 없습니다. `/implement`로 기능을 먼저 만든 뒤에 다시 실행해주세요.

## 2단계 — 업무 동작 문장으로 번역

각 후보를 **사용자가 그대로 이해할 수 있는 한 문장**으로 옮긴다.

- `docs/domain-story.md`의 용어표가 있으면 **그 단어를 그대로 쓴다.** 없으면 `types/index.ts`와
  `schema.sql`의 이름을 근거로 삼는다.
- **기술 용어를 사용자에게 노출하지 않는다** — route, endpoint, API, 핸들러, GET/POST/PATCH/DELETE,
  스키마 같은 단어를 목록에 쓰지 않는다.
- 형식: 동사로 끝나는 짧은 한 문장.

| 후보 | 사용자에게 보이는 문장 |
|---|---|
| `GET /api/applications` | 신청 건 목록 보기 |
| `GET /api/applications/[id]` | 신청 건 상세 보기 |
| `POST /api/applications` | 신청 건 접수하기 |
| `PATCH /api/reviews/[id]` | 심사 결과 기록하기 |
| `DELETE /api/applications/[id]` | 신청 건 삭제하기 |

## 3단계 — 선택 게이트 (반드시 정지한다)

번호를 붙인 평문 목록으로 제시하고 **턴을 끝낸다.**

```
MCP로 노출할 기능을 선택해주세요.

1. 신청 건 목록 보기
2. 신청 건 상세 보기
3. 신청 건 접수하기
4. 심사 결과 기록하기

번호를 쉼표로 적어주세요. 그냥 넘어가시면 전부 노출합니다.
```

**사용자 응답을 받기 전에 4단계로 넘어가지 않는다.** 목록만 출력하고 정지한다.
파일을 만들지도, 패키지를 설치하지도 않는다.

- **되묻지 않는다.** 응답이 모호하거나 비어 있으면 전부 노출로 진행한다.
- "전부" "다" "all" "그냥 해줘" → 전량 선택으로 해석한다.

## 4단계 — 패키지 설치

프로젝트의 패키지 매니저(lockfile 기준)로 설치한다.

```bash
npm install mcp-handler@^2 @modelcontextprotocol/server@^2 zod@^4
```

`mcp-handler` 2.x는 SDK v2(`@modelcontextprotocol/server`)와 zod 4를 쓴다.
`@modelcontextprotocol/sdk`(1.x)를 설치하지 않는다.

## 5단계 — MCP 라우트 생성

`app/api/mcp/route.ts`를 만든다. **기존 route 파일은 수정하지 않는다. 추가만 한다.**

```typescript
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

const handler = createMcpHandler((server) => {
  server.registerTool(
    'list_applications',
    {
      title: '신청 건 목록 보기',
      description: '접수된 신청 건 목록을 조회한다.',
      inputSchema: z.object({
        status: z.string().optional(),
      }),
    },
    async ({ status }) => {
      const rows = listApplications({ status });   // 기존 로직 재사용
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    },
  );
});

export { handler as GET, handler as POST };
```

규칙:

- **선택된 기능 1개 = 도구 1개.** 선택되지 않은 기능은 등록하지 않는다.
- 도구 이름은 영문 snake_case. `title`에는 2단계에서 만든 한국어 문장을 그대로 넣는다.
- `inputSchema`는 **`z.object({...})` 전체**를 넘긴다 (raw shape 아님 — 2.x 문법).
- 입력 필드는 해당 route가 실제로 읽는 쿼리스트링·바디 필드에서 도출한다. 없으면 `z.object({})`.
- **구현은 기존 로직을 재사용한다.** route handler가 호출하는 `lib/` 함수나 `getDB()` 쿼리를
  직접 부른다. **자기 서버를 HTTP로 다시 호출하지 않는다.**
  route 안에 로직이 인라인으로 박혀 있어 재사용이 불가능하면, 그 쿼리를 MCP 파일 안에 복제하지 말고
  `lib/`로 먼저 추출한 뒤 양쪽에서 부른다.
- 반환은 항상 `{ content: [{ type: 'text', text: ... }] }`. 객체·배열은 `JSON.stringify(x, null, 2)`.

## 6단계 — 연결 안내

타입체크가 통과하는지 확인한 뒤(`npx tsc --noEmit`), 사용자에게 아래를 안내한다.

1. dev 서버가 떠 있어야 한다 (`npm run dev`)
2. **서버 이름을 영문으로 직접 정해서, 완성된 명령어를 제시한다.**

   ```bash
   claude mcp add --transport http partner-review http://localhost:3001/api/mcp
   ```

   - `claude mcp add`는 **영문자·숫자·하이픈·언더스코어만** 받는다. 한글 이름을 넣으면
     `Invalid name` 으로 실패한다. **사용자에게 이름을 지으라고 시키지 말고**, 프로젝트 성격에서
     뽑은 영문 kebab-case 이름을 넣어 **그대로 복사해 쓸 수 있는 한 줄**로 준다.
   - `--scope` 를 **붙이지 않는다.** 기본 scope(local)는 바로 연결되지만, `--scope project`는
     `⏸ Pending approval` 상태로 멈춰 별도 승인 절차가 필요하다.
   - 포트는 `package.json`의 dev 스크립트에 적힌 실제 포트를 쓴다.

3. 연결 확인:

   ```bash
   claude mcp list
   ```

   해당 이름 옆에 `✔ Connected`가 뜨면 완료다.

마지막에 **등록된 도구 목록을 표로** 보여준다 (도구 이름 · 하는 일). 그리고 바로 써볼 수 있는
예시 질문 하나를 제안한다 — 2단계 문장을 그대로 쓴 자연어 질문이면 된다.

## Invariants

- **3단계에서 반드시 정지한다.** 사용자 선택 없이 설치·파일 생성으로 넘어가지 않는다.
- 기술 용어를 사용자에게 노출하지 않는다 (코드 블록 안은 예외).
- 기존 `app/api/**/route.ts`를 수정하지 않는다.
- 후보가 0건이면 파일을 만들지 않고 종료한다.
- `claude mcp add`에 한글 이름이나 `--scope project`를 쓰지 않는다.
- `mcp-handler` 1.x 문법(`server.tool(...)`, `[transport]` 동적 경로, raw shape inputSchema)을 쓰지 않는다.
