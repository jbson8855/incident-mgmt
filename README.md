# vmc-admin-starter

Next.js 16 App Router + SQLite 기반 업무 자동화 도구 스캐폴딩 템플릿.

여기서 시작해서 원하는 내부 도구를 바이브코딩으로 만든다.

---

## 시작하기

> **Node.js 버전**: LTS(v22) 사용을 권장한다 (`.nvmrc` 참고). v20.19 이상 필요.

```bash
npm install
npm run dev   # http://localhost:3001
```

### 다른 기기에서 접속하기 (같은 네트워크)

`scripts/setup.bat`을 실행하면 방화벽에 3001 포트 인바운드 규칙이 자동으로 추가되고,
`scripts/start-app.ps1`(바탕화면 아이콘)로 서비스를 켜면 이 PC의 LAN IP가 팝업으로 표시된다.
같은 네트워크의 다른 기기 브라우저에서 `http://<표시된 IP>:3001`로 접속하면 된다.

- IP/네트워크 대역은 `next.config.ts`에서 실행 시점에 자동으로 감지하므로 PC를 바꿔도 설정을 수정할 필요가 없다.
- 방화벽 규칙이 자동으로 추가되지 않으면(관리자 권한 필요) `setup.bat`을 관리자 권한으로 다시 실행하거나 안내되는 `netsh` 명령을 직접 실행한다.

### `npm install`에서 better-sqlite3 빌드 오류가 날 때

`prebuild-install` 실패 후 C++ 컴파일러(Visual Studio Build Tools)가 없다는 오류가 보이면, 설치된 Node.js 버전에 맞는 사전 빌드 바이너리를 못 찾아 소스 빌드로 넘어간 경우다. 아래 순서로 해결한다.

1. Node.js 버전 확인: `node -v` — v20.19 미만이면 [nodejs.org](https://nodejs.org)에서 **v22 LTS** 설치
2. 의존성 재설치:
   ```bash
   rm -rf node_modules package-lock.json   # Windows PowerShell: rd /s /q node_modules; del package-lock.json
   npm install
   ```
3. 그래도 실패하면 오류 전문을 강사에게 전달

---

## 구조

```
schema.sql          — DB 스키마 (앱 시작 시 자동 실행)
lib/db.ts           — SQLite 싱글톤
types/index.ts      — 타입 정의
components/ui/      — Badge, Button, Card, NavLink
app/layout.tsx      — 사이드바 레이아웃
app/page.tsx        — 시작 페이지
```

### 3-tier 아키텍처

```
Presentation  →  app/[page]/page.tsx
Application   →  app/api/[route]/route.ts
Infrastructure→  lib/db.ts + schema.sql
```

`CLAUDE.md`에 전체 아키텍처 규칙이 있습니다.

---

## 새 기능 만들기

1. `schema.sql` — 테이블 추가
2. `types/index.ts` — 타입 추가
3. `app/api/[name]/route.ts` — API route 작성
4. `app/[name]/page.tsx` — 페이지 작성
5. `app/layout.tsx` — nav 항목 추가

---

## 기술 스택

- **Next.js 16** App Router (React 19)
- **SQLite** — `better-sqlite3`, 로컬 파일 DB
- **Claude CLI** — `claude -p`로 AI 기능 추가
- **Tailwind CSS 4** — 모노크롬 디자인 시스템

---

## 완성 예시

`sample` 브랜치 — 이 템플릿에서 출발해 만든 **PG 가맹점 위험도 AI 분석 시스템**.

```bash
git checkout sample
npm run dev
```
