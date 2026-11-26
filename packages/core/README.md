# Core policy primitives

This package contains provider-neutral contracts and deterministic policy helpers for the AI Engineering OS foundation.

## Implemented

- Shared project, task, approval, model request/response, and provider adapter types.
- Proposal-bound approval gates. Only pending gates accept a decision; stale proposal/base revisions reject or invalidate a decision.
- A human-approval boundary that obtains the approver subject and permissions from an injected trusted server-side identity verifier. It does not accept actor identity or actor type from the approval request.
- Repository target validation requiring an explicit repository allow-list and a non-protected feature target branch.
- Audit-event sanitization that drops selected sensitive fields, bounds nested values, and redacts common credential patterns before returning a safe event.
- Validated worker resource policy fields for execution deadline, memory budget, input/output byte limits, concurrency, and exact HTTPS egress origins.
- UTF-8 payload-size checks, exact-origin egress policy checks, an aborting cooperative deadline wrapper, and an in-process concurrency guard.

## Verification

The policy helpers have focused Vitest coverage. The current exact-commit CI run is the source of truth for formatting, lint, tests, and TypeScript results. Do not infer a pass from a commit or a queued workflow.

## Security boundaries and limitations

These modules are policy primitives, not a complete production security system:

- The human-approval function is only as trustworthy as the injected verifier. A production server must implement that verifier using a real authentication provider, validate session/token signatures and expiry, resolve permissions from trusted server-side policy, and prevent browser clients from supplying the verifier or identity object.
- The repository allow-list must come from trusted server-side installation/configuration. Callers must not let an untrusted task choose its own allow-list.
- Audit sanitization is not an exhaustive secret detector, durable append-only storage, access control, or tamper-evident integrity mechanism.
- Worker policy validation does not impose CPU or memory quotas. The deadline wrapper can abort cooperative tasks but cannot forcibly terminate a non-cooperative operation.
- The in-process concurrency guard is not a distributed quota. Exact-origin egress checks are application-level checks and do not stop direct sockets, DNS rebinding, redirects, metadata access, or other bypasses.
- A production worker still requires platform-enforced CPU, memory, wall-clock, payload, filesystem/process, network-egress, and isolation controls (for example, a disposable sandbox/container/VM with restrictive network policy).
- No live model provider, authentication provider, worker runtime, durable audit store, merge operation, or deployment operation is implemented.

A passing unit test proves only the tested helper behavior. It does not certify external identity, repository, operating-system, container, or network enforcement.


## Clerk access-token verification and API boundary

The AI Engineering OS staging API uses its own Clerk development instance. `apps/api/clerk-auth.mjs` verifies Clerk-signed JWTs against the instance's public JWKS and enforces the exact issuer, API audience, token time claims, subject, signing algorithm, and an explicit `azp` authorized-party origin allow-list. It rejects missing, malformed, expired, tampered, or wrong-origin tokens.

The API does not trust permissions copied from browser claims or request bodies. It resolves permissions for the verified Clerk subject from `app.aios_user_permissions` on the server. Approval decisions require `approval:write`; audit reads require `audit:read`. The permission table is owner-managed; the runtime login receives SELECT only. Approval writes are bound to the exact pending proposal digest and base revision, reject self-approval, and append a hash-chained audit event in the same database transaction.

The current deployment is staging only. The Clerk development issuer is `https://diverse-ram-8698.clerk.accounts.dev`, the API audience is `ai-engineering-os-api`, and the dashboard preview origin is explicitly allow-listed. No production Clerk instance, production database migration, merge, or deployment authorization is implied. Live browser-session verification remains a separate acceptance gate.

## PostgreSQL security-store migration

The migration at `packages/core/sql/001-os103-security-stores.sql` creates the approval and audit tables in the dedicated `app` schema. It expects the pre-provisioned `ai_engineering_os_app` role to be a NOLOGIN group role. That role receives only the table privileges needed for approval compare-and-set operations and audit-head advancement/event append; it cannot update, delete, or truncate audit-event rows and has no schema DDL privilege.

The approval and audit tables plus the server-managed permissions table were created on an isolated Neon test branch cloned from the dedicated AI Engineering OS database. A permission audit found pre-existing direct grants that were broader than this migration's intended policy; those grants were revoked and the exact table-level permissions were re-applied on the test branch. Effective privilege checks now confirm: approval gates allow SELECT/INSERT/UPDATE but deny DELETE/TRUNCATE; audit heads allow SELECT/UPDATE but deny INSERT/DELETE/TRUNCATE; audit events allow SELECT/INSERT but deny UPDATE/DELETE/TRUNCATE. The migration file now explicitly resets prior direct grants before applying the intended grants. Migration 002 adds the server-managed Clerk-subject permission table. A dedicated runtime login role was created on this isolated test branch and made a member of the restricted NOLOGIN application role; effective checks confirm it can read permissions, read/update approval gates, read/append audit events, and read/update audit heads while being denied audit-event UPDATE and DELETE. Its connection string is stored as a Render staging secret environment variable, not in source control or chat. This remains isolated staging evidence only; the default Neon branch was not migrated.
