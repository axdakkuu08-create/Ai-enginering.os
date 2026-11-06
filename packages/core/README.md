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
- A server-side GitHub App authorization adapter that creates short-lived RS256 app JWTs with Web Crypto, verifies the configured installation/account, requests a single-repository installation token with `contents: read`, and verifies the token's exact repository scope before returning it. It accepts an injected HTTP transport and trusted server configuration; it does not read credentials from client input.

## GitHub App authorization setup boundary

The GitHub App adapter requires trusted server configuration for the App ID, installation ID, expected account login, PEM private key, and repository allow-list entries containing both canonical `owner/repository` names and immutable repository IDs. The private key and returned installation token must remain server-side. The current adapter deliberately requests only read access to repository contents; write operations and approval-bound GitHub mutations are not implemented.

The automated tests use generated fixture keys and mocked GitHub responses. They do not authenticate against a live GitHub App installation. No App private key or application secret is configured in this repository, and the existing ChatGPT GitHub connection's installation is not treated as the application's runtime credential.


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
