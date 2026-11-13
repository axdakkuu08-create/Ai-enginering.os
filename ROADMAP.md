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

## Latest verified status — 2026-11-13

- Live audit baseline: `feat/projects-registry` at `8d7adef77f20702655508cfa46ce26ac051e8655`; `main` and the merge base remain `e030750f66120b15829eb1f39504370efe5cba1c`. The feature branch is 72 commits ahead and 0 behind.
- Permission Engine Milestone 1 Actions run [42739186521](https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/42739186521) completed successfully on exact current HEAD `8d7adef77f20702655508cfa46ce26ac051e8655`. Locked dependency installation, 4 Vitest files / 58 passed / 0 failed, and the strict TypeScript step all succeeded.
- The same successful run's `npm ci` log reported 13 vulnerabilities (11 moderate, 2 critical). The captured log did not identify affected packages; a full dependency audit and triage remain outstanding.
- Step B Core Scaffold Audit run [42457224191](https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/42457224191) has an inspected artifact on exact SHA `a20f9e69732813f7a0089c2852260e7b0735ba24`: committed-lockfile install exit 0, 1 Vitest file / 23 passed / 0 failed, and TypeScript exit 0. Its main and merge-base SHA were `e030750f66120b15829eb1f39504370efe5cba1c`. This is not a new Step B audit run on current HEAD.
- Step B.1 quality verification is **HOLD**. Historical run [42224181429](https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/42224181429) passed on exact SHA `995c695dbe32e0bdc89efc60b1aea4a65fb6e9a7`, but later run [42457224206](https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/42457224206) failed ESLint on `a20f9e69732813f7a0089c2852260e7b0735ba24`; Prettier, Vitest, and TypeScript were skipped. No later Step B.1 run on current HEAD was found.
- Step B core primitives are implemented, but final Step B acceptance remains **HOLD**. The prior OS-10.2 review disposition is **CONDITIONAL PASS**; the pilot remains **BLOCKED**.
- The next required gate is OS-10.3: design and verify trusted actor identity binding and the enforcement boundary before implementation or GitHub App privileged integration.
- Remaining controls include canonical artifact manifest and trusted workflow/SHA-bound CI, release-SHA invalidation, tamper-evident audit storage, mandatory conflict handling, and platform-enforced worker isolation.
- GitHub currently reports `protected: false` for both `main` and `feat/projects-registry`. Effective branch protection/rulesets are not verified.
- OpenSpec assessment is complete and read-only. It is not adopted, installed, or integrated.
- No merge, deployment, pilot, GitHub App privileged integration, or `main` modification is authorized.

See the [2026-11-13 weekly verification status](reports/2026-11-13-weekly-verification-status.md) for the artifact inspection, job-level results, and evidence limitations. The [2026-11-10 repository status and remaining-gates report](reports/2026-11-10-repository-status-and-remaining-gates.md) remains the prior security-gate review. The 2026-11-05 status below is retained as historical context, not the current repository head.


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
