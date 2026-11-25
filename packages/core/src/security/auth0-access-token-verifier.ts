import type {
  HumanIdentityVerifier,
  VerifiedHumanIdentity,
} from "./human-authorization.js";

const MAX_TOKEN_LENGTH = 16_384;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const CLOCK_TOLERANCE_SECONDS = 60;
const FETCH_TIMEOUT_MS = 5_000;

interface JwtHeader {
  readonly alg?: unknown;
  readonly kid?: unknown;
  readonly typ?: unknown;
}

interface JwtClaims {
  readonly iss?: unknown;
  readonly aud?: unknown;
  readonly azp?: unknown;
  readonly sub?: unknown;
  readonly exp?: unknown;
  readonly iat?: unknown;
  readonly nbf?: unknown;
  readonly permissions?: unknown;
}

interface JsonWebKeySet {
  readonly keys?: readonly JsonWebKey[];
}

export interface Auth0AccessTokenVerifierOptions {
  /** Exact Auth0 issuer, including its trailing slash, e.g. https://tenant.example/ */
  readonly issuer: string;
  /** Exact API audience configured in Auth0. */
  readonly audience: string;
  /** Explicit allow-list of Auth0 application client IDs permitted to call this API. */
  readonly allowedClientIds: readonly string[];
  /** Injectable clock for deterministic tests. Defaults to current Unix time. */
  readonly now?: () => number;
  /** Injectable fetch implementation for deterministic tests and controlled runtimes. */
  readonly fetcher?: typeof fetch;
}

export class InvalidAccessTokenError extends Error {
  public constructor(message = "Access token is invalid.") {
    super(message);
    this.name = "InvalidAccessTokenError";
  }
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new InvalidAccessTokenError("Token encoding is malformed.");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new InvalidAccessTokenError("Token encoding is malformed.");
  }
}

function decodeJsonSegment<T>(segment: string): T {
  try {
    const bytes = decodeBase64Url(segment);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch (error) {
    if (error instanceof InvalidAccessTokenError) throw error;
    throw new InvalidAccessTokenError("Token JSON is malformed.");
  }
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function validateOptions(options: Auth0AccessTokenVerifierOptions): void {
  let issuer: URL;
  try {
    issuer = new URL(options.issuer);
  } catch {
    throw new TypeError("Auth0 issuer must be an absolute HTTPS URL.");
  }
  if (
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    issuer.pathname !== "/" ||
    !options.issuer.endsWith("/")
  ) {
    throw new TypeError("Auth0 issuer must be an exact HTTPS issuer ending in '/'.");
  }
  if (!options.audience.trim()) {
    throw new TypeError("Auth0 API audience must be non-empty.");
  }
  if (
    options.allowedClientIds.length === 0 ||
    options.allowedClientIds.some((clientId) => !clientId.trim())
  ) {
    throw new TypeError("At least one explicit Auth0 client ID is required.");
  }
}

export class Auth0AccessTokenVerifier implements HumanIdentityVerifier {
  private readonly issuer: string;
  private readonly jwksUrl: string;
  private readonly allowedClientIds: ReadonlySet<string>;
  private readonly now: () => number;
  private readonly fetcher: typeof fetch;
  private cachedKeys: readonly JsonWebKey[] | null = null;
  private cacheExpiresAt = 0;
  private pendingJwks: Promise<readonly JsonWebKey[]> | null = null;

  public constructor(private readonly options: Auth0AccessTokenVerifierOptions) {
    validateOptions(options);
    this.issuer = options.issuer;
    this.jwksUrl = new URL(".well-known/jwks.json", options.issuer).toString();
    this.allowedClientIds = new Set(options.allowedClientIds);
    this.now = options.now ?? (() => Date.now() / 1000);
    this.fetcher = options.fetcher ?? fetch;
  }

  /** Verifies an Auth0 RS256 access token and returns only trusted claims. */
  public async verifyCredential(
    credential: unknown,
  ): Promise<VerifiedHumanIdentity | null> {
    try {
      if (
        typeof credential !== "string" ||
        credential.length === 0 ||
        credential.length > MAX_TOKEN_LENGTH
      ) {
        return null;
      }
      const segments = credential.split(".");
      if (segments.length !== 3) return null;

      const header = decodeJsonSegment<JwtHeader>(segments[0]);
      const claims = decodeJsonSegment<JwtClaims>(segments[1]);
      if (
        header.alg !== "RS256" ||
        typeof header.kid !== "string" ||
        header.kid.length === 0 ||
        (header.typ !== undefined && header.typ !== "JWT")
      ) {
        return null;
      }

      const subjectId = asNonEmptyString(claims.sub);
      const authorizedParty = asNonEmptyString(claims.azp);
      if (
        claims.iss !== this.issuer ||
        !this.hasAudience(claims.aud) ||
        !subjectId ||
        !authorizedParty ||
        !this.allowedClientIds.has(authorizedParty) ||
        !this.hasValidTimes(claims)
      ) {
        return null;
      }
      if (
        !Array.isArray(claims.permissions) ||
        claims.permissions.some((permission) => typeof permission !== "string")
      ) {
        return null;
      }

      const keys = await this.getSigningKeys();
      const matchingKeys = keys.filter(
        (key) =>
          key.kid === header.kid &&
          key.kty === "RSA" &&
          (key.use === undefined || key.use === "sig") &&
          (key.alg === undefined || key.alg === "RS256"),
      );
      if (matchingKeys.length !== 1) return null;

      const publicKey = await crypto.subtle.importKey(
        "jwk",
        matchingKeys[0],
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const signedContent = new TextEncoder().encode(
        `${segments[0]}.${segments[1]}`,
      );
      const signature = decodeBase64Url(segments[2]);
      const valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        signature,
        signedContent,
      );
      if (!valid) return null;

      return Object.freeze({
        subjectId,
        permissions: Object.freeze([...claims.permissions]) as readonly string[],
      });
    } catch {
      // Invalid credentials, unavailable JWKS, and cryptographic errors deny access.
      return null;
    }
  }

  private hasAudience(audience: unknown): boolean {
    return (
      audience === this.options.audience ||
      (Array.isArray(audience) &&
        audience.every((item) => typeof item === "string") &&
        audience.includes(this.options.audience))
    );
  }

  private hasValidTimes(claims: JwtClaims): boolean {
    const now = this.now();
    if (
      !Number.isFinite(now) ||
      typeof claims.exp !== "number" ||
      !Number.isFinite(claims.exp) ||
      typeof claims.iat !== "number" ||
      !Number.isFinite(claims.iat)
    ) {
      return false;
    }
    if (now >= claims.exp + CLOCK_TOLERANCE_SECONDS) return false;
    if (claims.iat > now + CLOCK_TOLERANCE_SECONDS) return false;
    if (
      claims.nbf !== undefined &&
      (typeof claims.nbf !== "number" ||
        !Number.isFinite(claims.nbf) ||
        now + CLOCK_TOLERANCE_SECONDS < claims.nbf)
    ) {
      return false;
    }
    return true;
  }

  private async getSigningKeys(): Promise<readonly JsonWebKey[]> {
    if (this.cachedKeys && this.now() * 1000 < this.cacheExpiresAt) {
      return this.cachedKeys;
    }
    if (this.pendingJwks) return this.pendingJwks;

    this.pendingJwks = this.fetchSigningKeys();
    try {
      const keys = await this.pendingJwks;
      this.cachedKeys = keys;
      this.cacheExpiresAt = this.now() * 1000 + JWKS_CACHE_TTL_MS;
      return keys;
    } finally {
      this.pendingJwks = null;
    }
  }

  private async fetchSigningKeys(): Promise<readonly JsonWebKey[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await this.fetcher(this.jwksUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new InvalidAccessTokenError("Auth0 signing keys are unavailable.");
      }
      const body = (await response.json()) as JsonWebKeySet;
      if (
        !body ||
        !Array.isArray(body.keys) ||
        body.keys.length === 0 ||
        body.keys.length > 100
      ) {
        throw new InvalidAccessTokenError("Auth0 signing key set is malformed.");
      }
      return Object.freeze(
        body.keys.filter(
          (key) =>
            key &&
            key.kty === "RSA" &&
            typeof key.kid === "string" &&
            key.kid.length > 0,
        ),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
