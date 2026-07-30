# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository. Every fact here is derived from the tree; where this
file and a source-of-truth file disagree, the source-of-truth file wins and
this file is the one to fix.

## Project overview

This repository is the Sense360 **Home Assistant add-on repository**
(`repository.yaml` at the root). It currently ships one add-on, **Sense360
Zone Studio** (`zone-studio/`): an interactive radar and sensor zone
configuration studio for Sense360 rooms (LD2450 spatial zones, SEN0609 range
band). The frontend and backend meet at a single client contract
(`zone-studio/src/client/`); the canonical data model lives in
`zone-studio/src/domain/`. User-facing documentation is
`zone-studio/DOCS.md`; decisions in `DECISIONS.md`; roadmap in `ROADMAP.md`.

Within the Sense360 programme this repository **owns the zone-configuration
guidance surface**: Zone Studio usage documentation lives here and is linked
from other surfaces, never duplicated into them.

## Commands

```bash
cd zone-studio
npm ci
npm run typecheck    # CI gate
npm run build:web    # CI gate (then: node scripts/assert-relative-assets.mjs)
npm run build:server # CI gate
npm test             # vitest suite, CI gate
npm run lint         # CI gate
```

CI is `.github/workflows/ci.yaml` (frontend job + add-on linter).
`.github/workflows/build.yaml` builds and publishes Docker images to GHCR on
tag push / release publish — it is release-capable and owner-only (see below).

## Cross-repository operating model

Before any cross-repository work, Claude Code must read
[`sense360store/SOT/CLAUDE-OPERATING-MODEL.md`](https://github.com/sense360store/SOT/blob/main/CLAUDE-OPERATING-MODEL.md).

- **SOT owns programme-level truth**: accepted cross-repository decisions,
  programme IDs, cross-repository status, and owner actions.
- **esphome-public owns firmware truth**; **WebFlash owns distribution**.
  This repository must not claim firmware behaviour that esphome-public has
  not proven, and must not restate commercial state that SOT has not decided.
- **This repository owns** the Zone Studio add-on: its architecture,
  implementation, tests, add-on packaging, and the zone-configuration user
  guidance surface.

### Bounded agent autonomy (AGENT-BOUNDED-AUTONOMY-001)

This repository **adopts AGENT-BOUNDED-AUTONOMY-001**, the bounded agent
autonomy contract defined in the *AGENT-BOUNDED-AUTONOMY-001: bounded
autonomy* section of
[`sense360store/SOT/CLAUDE-OPERATING-MODEL.md`](https://github.com/sense360store/SOT/blob/main/CLAUDE-OPERATING-MODEL.md).
SOT owns the contract and all programme-level authority. Adoption
provenance: verified against SOT `main` commit
[`de11c392e1c6bee0844d5c2f1244f8da9af95888`](https://github.com/sense360store/SOT/commit/de11c392e1c6bee0844d5c2f1244f8da9af95888)
(contract present, including the conditional merge delegation and the
review-and-decide delegation; the SOT rollout plan names
`sense360store/Sense360Zones` as an adopting repository with add-on
publication tightening). The canonical link stays pointed at SOT `main`; the
contract text is **not duplicated here**, and tasks invoke it with the
canonical SOT invocation block rather than restating its rules.

This `CLAUDE.md` provides **repository-local tightening** on top of the SOT
contract. Local rules may tighten but never loosen the SOT contract; where
rules differ, the stricter safety rule wins; an authority conflict the SOT
precedence rules cannot resolve ends the run as
`BLOCKED_AUTHORITY_CONFLICT`, never a judgement call. The five SOT terminal
states apply exactly as defined; this repository defines no sixth state.

**Never autonomous in this repository** (add-on publication tightening — each
line restates or narrows, never widens, the SOT owner reservations):

- create or publish a tag or GitHub Release — `build.yaml` publishes Docker
  images to GHCR on tag push / release publish, so tagging **is** releasing
  here;
- dispatch, edit the triggers of, or otherwise cause a run of any workflow
  that can publish images or artifacts (in particular
  `.github/workflows/build.yaml`);
- bump the add-on `version` in `zone-studio/config.yaml` or author a
  `CHANGELOG.md` release entry that presents a release as published — the
  version bump is what offers updates to installed Home Assistant instances;
- publish or list the add-on (or any successor) in any add-on store, HACS
  listing, or registry, or change `repository.yaml` identity;
- claim firmware, hardware, bench, compliance, or commercial state — those
  belong to esphome-public, the owner, and SOT respectively;
- merge any PR, **except** exactly as permitted by the conditional merge
  delegation adopted below — which never covers the agent's own PR.

#### Conditional merge delegation (adopted 2026-07-30)

This repository **adopts the conditional merge delegation** defined in the
*Conditional merge delegation* section of
[`sense360store/SOT/CLAUDE-OPERATING-MODEL.md`](https://github.com/sense360store/SOT/blob/main/CLAUDE-OPERATING-MODEL.md),
on the owner's explicit instruction of 2026-07-30, quoted below. Before this
adoption, merging was never autonomous here; the SOT delegation does **not**
transfer by implication and this section is what makes it apply.

An agent may merge a PR in this repository **if and only if all four** hold:

1. the PR reached `READY_FOR_OWNER_REVIEW`;
2. an owner message explicitly names that PR as accepted, **naming the
   repository, the PR number and the exact head SHA it accepts**;
3. CI is green on the exact head being merged;
4. merges occur in programme dependency order.

**Head-binding.** Acceptance binds a PR and a head SHA together. If the head
moves after acceptance for any reason, merge authority for that PR lapses
immediately: the agent reports the new head and requests fresh acceptance,
and never merges a head the owner has not named.

**Repository qualification.** An acceptance that does not name the
repository is invalid here and confers no merge authority. PR numbers
collide across Sense360 repositories, so a bare number could authorise a
merge in the wrong repository; the agent reports the ambiguity rather than
resolving it.

**Never permitted:** merging a PR no owner message names as accepted,
regardless of state; merging a head SHA no owner message names;
self-accepting a PR the agent authored, including a governance amendment
that would create or widen the agent's own authority; treating CI green, a
clean mergeable state or owner silence as acceptance.

**Bootstrap.** No delegated merge occurs in this repository until the owner
has accepted the PR that introduces this adoption; that acceptance follows
the same repository-qualified, head-bound format.

Authorising instruction, owner message of 2026-07-30 (SENSE360-CUSTOMER-DOCS-001
programme authorisation), quoted:
"sense360zones joins the governed set with this programme. Its first PR
adopts the operating model and merge delegation into its CLAUDE.md by the
same mechanical adoption pattern esphome-public used; that adoption PR is
held for owner acceptance before any delegated merge occurs there."

This adoption is governance text only: it changes no add-on code, version,
image, workflow, release, or store state.
