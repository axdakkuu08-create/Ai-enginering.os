# API configuration

The API validates Clerk session tokens server-side and derives application permissions
from the Neon database. JWT permission or role claims are never used for authorization.

## Required environment variables

- `CLERK_ISSUER`: exact HTTPS Clerk instance origin, without a trailing slash
  (for example, `https://your-instance.clerk.accounts.dev`).
- `CLERK_AUDIENCE`: the audience configured in the Clerk session token. The current
  AIOS development instance is configured with `ai-engineering-os-api`.
- `ALLOWED_ORIGINS`: comma-separated exact HTTPS browser origins used for CORS and
  Clerk's `azp` authorized-party validation. HTTP is accepted only for localhost
  development origins. Configure the actual deployed frontend origins only.
- `DATABASE_URL`: private Neon PostgreSQL connection string with TLS enabled.

Do not commit real values or paste secrets into issues, chat, source code, or logs.
The verifier uses the instance's public JWKS endpoint and does not require a Clerk
secret key. Do not configure production provider settings until the production
Clerk instance and dashboard origin have been verified.

## Authentication and trust boundary

The API loads signing keys from the Clerk issuer's `/.well-known/jwks.json`, accepts
RS256 session tokens only, and checks issuer, audience, Clerk user subject, session
ID, expiration and activation time claims, active session status when present, and
allow-listed `azp` authorized parties. RSA signing keys below 2048 bits are rejected.

JWKS responses are size-capped at 64 KiB. Requests are time-limited, cached for five
minutes, coalesced while in flight, and forced refreshes for unknown key IDs are
throttled to avoid remote-request
amplification. Key-discovery failures are treated as temporary service failures,
not as invalid user credentials.

For browser requests, the HTTP `Origin` must be allow-listed and must exactly match
the signed Clerk `azp` claim. Non-browser clients may omit `Origin`, but their signed
`azp` must still be allow-listed. CORS preflight requests require an allow-listed
origin.

After authentication, the API reads permissions from `app.aios_user_permissions`
using the verified Clerk subject ID. The backend and Neon database—not the token
or frontend—are the authorization authority. No token role or permission claims
are trusted.

## Local verification

Run the API authentication tests with:

```sh
npm run test:api
```

These tests exercise token verification and request-header parsing. They do not
replace a live Clerk-to-Render integration test or independent Neon permission
and database-policy verification.
