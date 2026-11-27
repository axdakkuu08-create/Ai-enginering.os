# API configuration

The API validates Auth0 access tokens server-side and derives application permissions
from the Neon database. JWT permission or role claims are not used for authorization.

Required environment variables:

- `AUTH0_ISSUER`: exact Auth0 tenant issuer, including the trailing slash
  (for example, `https://tenant.example/`). Must be HTTPS.
- `AUTH0_AUDIENCE`: the API identifier configured for the Auth0 API.
- `AUTH0_ALLOWED_CLIENT_IDS`: comma-separated Auth0 application client IDs allowed
  to call this API. These are checked against the JWT `azp` claim.
- `ALLOWED_ORIGINS`: comma-separated exact browser origins used for CORS. These are
  separate from Auth0 client IDs and are not an authentication credential.
- `DATABASE_URL`: private Neon PostgreSQL connection string with TLS enabled.

Do not commit real values or paste secrets into issues, chat, source code, or logs.
Do not configure production or staging provider settings until the Auth0 tenant,
API audience, application client ID, and dashboard origin have been verified.

The API loads signing keys from the issuer's `/.well-known/jwks.json`, accepts
RS256 tokens only, checks issuer, audience, subject, time claims, and allow-listed
`azp`, then reads permissions from `app.aios_user_permissions`. The backend,
not the token, is the authorization authority.
