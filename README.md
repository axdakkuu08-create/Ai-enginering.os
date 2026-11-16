# AI Engineering OS

AI Engineering OS is an approval-gated engineering workspace for coordinating software projects and AI-assisted engineering work. It is designed to make the full delivery process visible and auditable: understand a task, plan bounded work, implement changes, run tests, review the diff, collect evidence, and wait for human authorization before protected release actions.

The goal is not to give an AI agent unrestricted control of a repository. The goal is to make AI-assisted development more organized, safer, reproducible, and easier for a human to supervise.


## Product identity

**Positioning:** A zero-trust operating system for AI-assisted software engineering.

AI Engineering OS is intended to be the control and visibility layer between people, software repositories, AI agents, engineering workflows, and release decisions. It coordinates work without granting agents unrestricted authority over the projects they assist.

The product is designed around five outcomes:

- **Visibility:** understand project, repository, branch, task, pull-request, and verification status from one workspace.
- **Controlled autonomy:** let agents perform bounded, explicitly permitted work while keeping privileged operations behind human authorization.
- **Verifiability:** connect every reported result to the exact commit, command, test output, and review evidence that supports it.
- **Traceability:** preserve an auditable history of requests, policy decisions, changes, checks, and approvals.
- **Project isolation:** manage multiple independent repositories without silently combining their code, credentials, or release processes.

## Professional experience direction

The intended interface is a **Dark Enterprise Engineering Console**: an accessible, mobile-friendly workspace with an obsidian/graphite foundation, restrained emerald accents, clear typography, compact information hierarchy, and explicit status labels. The visual design should prioritize operational clarity over decoration.

Planned navigation areas are Overview, Projects, AI Agents, Permissions, Verification, Audit & Evidence, and Approvals. These are product-design intentions, not a claim that the screens or integrations are already implemented.

## Operating model

The system should distinguish clearly between these authority levels:

| Level | Meaning | Default posture |
|---|---|---|
| Observe | Read repository and workflow information | Least-privilege read access |
| Inspect | Analyze code, configuration, and evidence | Read-only |
| Verify | Run explicitly permitted checks | Scoped and recorded |
| Propose | Prepare a change or protected-action request | No implicit execution authority |
| Write | Modify an approved feature branch or pull request | Explicitly scoped permission |
| Merge / deploy | Perform release-affecting operations | Privileged; explicit human approval required |

An AI recommendation, successful test, green CI check, or generated report is not itself authorization to merge or deploy.

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

**Latest documented assurance decision: 2026-11-16 — HOLD.** The current assurance update is recorded in [ROADMAP.md](ROADMAP.md) on branch `security/os-10.3-zero-budget-assurance`. This README describes the product direction; the roadmap is the source of truth for phase gates and the latest assurance position.

### OS-10.3 assurance position

- The release decision remains **HOLD**.
- Reconstructed review documents exist under `docs/os-10.3/export/`, but they are not recovered originals.
- The original review archive, original ten-artifact set, original `SHA256SUMS`, and raw citation-check logs have not been fully recovered.
- Four security findings remain subject to independent review: trusted actor identity binding; approval authenticity and freshness; approval-to-request context binding; and durable, tamper-evident audit completeness.
- Characterization tests that intentionally demonstrate missing controls are not passing security controls.
- Independent human assurance is not complete. Green CI or a documentation update does not lift the release gate.

### Delivery boundary

No release, pilot, merge, deployment, or privileged GitHub App operation is authorized by this status summary. Keep `main` untouched. Consult [ROADMAP.md](ROADMAP.md) for the current ordered gates and evidence requirements before proposing further work.

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
