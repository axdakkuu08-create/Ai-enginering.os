# Step B.1 — Code Quality and Security Hardening Plan

**Date:** 2026-11-06  
**Target branch:** `feat/projects-registry`  
**Baseline inspected:** `82f66835b03bef953dd90e275b11150d674a6e3d`  
**Scope:** Planning and evidence requirements only. This report does not claim implementation or test results.

## Guardrails

- Keep `main` untouched.
- No merge, release, deployment, or production integration.
- Do not begin Step C until Step B receives explicit human acceptance and separate authorization.
- Do not change existing GitHub Actions workflows as part of this documentation-only step.
- Keep dependency changes reproducible: update `package.json` and `package-lock.json` together and verify with a clean CI install.
- Do not claim lint, formatting, security, or runtime checks passed until a real Actions run records the result.

## Current verified baseline

The latest inspected Step B workflow run was [42203441447](https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/42203441447), on commit `82f66835b03bef953dd90e275b11150d674a6e3d`. Its job completed successfully. The run included dependency installation, the Vitest step, TypeScript verification, report generation, and artifact upload. The recorded test summary from the existing audit is 23 passing tests and TypeScript exit code 0.

The repository currently declares only Vitest and TypeScript as development dependencies. The root scripts expose `test` and `typecheck`. ESLint and a formatter are not currently configured. Therefore lint and formatting remain **NOT RUN**, not passed.

## Work packages (ordered)

### B1 — Reproducible code-quality toolchain

1. Select compatible, maintained ESLint and Prettier versions.
2. Add explicit lint, format-check, and format-write scripts.
3. Add repository configuration with a narrow TypeScript-aware scope.
4. Update the npm lockfile in the same change as dependency declarations.
5. Run a clean `npm ci`, lint, format check, Vitest, and TypeScript check in GitHub Actions.
6. Fix only evidence-backed findings; do not bulk-reformat unrelated files.

**Acceptance:** clean install and all four checks pass on the same exact commit. The lockfile must be in sync. No local or manual pass may substitute for Actions evidence.

### B2 — Approval boundary

- Keep approval decisions bound to the exact proposal digest and base revision.
- Add integration-level authenticated actor resolution before any real GitHub write capability is introduced.
- Derive actor identity from a trusted authenticated session; never accept a caller-supplied actor type as proof of identity.
- Enforce independent approver policy at the service boundary, not only in a reusable helper.
- Add tests for missing identity, forged actor metadata, unauthorized users, stale revisions, repeated decisions, and proposal changes.

**Boundary:** current approval helpers are policy primitives. They do not authenticate users.

### B3 — Audit integrity and privacy

- Validate event shape and timestamp format.
- Redact secrets before persistence and avoid logging raw provider payloads.
- Define an append-only storage interface and explicit retention/access policy before selecting a database.
- Add tests for nested secrets, oversized strings/arrays/objects, malformed values, and redaction regressions.
- Treat redaction as defense-in-depth, not exhaustive secret detection.

**Boundary:** current in-memory event sanitization is not durable or tamper-proof audit storage.

### B4 — Worker execution limits

- Add explicit task deadlines and cancellation semantics.
- Define bounded retries with backoff and idempotency requirements.
- Add per-task resource budgets at the execution adapter boundary.
- Keep process/container isolation as a separate infrastructure requirement.
- Test timeout, cancellation, retry exhaustion, cleanup after failure, and concurrency release.

**Boundary:** current guard limits in-process concurrent tasks only; it does not impose CPU, memory, network, or OS-level isolation.

### B5 — Repository integration safety

- Keep repository allow-lists sourced from trusted server configuration.
- Use least-privilege GitHub App permissions.
- Separate read-only inspection from write-capable operations.
- Require a fresh approval for each proposed write and re-check branch/base revision immediately before execution.
- Test denied repository, protected target branch, changed base revision, revoked approval, and GitHub API failure cases.

**Boundary:** current target validation does not itself authenticate a GitHub App or enforce remote permissions.

### B6 — Repository governance

- Review and enable appropriate `main` branch protection / rulesets through GitHub settings.
- Require successful status checks and human review before merge.
- Confirm the rules are effective by inspecting the resulting repository settings.
- Do not assume a successful feature-branch Actions run means `main` is protected.

**Current observation:** the branch metadata inspected during this audit reported `protected: false`. No settings were changed.

## Verification matrix

| Gate | Required evidence | Status |
|---|---|---|
| Existing Step B Vitest | Exact-commit Actions result | PASS in run 42203441447 |
| Existing TypeScript | Exact-commit Actions result | PASS in run 42203441447 |
| ESLint | Config + clean Actions run | NOT CONFIGURED |
| Prettier check | Config + clean Actions run | NOT CONFIGURED |
| Dependency reproducibility | Lockfile sync + clean `npm ci` | Existing install passed; new-toolchain sync not tested |
| Approval authentication | Trusted identity integration + adversarial tests | NOT IMPLEMENTED |
| Durable audit | Storage contract + persistence/security tests | NOT IMPLEMENTED |
| Worker timeout/isolation | Runtime implementation + failure tests | NOT IMPLEMENTED |
| Repository governance | Effective branch protection/ruleset evidence | NOT VERIFIED / NOT ENABLED at last metadata check |
| Human Step B acceptance | Explicit owner decision after review | HOLD |

## Immediate next safe action

Prepare B1 as a separate, reviewable change: first verify compatible dependency versions and lockfile generation in a disposable CI context, then add configuration and scripts, then run all checks on the exact feature-branch commit. If dependency or lockfile evidence cannot be produced, stop rather than hand-editing a speculative lockfile.

## Release decision

**Step B final acceptance: HOLD.**  
**Step C: BLOCKED.**  
**Merge/deployment: NOT AUTHORIZED.**

This document is a plan and status record. It does not claim that any deferred work has been implemented.
