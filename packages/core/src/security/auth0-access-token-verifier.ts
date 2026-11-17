import type {
  HumanIdentityVerifier,
  VerifiedHumanIdentity,
} from "./human-authorization.js";

interface Auth0AccessTokenClaims {
  readonly iss?: unknown;
  readonly aud?: unknown;
  readonly exp?: unknown;
  readonly nbf?: unknown;
  readonly iat?: unknown;
  readonly azp?: unknown;
  readonly sub?: unknown;
  readonly permissions?: unknown;
  /** RFC 8693 actor claim; used only when the issuer provides it. */
  readonly act?: unknown;
}

interface Auth0Jwk {
  readonly kid?: unknown;
  readonly kty?: unknown;
  readonly use?: unknown;
  readonly alg?: unknown;
  readonly n?: unknown;
  readonly e?: unknown;
}

interface Auth0Jwks {
  readonly keys?: unknown;
}

export interface Auth0VerifierOptions {
  /** Exact Auth0 issuer, including its trailing slash. */
  readonly issuer: string;
  /** Exact API audience configured in the Auth0 tenant. */
  readonly audience: string;
  /** Explicit allow-list of AIOS Auth0 application client IDs. */
  readonly allowedClientIds: readonly string[];
}

const MAX_TOKEN_LENGTH = 16_384;
const CLOCK_TOLERANCE_SECONDS = 60;
const MAX_ACTOR_CHAIN_DEPTH = 8;

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Malformed base64url segment.");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJsonSegment<T>(segment: string): T {
  const decoded = new TextDecoder().decode(decodeBase64Url(segment));
  return JSON.parse(decoded) as T;
}

/**
 * Extracts delegated actor subjects from the signed RFC 8693 act claim.
 * Malformed claims or excessive depth invalidate the credential. An absent
 * claim is allowed and yields an empty delegation list.
 */
function parseActorChain(value: unknown): readonly string[] | null {
  if (value === undefined) return Object.freeze([]);
  const subjects: string[] = [];
  let current: unknown = value;
  let depth = 0;

  while (current !== undefined) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      depth >= MAX_ACTOR_CHAIN_DEPTH
    ) {
      return null;
    }
    const actor = current as Record<string, unknown>;
    if (typeof actor.sub !== "string" || !actor.sub.trim()) return null;
    subjects.push(actor.sub);
    current = actor.act;
    depth += 1;
  }
  return Object.freeze(subjects);
}

/**
 * Auth0 RS256 access-token verifier for a server-only AIOS trust boundary.
 * It returns only claims authenticated by the pinned issuer's JWKS signature.
 */
export class Auth0AccessTokenVerifier implements HumanIdentityVerifier {
  private readonly jwksUrl: string;

  public constructor(private readonly options: Auth0VerifierOptions) {
    const issuerUrl = new URL(options.issuer);
    if (
      issuerUrl.protocol !== "https:" ||
      !options.issuer.endsWith("/") ||
      !options.audience.trim() ||
      options.allowedClientIds.length === 0 ||
      options.allowedClientIds.some((clientId) => !clientId.trim())
    ) {
      throw new TypeError("Invalid Auth0 verifier configuration.");
    }
    this.jwksUrl = new URL(".well-known/jwks.json", options.issuer).toString();
  }

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

      const parts = credential.split(".");
      if (parts.length !== 3) return null;
      const [encodedHeader, encodedPayload, encodedSignature] = parts;
      const header = decodeJsonSegment<Record<string, unknown>>(encodedHeader);
      const claims = decodeJsonSegment<Auth0AccessTokenClaims>(encodedPayload);

      if (
        header.alg !== "RS256" ||
        typeof header.kid !== "string" ||
        !header.kid ||
        header.crit !== undefined ||
        header.jku !== undefined ||
        header.x5u !== undefined ||
        header.b64 !== undefined
      ) {
        return null;
      }

      if (
        claims.iss !== this.options.issuer ||
        !this.hasAudience(claims.aud) ||
        typeof claims.sub !== "string" ||
        !claims.sub.trim() ||
        typeof claims.exp !== "number" ||
        !Number.isFinite(claims.exp) ||
        typeof claims.iat !== "number" ||
        !Number.isFinite(claims.iat) ||
        typeof claims.azp !== "string" ||
        !this.options.allowedClientIds.includes(claims.azp) ||
        (claims.nbf !== undefined &&
          (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf)))
      ) {
        return null;
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (
        claims.exp <= nowSeconds - CLOCK_TOLERANCE_SECONDS ||
        claims.iat > nowSeconds + CLOCK_TOLERANCE_SECONDS ||
        (typeof claims.nbf === "number" &&
          claims.nbf > nowSeconds + CLOCK_TOLERANCE_SECONDS)
      ) {
        return null;
      }

      if (
        !Array.isArray(claims.permissions) ||
        !claims.permissions.every(
          (permission) =>
            typeof permission === "string" && permission.length <= 128,
        )
      ) {
        return null;
      }

      const delegatedActorIds = parseActorChain(claims.act);
      if (!delegatedActorIds) return null;

      const jwksResponse = await fetch(this.jwksUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      if (!jwksResponse.ok) return null;

      const jwks = (await jwksResponse.json()) as Auth0Jwks;
      if (!Array.isArray(jwks.keys)) return null;
      const matchingKeys = (jwks.keys as Auth0Jwk[]).filter(
        (key) =>
          key.kid === header.kid &&
          key.kty === "RSA" &&
          key.use === "sig" &&
          (key.alg === undefined || key.alg === "RS256"),
      );
      if (matchingKeys.length !== 1) return null;
      const jwk = matchingKeys[0];
      if (typeof jwk.n !== "string" || typeof jwk.e !== "string") return null;

      const publicKey = await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const signedContent = new TextEncoder().encode(
        encodedHeader + "." + encodedPayload,
      );
      const signature = decodeBase64Url(encodedSignature);
      const valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        signature,
        signedContent,
      );
      if (!valid) return null;

      return Object.freeze({
        subjectId: claims.sub,
        permissions: Object.freeze([...claims.permissions]),
        delegatedActorIds,
      });
    } catch {
      return null;
    }
  }

  private hasAudience(audience: unknown): boolean {
    return (
      audience === this.options.audience ||
      (Array.isArray(audience) &&
        audience.includes(this.options.audience) &&
        audience.every((entry) => typeof entry === "string"))
    );
  }
}
