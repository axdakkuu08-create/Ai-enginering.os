# Step B Security Hardening — 2026-11-06

**Repository:** `axdakkuu08-create/Ai-enginering.os`  
**Branch:** `feat/projects-registry`  
**Implementation commit tested:** `3284c54b94a45f0c08cc2e0be923b70e5bb42d54`  
**Main HEAD verified unchanged:** `e030750f66120b15829eb1f39504370efe5cba1c`  
**Scope:** B1 workflow token hardening, worker resource-policy primitives, and trusted human-approval boundary. No Step C, merge, or deployment.

## 1. B1 workflow token boundary

Updated `.github/workflows/step-b1-quality.yml`:
- Workflow permissions are `contents: read` only.
- Removed the `GH_TOKEN` environment variable and all git commit/push operations.
- Checkout uses `persist-credentials: false`.
- Requires the committed `package-lock.json`; it no longer generates or pushes a lockfile.
- Runs `npm ci --ignore-scripts` so dependency lifecycle scripts do not execute in CI.
- Formatting is check-only; no repository files are modified by the workflow.
- Workflow does not merge or deploy.

The successful run is [42258656384](https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/42258656384), on exact commit `3284c54b94a45f0c08cc2e0be923b70e5bb42d54`.

## 2. Worker resource policy primitives

Expanded `packages/core/src/security/worker-bounds.ts`:
- Validates positive safe-integer budgets for execution time, memory, input bytes, output bytes, and concurrency.
- Measures payload size in UTF-8 bytes.
- Denies egress by default and permits only exact configured HTTPS origins at the application-policy layer.
- Adds a deadline wrapper that aborts cooperative work and returns a resource-limit error.
- Retains in-process concurrency accounting and idempotent release.

Added `packages/core/tests/worker-bounds.test.ts` for policy validation, payload size, default-deny egress, exact-origin matching, credential-bearing/non-HTTPS origin rejection, cooperative deadline behavior, and concurrency.

**Important enforcement boundary:** this is not a sandbox. The memory budget is validated as policy data, not enforced as an OS quota. A cooperative deadline cannot kill a non-cooperative task. An application URL check cannot prevent direct sockets, DNS rebinding, redirects, metadata-service access, or other network bypasses. The concurrency guard is process-local, not distributed. Production workers still require platform-enforced CPU/memory/time limits, process/filesystem isolation, disposable execution environments, and network firewall/egress controls.

## 3. Human approval authentication boundary

Added `packages/core/src/security/human-authorization.ts`:
- Accepts an opaque credential and delegates authentication to an injected verifier.
- Derives approver subject ID and permissions from the verifier result, not request-supplied actor fields.
- Requires the server-resolved `approval:write` permission.
- Fails closed for invalid credentials, verifier errors, missing identity, or missing permission.
- Passes the authenticated subject into the existing self-approval and proposal/base-revision checks.

Added `packages/core/tests/human-authorization.test.ts` for successful verifier-derived identity, invalid credentials, verifier errors, missing permission, self-approval, and stale proposal rejection.

**Important authentication boundary:** no identity provider, session/token verifier, or production authorization service has been selected or integrated. The injected verifier must be implemented only in a trusted server-side adapter. A browser/client must never supply the verifier, trusted identity object, or permissions. The core helper cannot authenticate a person by itself.

## 4. Documentation

Updated:
- `packages/core/README.md` — implemented policy helpers and their limits.
- `SECURITY.md` — clarified that TypeScript policy checks are not infrastructure enforcement and that human approval depends on a trusted server-side verifier.

## 5. Verification evidence

Successful exact-commit B1 quality run:
- [GitHub Actions run 42258656384](https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/42258656384)
- Commit tested: `3284c54b94a45f0c08cc2e0be923b70e5bb42d54`
- Clean `npm ci --ignore-scripts`: PASS
- ESLint: PASS
- Prettier check: PASS
- Vitest: 3 files, 36 tests passed, 0 failed
- TypeScript: PASS
- Evidence artifact: [step-b1-verification-42258656384](https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/42258656384/artifacts/13523283893)

The Step B core scaffold audit also completed successfully on the same commit: [run 42258656647](https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/42258656647). That audit runs the existing approval test file and TypeScript check; the B1 quality run is the evidence for the full 36-test suite.

Earlier attempts failed during formatting/test development and were corrected. They are retained in Actions history; the final exact-commit run above is the successful verification.

## 6. Final status and remaining gates

- B1 workflow write-token exposure: **HARDENED**; no write token or push path remains in this workflow.
- Worker policy primitives: **IMPLEMENTED AND TESTED**; actual platform isolation and resource enforcement remain **NOT IMPLEMENTED**.
- Human approval verifier boundary: **IMPLEMENTED AND TESTED**; real identity-provider integration and trusted server deployment remain **NOT IMPLEMENTED**.
- Trusted repository allow-list provisioning and live GitHub App installation verification remain **NOT IMPLEMENTED**.
- Durable append-only/tamper-evident audit storage remains **NOT IMPLEMENTED**.
- Overall Step B acceptance: **HOLD** until mandatory production/infrastructure boundaries are either implemented and verified or explicitly respecified as later-phase work.
- Step C: **NOT STARTED / NOT AUTHORIZED**.
- Merge and deployment: **NOT AUTHORIZED**.

## 7. Branch safety

The implementation was confined to `feat/projects-registry`. The `main` branch was verified at `e030750f66120b15829eb1f39504370efe5cba1c` and was not changed. No merge, deployment, production credential, live provider, or live worker integration was performed.
