# API configuration

The API validates Clerk session tokens server-side and derives application permissions
from the Neon database. JWT permission or role claims are never used for authorization.

Required environment variables:

- `CLERK_ISSUER`: exact HTTPS Clerk instance issuer, including its trailing slash
  (for example, `https://your-instance.clerk.accounts.dev/`).
- `CLERK_AUDIENCE`: the audience configured in the Clerk session token. The current
  AIOS development instance is configured with `ai-engineering-os-api`.
- `ALLOWED_ORIGINS`: comma-separated exact HTTPS browser origins used for CORS and
  Clerk's `azp` authorized-party validation. These must be the actual frontend origins.
- `DATABASE_URL`: private Neon PostgreSQL connection string with TLS enabled.

Do not commit real values or paste secrets into issues, chat, source code, or logs.
The verifier uses the instance's public JWKS endpoint and does not require a Clerk
secret key. Do not configure production provider settings until the production
Clerk instance and dashboard origin have been verified.

The API loads signing keys from the Clerk issuer's `/.well-known/jwks.json`,
accepts RS256 session tokens only, checks issuer, audience, Clerk user subject,
session ID, time claims, active session status when present, and allow-listed
`azp` authorized parties. It then reads permissions from
`app.aios_user_permissions`. The backend, not the token, is the authorization authority.
