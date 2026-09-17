---
name: commit
description: Create git commits following project conventions. Use this skill whenever committing changes — it enforces the project's prefix rules, message style, and commit separation policy. Triggers for any commit request, "커밋해줘", "commit this", "commit push", or when wrapping up a task that produced file changes.
---

# Commit

Create git commits that follow project conventions.

## Message format

```
prefix: concise imperative message
```

- Always in **Korean**
- 단, 기술적 용어(skill, hook 등)나 내부 asset/data 이름(멤버명, 파일명 등)은 영어 그대로 표기
- Keep it short — one line, no period at the end

## Commit separation

Split commits by purpose. Each commit should represent one feature, or logical change. If a task produced multiple distinct changes, commit them separately.
**Do not** bundle unrelated changes into a single commit just because they happened in the same session.

## Invariants

- 커밋 메시지는 반드시 **한국어**여야 한다 (기술 용어·asset명은 영어 허용)
- `prefix: message` 형식을 유지한다. prefix 없이 커밋하는 것도 허용된다
- 관련 없는 변경을 하나의 커밋에 묶지 않는다 — 항상 목적별로 분리한다
- `git commit -m "message" -- file1 file2` 순서를 깨뜨리지 않는다 (`--` 뒤에 `-m`을 두면 안 된다)

## Gotchas

- Always run `git status` before committing to verify only intended files are staged. Use `git commit -m "message" -- file1 file2` to commit specific files, or `git reset HEAD <file>` to unstage unwanted ones.
- When committing specific files with `--`, always place `-m "message"` **before** `--`. Everything after `--` is treated as a file path, so `-m` placed after it will be misinterpreted as a filename.
  ```bash
  # correct
  git commit -m "message" -- file1 file2
  # wrong — "-m" is parsed as a file path
  git commit -- file1 file2 -m "message"
  ```
