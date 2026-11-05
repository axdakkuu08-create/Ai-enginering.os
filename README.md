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

<badge>Step A — PASS</badge> Architecture, repository inspection, project registry, and foundational documentation are complete.

<badge>Step B — HOLD</badge> GitHub Actions run [41817857911](https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/41817857911) succeeded on branch HEAD `fef0116d`, including the recorded Vitest and TypeScript verification steps. The uploaded audit artifact exists, but its detailed contents and test counts still require review before final Step B acceptance.

| Phase | Goal | Status |
|---|---|---|
| Step A | Architecture, inspection, and documentation | PASS |
| Step B | TypeScript scaffold and core policy interfaces | HOLD — successful CI audit; artifact review and remaining acceptance evidence pending |
| Step C | Mobile dashboard with deterministic demo data | NOT STARTED — requires Step B acceptance and explicit human authorization |
| Step D | Non-deploying CI and security workflows | PLANNED — requires prior phase approval |

The current status is evidence-based and may change only after review. See [ROADMAP.md](ROADMAP.md) and the [2026-11-05 status report](reports/2026-11-05-repository-and-portfolio-status.md) for phase scope and exit criteria.

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
