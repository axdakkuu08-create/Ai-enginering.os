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


## Auth0 access-token verification foundation

`Auth0AccessTokenVerifier` is a server-side implementation of `HumanIdentityVerifier`. It verifies RS256 signatures using the issuer's HTTPS JWKS endpoint and fails closed on malformed tokens, unsupported algorithms, missing or ambiguous signing keys, unavailable JWKS, invalid signatures, issuer/audience/client mismatches, invalid time claims, and malformed permission claims.

The verifier requires explicit configuration for the exact Auth0 issuer (including its trailing slash), API audience, and a non-empty allow-list of Auth0 application client IDs. It derives the subject and permission list only from the verified token. The JWKS cache is bounded to five minutes, network retrieval has a five-second abort timeout, and tokens are limited to 16 KiB.

This is a cryptographic verification primitive, not a production authentication deployment. Before use by an API route:

- Configure a dedicated Auth0 application and API for AI Engineering OS; do not reuse another project's Auth0 client or audience.
- Enable RS256 signing, API RBAC, and the permissions claim in access tokens.
- Supply issuer, audience, and allowed client IDs only through server-side configuration.
- Construct the verifier only in a trusted server process and never accept verifier configuration or verified identity objects from a browser.
- Add rate limiting, request-size limits, secure transport, route-level authorization, and operational monitoring.
- Run integration tests against the actual Auth0 tenant and independently review the deployment configuration.

No production API route, live Auth0 tenant, credential store, database-backed approval transaction, or Render service is connected by this change. The verifier does not authorize merge or deployment, and it does not change the OS-10.3 HOLD.

## PostgreSQL security-store migration

The migration at `packages/core/sql/001-os103-security-stores.sql` creates the approval and audit tables in the dedicated `app` schema. It expects the pre-provisioned `ai_engineering_os_app` role to be a NOLOGIN group role. That role receives only the table privileges needed for approval compare-and-set operations and audit-head advancement/event append; it cannot update, delete, or truncate audit-event rows and has no schema DDL privilege.

The migration was applied and re-applied successfully on an isolated Neon test branch cloned from the dedicated AI Engineering OS database. Catalog checks confirmed all three tables are in `app` and verified the intended grants. The default Neon branch was not migrated. This validates the SQL and role-grant design on the test branch only; it does not establish a runtime login credential, connect a backend, or constitute production migration evidence.
