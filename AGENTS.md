# Agent Guidelines — bot-whatsapp-node

This repository contains a production WhatsApp accounting automation bot for Luxury Gotti. Agents working in this repository must strictly adhere to the following directives.

---

## 1. Mandatory Plan Approval Before Source Code Changes

Before modifying, creating, or deleting any source code file, the agent **MUST** present a detailed plan containing:

1. **What is changing** — Problem summary and proposed technical solution.
2. **Affected files** — Exact list of files to be modified, created, or deleted.
3. **What is removed** — Code, logic, or dependencies being eliminated.
4. **What is added** — New code, logic, tests, or dependencies being introduced.
5. **Why** — Technical justification and trade-offs considered.

The agent must halt and wait for explicit user approval before executing any code modifications.

### Exceptions (no prior approval required)
- Trivial syntax typo fixes.
- Adding non-functional comments or documentation updates.
- Read-only diagnostics commands (`tsc --noEmit`, `git status`, `ls`, etc.).

---

## 2. Language & Phrasing Policy (ADR 0002)

- **Public artifacts in English:** Commit messages, `README.md`, `docs/*.md`, ADRs, GitHub issues, pull requests, new code identifiers, and comments. Never execute a big-bang rename of existing Spanish code identifiers.
- **Private/internal artifacts in Spanish:** Personal notes under `docs/internal/` (gitignored).
- **Domain strings stay in Spanish permanently:** OpenAI prompts, banking keywords (`'nequi'`, `'consignación'`), and product terms process real Colombian Spanish text and must not be translated.
- **Conversations:** May occur in English or Spanish per user preference.

### Active English Learning Loop
The project owner is actively breaking through the B1/B2 English plateau to advance into DevOps/SRE roles.
- When the user prompts in English with raw grammar or unconventional vocabulary, the agent should optionally append a **concise 1-line "Idiomatic Phrasing Tip"** at the bottom of the response.
- Highlight high-leverage technical verbs and SRE terminology (*e.g., mitigate, decouple, reconcile, persist, bottleneck, throttle*).
- Keep it concise so it does not distract from the engineering task.

---

## 3. Official Issue Tracker & Workstreams

The single source of truth for work is **GitHub Issues** on this repository (`gh issue ...`).

- **Workstream Label Prefixes:**
  - `platform:*` — Infrastructure hardening, Docker, CI/CD, observability, SRE practices (see `docs/roadmap.md`).
  - `wayfinder:*` — Data extraction accuracy and business logic precision (see Issue #11).
- **Type Labels:** `task`, `research`, `grilling`, `prototype`.
- **Dependencies:** Every issue must declare its blocking edges in the body as `Blocked by: #N` or `Blocked by: none`.

---

## 4. Documentation & Domain Model Reference

- **Domain Glossary:** Refer to `CONTEXT.md` for ubiquitous language definitions.
- **Architecture Overview:** Refer to `docs/architecture.md` for end-to-end event flows and state lifecycle.
- **Platform Roadmap:** Refer to `docs/roadmap.md` for operational milestones (Phases 0–5).
- **Architectural Decisions:** Refer to `docs/adr/` before introducing breaking architectural shifts.
- **Official Library Docs:** When consulting third-party library documentation (OpenAI, Baileys, etc.), utilize `context7` tools where available.
