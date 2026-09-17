---
name: tdd
description: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.
---

# Test-Driven Development

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle — consult them before and during the loop, not after.

**Prerequisite:** a working test environment. If the project has no test runner configured (no test command, no framework installed), run the `tdd-setup` skill first — check `CLAUDE.md` for a `## Testing` section describing how to run tests.

When exploring the codebase, read `CONTEXT.md` (if it exists) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification — "user can checkout with valid cart" tells you exactly what capability exists — and survives refactors because it doesn't care about internal structure.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

**Name tests after their source.** When a test exists because a spec sentence or user story required it, put that reference in the name: `US-9: 어느 관점이든 high면 종합이 high가 된다`. Once the spec document is retired, the test name is the only remaining trace of where the requirement came from.

## Seams — where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test only at pre-agreed seams.** Before writing any test, establish which seams are under test. You can't test everything — settling the seams up front is how testing effort lands on the critical paths and complex logic instead of every edge case.

Check the project's configuration first — a `## 테스트 seam` / `## Test seams` section in `CLAUDE.md`, or a rules file under `.claude/rules/`. **If the seams are defined there, follow them and do not ask.** The project has already made this decision; re-asking stalls sessions where the user is not a developer.

Only when no definition exists, ask: "What's the public interface, and which seams should we test?" No test is written at an unconfirmed seam.

**Load the rule before writing.** Path-scoped rules in `.claude/rules/` trigger when Claude *reads* a matching file — not when it writes one. Read the code under test (the route handler, the module) **before** creating the test file, so its rules are in context while you write.

## External processes and model calls

A subprocess that calls a language model (`claude -p`, an API client) is not a seam you test through. Its output is not deterministic, so any assertion on *what it says* is flaky by construction.

Cut at the boundary: replace the call with a fixed response, and test what the system does with it. "Given the four perspectives returned high/low/low/failed, the combined grade is high and the recommendation is downgraded" is fully deterministic and is the behaviour worth locking down.

Expectations about the *quality* of model output — that a prompt catches a certain kind of anomaly — belong in the prompt file, not in a test.

## Anti-patterns

- **Implementation-coupled** — mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological** — the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth — a known-good literal, a worked example, the spec.
- **Horizontal slicing** — writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead — one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review stage (see the `code-review` skill), not the red → green implementation cycle.
