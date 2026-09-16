---
name: scaffold
description: Entry point for a fresh copy of this template. Takes a non-developer's requirements, checks them for feasibility against the template, clarifies anything ambiguous, then drives /to-prd and /to-spec to produce the project's PRD and per-feature specs. Use when someone first sets up the template, or asks to scaffold / kick off / plan a new project from requirements.
disable-model-invocation: true
---

This is the first skill a user runs after downloading this template codebase. The user describes what they want to build — **assume they are a non-developer**. Your job is to turn their requirements into a feasible, fully-specified plan, then generate the project PRD and the per-feature specs.

Throughout, talk to the user in their own language and in plain, non-technical terms. Work through the stages below in order.

## 0. Pick up the domain story

If `docs/domain-story.md` exists, **read it first and treat it as the requirements**. It was produced by `/grilling` and already captures the actors, the work objects, the sequence, the exceptions, and what "done" means — in the user's own vocabulary. Use that vocabulary for the rest of this skill and for everything you write.

If it does not exist, ask the user to describe what they want to build, and suggest they run `/grilling` first if they would rather be interviewed about their work than write it out.

## 1. Understand the template

Explore the codebase to learn what the template already provides — its stack, structure, and the capabilities it ships with. Feasibility is judged against this: what's easy here, what needs building, and what doesn't fit.

## 2. Feasibility review

Read the user's requirements and assess each one against the template:

- **Straightforward** — the template already supports this, or it's a small addition.
- **Significant** — buildable, but it's real work or new infrastructure.
- **Risky / out of scope** — doesn't fit the template, needs something it can't reasonably provide, or is very large.

Tell the user where each requirement lands, in plain language. Be honest about cost and risk — a non-developer can't see it otherwise.

## 3. Resolve only what the domain story cannot answer

**Do not re-interview the user about their work.** If `/grilling` ran, that ground is already covered — asking again wastes their time and makes the process feel circular. Anything about who does what, in what order, with what, and what counts as finished is settled: read it from the domain story.

Ask only where a **build decision** genuinely changes what the user ends up with, and where the codebase cannot decide it for you. Everything else you decide yourself.

For every question you do ask:

- Frame it as a consequence, not a technical choice: what they get either way, never how it is built.
- When there are multiple options, explain each option's **impact** (what it changes for them — cost, effort, what the product can or can't do) and its **importance** (how much this choice actually matters), so they can judge it.
- Give your **recommended** option and say why.
- Ask **one question at a time**, waiting for each answer before the next.
- If a question can be answered by exploring the codebase, do that instead of asking.

Stop as soon as the plan is buildable. Completeness for its own sake is not the goal here.

## 4. Produce the PRD

Run /to-prd to write the project's PRD. The PRD names the full list of features to be built.

## 5. Confirm the feature list — stop and wait here

Show the user the feature list from the PRD: the names and one-line descriptions only, in plain language. Ask whether it matches what they had in mind — anything to drop, anything to merge, anything missing.

**Wait for their answer before going further.** This is the last point where the user can steer the build, and the feature list is the only layer they can actually judge: the names come from their own vocabulary, so they can tell at a glance whether it is their work or not. Spec-level detail is not something a non-developer can evaluate, so do not raise it here.

If they ask for changes, update `docs/PRD.md` first, then show the revised list and confirm again.

Once they approve, tell them the next step writes one document per feature and takes a few minutes, so they know what the wait is for.

## 6. Produce the specs

For **every** feature listed in the approved PRD, run /to-spec to write that feature's spec under `docs/specs/`.

Finally, report back the PRD location and the list of specs you created.
