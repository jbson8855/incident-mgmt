---
name: tdd-setup
description: Set up a project's test environment so the tdd skill can run. Use when the user asks to set up testing, when /tdd is invoked but no test runner is configured, or when tests fail because the environment is missing.
---

# TDD Setup

Bootstrap a working test environment in any project — detect the language and stack, install an idiomatic test runner, create the folder conventions, verify with a smoke test, and record everything in `CLAUDE.md` so future sessions (and the `tdd` skill) know how to run tests. This skill is language-agnostic: never assume a stack; detect it.

## Step 0 — Check if setup is even needed

Look for an existing test configuration before changing anything: test scripts/tasks in the project manifest, test config files, existing test directories, or a lockfile entry for a known test framework. If a working setup exists, don't replace it — just verify it runs (Step 4) and document it (Step 5). If the user explicitly asked to switch frameworks, confirm before removing the old one.

## Step 1 — Detect the stack

Identify the language and toolchain from project files, e.g.:

| Evidence | Stack |
|---|---|
| `package.json` (+ lockfile) | JS/TS — note the package manager (npm/yarn/pnpm/bun) and framework (Next.js, Vite, Node, ...) |
| `pyproject.toml`, `requirements.txt`, `setup.cfg` | Python — note the manager (uv/poetry/pip) |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `pom.xml`, `build.gradle(.kts)` | Java/Kotlin |
| `Gemfile` | Ruby |
| `*.csproj`, `*.sln` | .NET |
| `composer.json` | PHP |
| `Package.swift`, `*.xcodeproj` | Swift |
| `mix.exs` | Elixir |

Multi-language monorepo: ask the user which package(s) to set up, or set up the one they're working in. Empty/ambiguous project: ask.

## Step 2 — Choose the test framework

Prefer what's built in, then the community default. Match the project's existing conventions (e.g. if the repo already uses Vite, choose Vitest over Jest).

- **JS/TS**: Vitest (Vite/modern projects), Jest (existing Jest ecosystem), or `node:test` for zero-dependency Node libraries. TS projects need the runner to handle TS (Vitest does natively).
- **Python**: pytest.
- **Go / Rust / Elixir**: built-in (`go test`, `cargo test`, `mix test`) — nothing to install; only conventions and docs.
- **Java/Kotlin**: JUnit 5 via the existing build tool.
- **Ruby**: RSpec (or Minitest if already present).
- **.NET**: xUnit.
- Anything else: the language's de-facto standard.

If two options are genuinely reasonable and the codebase gives no signal, briefly ask the user rather than guessing.

## Step 3 — Install and scaffold

1. Install the framework as a dev dependency **using the project's own package manager** (respect the lockfile).
2. Add minimal config only if required — prefer zero-config defaults over generated config files.
3. Wire a canonical entry point: `test` script in `package.json`, Makefile/justfile target, or note the native command (`go test ./...`). There must be **one obvious command** that runs the whole suite.
4. Create the test folder structure following the language's idiom, and the repo's existing layout if any:
   - JS/TS: colocated `*.test.ts` next to source, or `tests/` — follow existing repo convention; default to colocated.
   - Python: `tests/` mirroring the package, `test_*.py`.
   - Go: `*_test.go` next to source.
   - Rust: `#[cfg(test)]` modules + `tests/` for integration.
   - Java/Kotlin: `src/test/{java,kotlin}/...`.
5. Keep the footprint minimal: no coverage tooling, watch daemons, or CI config unless asked.
6. Zero-config is the preference, not a rule. If the project uses path aliases (`@/...` in
   `tsconfig.json`), the runner will not resolve them on its own — add the minimum config that
   maps them. For Vitest on an ESM-less `package.json`, name the file `vitest.config.mts` so the
   loader does not warn about ESM syntax in a CommonJS context.

## Step 4 — Verify with a smoke test

Write one trivial test (e.g. asserting a known truth against real project code if a pure function exists, otherwise a standalone sanity assertion), run the canonical command, and confirm it passes. If it fails, fix the environment before proceeding — this skill is not done until the suite runs green. Delete the placeholder smoke test afterwards **only if** it tests nothing real; keep it if it exercises actual project code.

## Step 5 — Record conventions

Instructions are split by how often they are needed. `CLAUDE.md` loads every session, so keep it
small; path-scoped rules in `.claude/rules/` load only when Claude reads matching files.

**Important:** path-scoped rules trigger on **Read**, not on Write or Edit. Scope test rules to the
**code under test** (`app/api/**`, `lib/**`), not only to `tests/**` — a new test file written from
scratch would otherwise never load them.

### 5a — `CLAUDE.md` (always loaded, keep it short)

Append (or update — don't duplicate) these sections:

```markdown
## Testing

- Framework: <framework>
- 전체 실행: `<command>` / 단일 파일: `<command> <path>`
- 테스트 위치: `<convention>`

## 워크플로

`grilling` → `to-spec` → `implement` → `spec-retire`

구현이 끝나면 `spec-retire`로 spec을 테스트·ADR로 이관하고 제거한다.
현행 명세는 `tests/`, 결정 근거는 `docs/adr/`다.
```

### 5b — `.claude/rules/` (복사한다. 다시 쓰지 않는다)

두 rule 파일은 프로젝트가 달라도 내용이 같으므로, 이 skill 폴더의 `templates/`에 완본으로 들어 있다.
**매번 생성하지 말고 복사한다** — 재작성하면 문구가 흔들리고 토큰만 든다.

```bash
mkdir -p .claude/rules
cp .claude/skills/tdd-setup/templates/testing.md .claude/rules/testing.md
cp .claude/skills/tdd-setup/templates/docs.md    .claude/rules/docs.md
```

skill이 프로젝트가 아니라 사용자 레벨에 설치돼 있다면, 이 `SKILL.md`가 있는 디렉토리의
`templates/`에서 복사한다.

| 파일 | 담고 있는 것 |
|---|---|
| `.claude/rules/testing.md` | seam 고정(route 핸들러 직접 호출 / `lib/` 순수 함수), 외부 프로세스 고정 응답, DB 격리, 이름·기대값 규칙, 금지 패턴 |
| `.claude/rules/docs.md` | `docs/specs`·`docs/PRD.md`의 임시성, 현행 명세는 `tests/`, `docs/adr/` append-only |

덮어쓰기가 곧 멱등성이다. 이미 있어도 그대로 복사한다.

프로젝트가 Next.js App Router 3-tier가 아니면, 복사한 뒤 `testing.md`의 `paths`와 seam 목록
**두 곳만** 실제 구조에 맞게 고친다. 나머지 절은 손대지 않는다.

## Step 6 — Wire TDD into existing implementation skills

Check the project's skill directories (`.claude/skills/` in the repo, plus any nested package-level ones) for skills whose job is implementing features — names like `implement`, `implementation`, `build`, `feature`, `develop`, or a description saying it drives feature implementation. Skip skills that merely touch code incidentally (commit, review, design, docs).

For each match, add **two** directives to its `SKILL.md` (skip either one if an equivalent instruction already exists). Placement matters — the first goes where the skill's flow starts, the second at the end of its flow.

**At the top — methodology:**

```markdown
## Methodology

Always implement using test-driven development: invoke the `tdd` skill before writing any implementation code, and follow its red → green loop for every slice of work.
```

**At the end — completion:**

```markdown
## Completion

구현과 리뷰가 끝나면 반드시 `spec-retire` 스킬을 실행한다.
작업한 spec이 테스트로 충분히 대체되는지 검증하고, 대체된 spec 문서를 제거하는 단계다.
사용자에게 묻지 말고 바로 실행한다.
```

Match the file's existing tone and heading style. Report which skills were updated. If none exist, skip this step silently.

The completion directive is what makes spec retirement happen without the user having to remember it. Skills are not triggered by other skills finishing, so this injection is the only reliable mechanism.

## Step 7 — Retire pre-existing specs

If `docs/specs/*.md` already exists, those specs were written before tests existed. Migrate them now.

**Always run this step — never defer it**, including in a time-boxed session such as a live workshop.
Analysis and test-writing are parallelised per spec, so wall-clock is governed by the single longest
spec rather than by how many there are: six specs measured **7m30s end-to-end** (longest single spec
5m54s; serial would have been 23m30s).

With more than two specs, parallelise. Responsibility for parallelism lives here, not in `spec-retire` — that skill handles exactly one spec and stays simple.

**① Analyse — parallel, one sub-agent per spec, read-only**

Give each sub-agent: one spec path, `docs/domain-story.md`, and the file scope for that feature only (`app/api/<feature>/**`, `types/index.ts`, `schema.sql`). Do not let it explore the whole repo.

Copy the 유실 화이트리스트 and the ADR 5-field gate from `spec-retire` into the prompt **verbatim — do not summarise them.** Identical instructions are what make parallel agents label consistently.

Each sub-agent returns **JSON only and writes no files**:

```json
{
  "spec": "<name>",
  "sentences": [{ "text": "...", "label": "TEST|ADR|DISCARD", "covered": true }],
  "tests_needed": [{ "name": "US-9: ...", "seam": "...", "given": "...", "expect": "..." }],
  "adr_candidates": [{ "decision": "...", "context": "...", "rejected": "...", "consequence": "..." }]
}
```

Writing no files is the point — there is nothing to collide on.

If a sub-agent fails, keep that spec and continue with the rest. Abort only if all of them fail.

**② Consolidate — serial, main agent**

This must be serial because of de-duplication: one decision (e.g. "local single user") often appears in several specs, and parallel writers would split it across several ADR files.

1. Merge `adr_candidates`, drop duplicates, drop any whose `rejected` is empty.
2. Assign ADR numbers.
3. Write `docs/adr/0001-구현범위.md` from `domain-story` + PRD + all labels, following the
   template in `spec-retire` — including its fixed `검증되지 않는 것` section, which is where the
   Presentation-layer sentences discarded under whitelist item 5 are accounted for.
4. Write shared test fixtures/helpers so the next stage only references them. At minimum:
   an isolated-database fixture (temp dir + `schema.sql` copy + `chdir` + `resetModules`), a stub
   for any external process the app spawns (keep its state on `globalThis`, not in a module-level
   `const` — `resetModules` would otherwise split it), and a parser for whatever streaming format
   the routes emit. Writing these once here is what keeps stage ③ from failing the same way in
   every sub-agent.

**③ Write tests — parallel, one sub-agent per spec**

Spec-to-test-file is 1:1, so concurrent writes are safe. Each sub-agent writes `tests/<spec>.test.ts` from its `tests_needed` list, then runs **only its own file** to green. Keep the per-file run here: it is parallel, whereas fixing failures in ④ is serial.

**④ Finalise — serial**

Run the whole suite. Any failure means an unimplemented spec sentence — report it and keep that spec. Then write the ADR files, delete the retired specs (and `docs/PRD.md` if all specs are gone), and commit via the `commit` skill with the label counts in the body.


## Step 8 — Report

Tell the user what was installed, the run command, the folder convention, and that `/tdd` is now ready to use.

Also report: which skills were updated with the completion directive, which rules files were written, and — if Step 7 ran — how many specs were retired with the test/ADR/discard counts.
