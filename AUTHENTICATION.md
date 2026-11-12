# AIOS Authentication Foundation

Status: implementation draft; **not production-ready**. The AI Engineering OS remains in HOLD.

## Security boundary

AIOS uses the existing Auth0 tenant only as an identity-provider tenant. It must have a dedicated AIOS application and a dedicated AIOS API audience. The Gemini GitHub MCP Bridge application, client credentials, callback configuration and browser session are not AIOS credentials or approval evidence.

The server-side `Auth0AccessTokenVerifier` verifies access tokens using the tenant's HTTPS JWKS endpoint. It pins RS256 and validates:

- exact issuer and API audience;
- token signature against exactly one matching RSA signing key;
- expiry, issued-at and optional not-before timestamps;
- the authorized AIOS application client ID (`azp`);
- a non-empty subject and a well-formed permissions claim.

The verifier returns only the verified subject and permissions. It does not accept a caller-provided JWKS fetcher, clock, identity object, actor ID or actor type. Invalid credentials, network failures and verification errors fail closed.

## Required Auth0 configuration

Before integration, configure these resources in the existing tenant:

1. A separate AIOS application, with a new client ID. Do not reuse the Gemini bridge client ID or secret.
2. A separate AIOS API with a unique audience URI.
3. RS256 signing and RBAC enabled for that API.
4. "Add Permissions in the Access Token" enabled.
5. An explicit `approval:write` permission assigned only to the intended human reviewer role.
6. An exact allow-list of AIOS application client IDs in server-side configuration.

No client secret is required to verify a signed access token. Do not put secrets, access tokens or signing material in this repository or browser code.

## Integration restrictions

This verifier is a primitive, not a complete authentication or approval service.

- Instantiate it only in a trusted server runtime. Never bundle it into browser/mobile code.
- A backend must extract the bearer token from the Authorization header and pass only that credential to the verifier.
- Derive the actor exclusively from the returned verified `subjectId`; never accept `actorId`, `actorType`, roles or permissions from request JSON.
- Load approval gates and proposal state from a trusted server-side store. Do not accept a client-supplied gate object as authoritative.
- Use durable atomic compare-and-set for approval decisions, reject replay/concurrent decisions, and revalidate proposal digest and base revision immediately before a protected operation.
- The current repository has no production API route or durable approval store. Do not connect this verifier to a privileged operation until those boundaries exist and have independent tests.
- Keep merge, deployment and all other privileged capabilities blocked.

## Verification required before HOLD can be lifted

- Run the full Vitest suite and strict TypeScript check on the exact proposed commit.
- Independently review token validation, JWKS rotation/failure behavior, Auth0 tenant configuration and client-ID allow-list.
- Add integration tests proving forged request identities cannot change the verified actor.
- Add server-side tests for missing/invalid bearer tokens, missing permission, self-approval, stale proposal, replay and concurrent approval.
- Verify no secrets or credentials entered Git history.
- Obtain independent reviewer acceptance and retain the evidence.

Until all required evidence is recorded, this implementation is experimental and must not be treated as production authentication.
