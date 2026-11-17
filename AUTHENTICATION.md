# AIOS Authentication and Approval Security Foundation

Status: **implementation draft; not production-ready**. OS-10.3 remains **HOLD** and release is not authorized.

## Identity trust boundary

Auth0AccessTokenVerifier is a server-side RS256 access-token verifier. It pins an exact HTTPS issuer, API audience, and explicit client-ID allow-list; validates signature, key ID, expiry, issued-at, optional not-before, subject, and permission claims; and fails closed on malformed credentials, JWKS/network failures, and crypto errors.

The verifier also parses a bounded RFC 8693 act actor chain when the issuer includes it. These actor IDs are used conservatively in self-approval detection. An absent actor chain is allowed; it does not prove that a provider has configured delegation claims.

### Auth0 configuration still required

1. Create a dedicated AIOS Auth0 application and a dedicated AIOS API audience. Do not reuse the Gemini GitHub MCP Bridge application/client.
2. Configure RS256, RBAC, and "Add Permissions in the Access Token".
3. Restrict approval:write to the authorized reviewer role.
4. Set the exact AIOS client ID allow-list in a server-only environment.
5. Configure and test actor-chain issuance if AIOS uses delegated credentials.

No Auth0 tenant resources or secrets have been created by this repository change. Never commit credentials, access tokens, or signing material.

## Approval decision lifecycle

- A new approval gate starts PENDING.
- A trusted verifier derives the approver subject and permission. Request JSON cannot supply the actor, timestamp, or authoritative gate state.
- The timestamp is generated from the server clock. Approval expires after five minutes.
- The decision is committed through a compare-and-set operation bound to gate ID, version, pending status, proposal digest, base revision, and the prior decision fields.
- The approved state can be used once. Immediately before the protected callback, the gate must transition atomically from APPROVED to CONSUMED.
- Expired, stale, replayed, or concurrent decisions fail closed.

The simple status-only canProceed(status) helper has been removed. The remaining binding-aware predicate checks status, proposal digest, base revision, and server time.

## Durable PostgreSQL adapters

PostgresApprovalStore implements durable reads, creation, and atomic conditional updates through the minimal SqlExecutor interface. The schema migration is:

packages/core/sql/001-os103-security-stores.sql

The migration creates the approval-gate table and audit-chain tables. A server composition root must provide a real PostgreSQL client implementing SqlExecutor, apply the migration, configure transactions/connection handling, and use a restricted database role. The in-memory store is for tests only.

**No database has been provisioned, migrated, or connected as part of this work.** The adapter is code, not evidence of a durable production deployment.

## Protected action gateway

ProtectedActionGateway is a server-side authorization boundary for branch.write and pr.write callbacks. It:

1. loads a proposal from a trusted provider-state resolver;
2. hashes action, repository, target branch, base revision, head revision, and diff digest;
3. evaluates the registered permission policy;
4. re-fetches provider state and rejects any change;
5. atomically consumes the approval;
6. invokes the server-owned provider callback with the immutable proposal.

The callback must be a concrete backend mutator that uses the supplied proposal and does not silently re-resolve or change its scope. If it fails, the approval remains consumed and a new human decision is required.

**No production API route, trusted GitHub proposal resolver, or concrete GitHub branch/PR mutator currently invokes this gateway.** Therefore the original "no production caller" finding is only partially addressed. Do not wire it into a privileged operation until that integration exists and has end-to-end tests.

merge.execute and deploy.execute remain blocked. This change does not authorize merging, deployment, or main-branch modification.

## Audit trail

createSafeAuditEvent now generates timestamps server-side and redacts sensitive field names plus common Bearer, GitHub, OpenAI-style, AWS access-key ID, Google API key, JWT, and PEM private-key patterns. Redaction is defence in depth, not a replacement for never logging credentials.

AuditLedgerStore provides sequence numbers, canonical serialization, SHA-256 hash chaining, and verification. PostgresAuditLedgerStore uses a conditional head update and event insert in one SQL statement, retries concurrent append conflicts, and verifies the stored chain when it is read or extended.

Database-role restrictions are essential: the application role should have SELECT/UPDATE on the head table and SELECT/INSERT on the event table, but no UPDATE/DELETE/TRUNCATE/ownership/DDL rights on event rows. A database owner or superuser can rewrite the whole chain; external anchoring to an independently controlled destination is still required for stronger tamper evidence. No database role or external anchor has been configured here.

## CI and verification

The PR quality workflow now runs on pull requests touching packages and configuration, and runs lint, formatting, full Vitest, and TypeScript checks without continue-on-error. The permission-engine PR workflow runs the full test suite and TypeScript check. The legacy Step B audit workflow was expanded from one approval test file to all tests under packages/core/tests; its final verdict logic still records every exit code and only emits PASS when all required checks succeeded.

A green workflow is evidence only for the exact SHA it tested. It does not verify live Auth0 configuration, a production database, protected-action integration, or historical packet provenance.

## Release restrictions and remaining acceptance work

- Keep OS-10.3 at **HOLD** until the concrete server route/provider mutator, real PostgreSQL connection and restricted role, and dedicated Auth0 configuration are independently tested.
- Run the full Vitest suite, lint, formatting, and strict TypeScript checks on the final candidate SHA. Preserve the run IDs and artifacts.
- Obtain a separate human security review and acceptance decision.
- Resolve F-09 from authentic historical evidence or obtain an authorized human risk disposition that explicitly does not claim provenance authenticity.
- Complete G1 independent verification and G3 authorized human decision. AI review is not a substitute.

No code change in this branch lifts the release HOLD.
