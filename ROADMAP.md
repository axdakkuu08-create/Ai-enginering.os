# Roadmap

**Status:** Planned phases. A phase is complete only when its evidence is reviewed and the human owner explicitly authorizes progression.

## Release principles

- Work only on the designated feature branch for the current phase.
- Keep `main` unchanged during development.
- Do not merge or deploy without separate explicit human approval.
- Separate verified implementation from planned capabilities.
- Prefer free-tier and open-source options; obtain approval before introducing paid or usage-billed services.
- Treat external content, repository files, model output, and generated artifacts as untrusted.
- Preserve project registry data and existing documentation.

## Latest verified status — 2026-11-05

- Working branch: `feat/projects-registry`.
- Inspected branch HEAD before this documentation update: `fef0116d0afe4b4a8c982bd1f51af8d19b73ff71`.
- Inspected `main` HEAD: `e030750f66120b15829eb1f39504370efe5cba1c`.
- GitHub Actions Step B audit run [41817857911](https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/41817857911) completed successfully on that branch HEAD. The job records successful Vitest and TypeScript verification steps and an uploaded audit artifact.
- The artifact archive has not yet been independently inspected, so Step B final acceptance remains **HOLD** pending artifact review and remaining exit-criteria review.
- Step C remains **NOT STARTED**. It requires Step B acceptance and separate explicit human authorization.
- No workflow, merge, deployment, or `main` update is part of this report.

See [the 2026-11-05 repository and portfolio report](reports/2026-11-05-repository-and-portfolio-status.md) for the evidence boundary and portfolio notes.

## Step A — Architecture and repository inspection

**Objective:** Establish a trustworthy documentation baseline.

**Scope:** Inspect the repository, branch history, current files, configuration, and workflows. Create or update only Markdown documentation.

**Deliverables:**
- `README.md`
- Preserved `PROJECTS.md`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `ROADMAP.md`
- `CONTRIBUTING.md`

**Mandatory gates:**
- Work only on `feat/projects-registry`.
- No application code, UI components, agent logic, scaffold packages, or workflows.
- Record the starting `main` SHA and verify it remains unchanged.
- Preserve all existing project entries in `PROJECTS.md`.
- Explicitly mark `eve` as unverified; do not invent a package or SDK.

**Exit evidence:** Commit SHA, branch comparison, changed-file list, full documentation review, project-entry preservation check, and confirmation that `main` is unchanged.

## Step B — Scaffold and core interfaces

**Objective:** Introduce a minimal TypeScript scaffold and testable policy contracts.

**Planned deliverables:** Directory placeholders, strict TypeScript configuration, shared task and agent interfaces, provider-independent model contracts, repository-target validation, approval policy, audit-event safety, worker resource-limit policy, and unit tests.

**Mandatory gates:**
- Keep work on the approved feature branch.
- No autonomous execution loops, real provider connections, real API keys, dashboard UI, merge operations, or deployment operations.
- Approval defaults to `PENDING`; both `PENDING` and `DENIED` block protected operations.
- Only an authenticated human can authorize; reviewer `APPROVE` is advisory.
- Agent self-approval is rejected.
- Changes to the proposal invalidate previous approval.
- Unknown model providers fail safely; no network requests.
- Invalid repository targets are rejected.
- Worker limits cover timeout, memory, payload, concurrency, and network egress policy.
- Tests must be actually executed; never infer a pass.

**Exit evidence:** File diff, commit SHA, actual formatting/lint/typecheck/test output, approval-policy results, worker-limit test results, and documentation-preservation check.

## Step C — Mobile dashboard foundation

**Objective:** Build a responsive human-facing dashboard using deterministic local demo data.

**Planned deliverables:** Next.js and Tailwind dashboard under `apps/dashboard/`, mock project/task/run/pull-request/test views, component tests, and verified build output.

**Mandatory gates:**
- Local deterministic fixtures only; no live API or backend.
- Persistent banner: `DEMO ONLY — NO REAL AUTHORIZATION`.
- All interactions remain local and cannot invoke protected backend operations.
- Clearly label mock worker, pull-request, agent, and test information as simulated.
- Display that agents cannot approve their own changes.
- Verify layout at 360, 375, 390, 412, 768, 1024, and 1440 CSS pixels.
- Touch targets are at least 44 by 44 CSS pixels.
- No horizontal overflow or clipped controls.
- No OAuth, credentials, real orchestration, merge, or deployment.

**Exit evidence:** Component test output, no-network verification, responsive checks, accessibility review, and production build output.

## Step D — CI and security workflows

**Objective:** Add a non-deploying pull-request verification pipeline.

**Planned deliverables:** `.github/workflows/ci.yml`, local check report, security review, and rollout readiness summary.

**Mandatory gates:**
- Pull-request checks only; no deployment workflow.
- Explicit minimal token permissions, initially `contents: read`.
- No automated approval, merge, push to `main`, or production secrets.
- Use free hosted runners where available and verify current usage limits.
- Run formatting, lint, typecheck, tests, and dashboard build.
- Document that branch protection settings are a separate repository configuration and cannot be guaranteed by a workflow alone.

**Exit evidence:** Workflow diff, permission and trigger review, actual CI run, local check results, and confirmation that no deploy or write-capable token scope was introduced.

## Cross-phase release process

1. Inspect the current branch and repository state.
2. Make only the changes allowed for the active phase.
3. Capture commit and diff evidence.
4. Run the checks applicable to that phase.
5. Review documentation and security boundaries.
6. Mark the phase PASS, HOLD, or FAIL based on evidence.
7. Wait for explicit human authorization before starting the next phase.

## Deferred decisions

The exact `eve` runtime, hosting provider, worker isolation platform, model providers, secret manager, and production deployment target remain unselected. Evaluate them only when the relevant phase requires them and after official documentation, cost, security, and free-tier constraints have been reviewed.
