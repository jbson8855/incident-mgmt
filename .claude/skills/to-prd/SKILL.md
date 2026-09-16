---
name: to-prd
description: Synthesize the agreed requirements into a single project-level PRD and save it to docs/PRD.md — no interview, just synthesis. The PRD names the full list of features, each of which later becomes its own spec via /to-spec.
---

This skill produces one project-level PRD from requirements that have already been agreed. Do NOT interview the user; that has already happened (in /grilling and /scaffold). Just synthesize.

Your inputs, in priority order:

1. **`docs/domain-story.md`**, if it exists — the authoritative account of the user's work. It carries the actors, the work objects, the sequence, the exceptions, what "done" means, and the user's own terms. Read it before anything else. Because it is a file, this skill works in a **fresh session**: you do not need the original interview in context.
2. The current conversation, for build decisions made during /scaffold.

The PRD sits one level above the feature specs: it frames the whole project and, crucially, names the **full list of features** that will each get their own spec via /to-spec.

## Process

1. Read `docs/domain-story.md` if present. Explore the repo to understand the template's current state, if you haven't already. If the project documents a domain glossary or any ADRs, use that vocabulary and respect those decisions.

2. **Write in the user's words.** Every term in the domain story's 용어 table is the name to use in the PRD — do not invent synonyms or translate them into generic product language. The feature names you choose should be recognisable to the person who was interviewed.

3. Write the PRD using the template below and save it to `docs/PRD.md` (create `docs/` if it doesn't exist).

<prd-template>

## Problem Statement

The problem the user is trying to solve, from their perspective.

## Solution

The product you're going to build, from the user's perspective — what it does and who it's for.

## Features

A numbered list of every feature the project will include. For each feature give:

- **<kebab-case-name>** — a one-or-two sentence description of what it does, from the user's perspective.

This list is the contract for the rest of the workflow: /to-spec is run once per feature here, writing `docs/specs/<kebab-case-name>.md`. Make the list complete, and make each feature a coherent unit that can be specced on its own.

## Scope & Priorities

Which features are core vs. nice-to-have, and any sensible build order.

## Out of Scope

Things explicitly not being built, and why — especially anything ruled out during the feasibility review.

## Further Notes

Constraints, decisions, or context that affect the project as a whole (not a single feature).

</prd-template>
