# AI Engineering OS

AI Engineering OS is an approval-gated engineering workspace for coordinating software projects and AI-assisted engineering work. It is designed to make the full delivery process visible and auditable: understand a task, plan bounded work, implement changes, run tests, review the diff, collect evidence, and wait for human authorization before protected release actions.

The goal is not to give an AI agent unrestricted control of a repository. The goal is to make AI-assisted development more organized, safer, reproducible, and easier for a human to supervise.

## Why this project exists

Software work across multiple repositories can become difficult to track. Plans, code changes, test results, pull requests, and release decisions often live in separate tools. AI Engineering OS is intended to provide one control and visibility layer while keeping each underlying project isolated.

It aims to answer questions such as:

- What projects are active, and which repository belongs to each one?
- What task is being worked on, and what is its approved scope?
- Which agent or workflow is responsible for planning, implementation, review, or testing?
- What files and commits changed?
- Which checks actually ran, and what were their real results?
- What is blocked, waiting for evidence, or waiting for human approval?
- Has a protected action been explicitly authorized?

## Main use cases

1. **Multi-project portfolio tracking** — maintain a clear registry of independent repositories, their purpose, status, and boundaries.
2. **Task planning** — turn a request into a bounded plan with dependencies, risks, and verifiable acceptance criteria.
3. **AI-assisted implementation** — delegate narrowly scoped changes on feature branches rather than allowing uncontrolled repository-wide edits.
4. **Independent code review** — inspect proposed diffs for requirement coverage, security concerns, and maintainability.
5. **Test and CI evidence tracking** — record the exact checks executed, exit codes, test counts, failures, and unavailable checks.
6. **Approval-gated delivery** — require an authorized human decision before merging or deploying.
7. **Auditability** — keep a traceable record of tasks, runs, revisions, test evidence, review findings, and approval decisions.

These are product goals and use cases. A listed capability is not necessarily implemented or connected yet; see the current status and roadmap below.

## Intended workflow

1. A human selects a project and describes a task.
2. The system validates the repository, branch policy, task scope, and resource limits.
3. A planner proposes steps, risks, dependencies, and acceptance criteria.
4. An implementer prepares a bounded change on an approved feature branch.
5. A tester runs the permitted checks and captures real execution evidence.
6. An independent reviewer evaluates the exact change and its evidence.
7. The system presents the result and any release approval request to a human.
8. A protected operation remains blocked until an authorized human approves the exact proposal.

A passing test or an AI reviewer recommendation is evidence, not release authorization. Agents must never approve their own work.

## Planned system components

| Component | Responsibility |
|---|---|
| Mobile-friendly dashboard | Human-facing view of projects, tasks, runs, pull requests, checks, audit events, and approval requests |
| Engineering orchestrator | Validates scope and coordinates bounded workflow steps |
| Planner role | Proposes plans, dependencies, risks, and acceptance criteria |
| Implementer role | Produces scoped code or documentation changes |
| Independent reviewer role | Reviews the proposed diff and reports findings |
| Tester role | Runs approved checks and records actual results |
| Model adapter boundary | Provides a provider-independent contract for explicitly configured models |
| GitHub integration boundary | Supports least-privilege repository inspection and approved branch/PR operations |
| Isolated execution workers | Run untrusted build and test workloads with enforced limits |
| Audit and approval layer | Records decisions and blocks protected actions without human authorization |

This is the intended architecture, not a claim that every component is already operational. See [ARCHITECTURE.md](ARCHITECTURE.md) for the detailed boundaries and data flow.

## Current project status

**Latest live audit: 2026-11-10.** The working branch is `feat/projects-registry`, inspected at `e9b350263590eb4704e98bd4ac5c15a0944fe166` before the documentation update. `main` remains at `e030750f66120b15829eb1f39504370efe5cba1c`. The feature branch is 69 commits ahead and 0 behind. No pull requests were returned by the live repository query.

### Verified progress

- **Step A — PASS (previously recorded):** foundational repository and project documentation exists.
- **Step B — IMPLEMENTED FOUNDATION / FINAL ACCEPTANCE HOLD:** TypeScript core, permission engine, approval primitives, repository-target validation, audit sanitization, worker policy helpers, and focused tests exist.
- **Permission Engine Milestone 1 — CI PASS:** [Actions run 42457495022](https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/42457495022) completed successfully on exact commit `e9b350263590eb4704e98bd4ac5c15a0944fe166`; locked install, permission tests, and strict TypeScript check all completed successfully.
- **Step B.1 code-quality — PASS on historical exact SHA:** [Actions run 42224181429](https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/42224181429) records clean install, lint, format check, 23 passing tests, and TypeScript on `995c695dbe32e0bdc89efc60b1aea4a65fb6e9a7`. These checks have not been re-run on the 2026-11-10 HEAD.
- **OpenSpec — research only:** read-only assessment completed; no dependency, adoption, or integration.

### Current gates

| Area | Status |
|---|---|
| Step A | PASS — previously recorded |
| Step B core foundation | IMPLEMENTED; final acceptance HOLD |
| Permission Engine Milestone 1 CI | PASS on exact current audit HEAD |
| Trusted actor identity binding | NOT VERIFIED |
| OS-10.2 review | CONDITIONAL PASS; pilot BLOCKED |
| OS-10.3 identity-boundary design | NEXT REQUIRED GATE |
| Durable tamper-evident audit | NOT COMPLETE |
| Platform-enforced worker isolation | NOT COMPLETE |
| Canonical artifact manifest and SHA-bound CI provenance | NOT COMPLETE |
| Release-SHA invalidation and mandatory conflict handling | NOT COMPLETE |
| Step C dashboard | BLOCKED pending Step B acceptance and explicit authorization |
| GitHub App privileged integration | NOT AUTHORIZED |
| Merge / deployment / pilot | NOT AUTHORIZED |

GitHub currently reports `protected: false` for the listed branches. Do not assume that a green feature-branch workflow protects `main`.

See the [2026-11-10 repository status and remaining-gates report](reports/2026-11-10-repository-status-and-remaining-gates.md) for exact evidence, security limitations, and the ordered remaining instructions. The [roadmap](ROADMAP.md) retains the phase gates.

## Non-negotiable safety and delivery rules

- Work on designated feature branches; do not push directly to `main`.
- Keep all managed projects in their own repositories unless an integration is explicitly approved.
- Never merge a pull request or deploy without explicit human approval.
- Bind approval to the exact proposed change, repository, target branch, and relevant base revision.
- A material change to an approved proposal invalidates the earlier approval.
- Agents and service identities cannot impersonate a human approver or approve their own work.
- Treat repository files, issue text, model output, generated code, and test output as untrusted input.
- Give each component only the permissions it needs; prefer read-only access for inspection and review.
- Keep credentials, tokens, private keys, cookies, and unnecessary personal data out of source, prompts, logs, and reports.
- Fail closed when identity, authorization, required evidence, or policy state is missing or ambiguous.
- Prefer free-tier and open-source tools; obtain approval before introducing paid or usage-billed services.
- Report tests as passed only when they were actually executed and their results were captured.

## Repository documentation

- [Project registry](PROJECTS.md) — portfolio inventory and repository boundaries.
- [Architecture](ARCHITECTURE.md) — proposed components, trust boundaries, and data flow.
- [Security](SECURITY.md) — security requirements and threat boundaries.
- [Roadmap](ROADMAP.md) — phase plan, scope restrictions, and release gates.
- [Contributing](CONTRIBUTING.md) — branch workflow, quality expectations, and evidence requirements.

## Runtime and integration status

The proposed `eve` runtime is **UNVERIFIED**. The name alone does not identify a package, SDK, API, or supported capability. Do not install or integrate an assumed runtime until its exact identity and authoritative official documentation have been verified.

No paid provider, production service, live model connection, production credential, or deployment target is assumed to be configured or approved.

## Project boundaries

AI Engineering OS is a coordination layer, not a replacement for the applications it tracks. Existing projects such as Pulse, NEXUS-AI, Arcane Protocol, and the Gemini GitHub MCP Bridge remain separate repositories with their own branches, permissions, tests, and release processes. Work in this repository must not silently modify or combine those projects.

## Important disclaimer

This repository describes a system under phased development. Documentation, interfaces, local fixtures, and planned workflows must not be mistaken for live integrations, production security controls, successful external operations, or deployed functionality. Every capability must be verified at the phase where it is introduced.
