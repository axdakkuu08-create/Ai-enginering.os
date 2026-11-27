import { createPublicKey, verify as verifySignature, constants } from "node:crypto";

const MAX_TOKEN_BYTES = 16_384;
const JWKS_CACHE_MS = 300_000;
const CLOCK_SKEW_SECONDS = 5;

function decodeJsonPart(part) {
  if (typeof part !== "string" || !/^[A-Za-z0-9_-]+$/.test(part)) {
    throw new Error("Malformed JWT encoding");
  }
  const value = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Malformed JWT JSON");
  }
  return value;
}

export class ClerkTokenVerifier {
  constructor({ issuer, audience, authorizedParties, fetcher = fetch, now = () => Date.now() / 1000 }) {
    const parsedIssuer = new URL(issuer);
    if (
      parsedIssuer.protocol !== "https:" ||
      parsedIssuer.username ||
      parsedIssuer.password ||
      parsedIssuer.pathname !== "/" ||
      parsedIssuer.search ||
      parsedIssuer.hash
    ) {
      throw new TypeError("CLERK_ISSUER must be an HTTPS Clerk instance origin with a trailing slash");
    }
    if (typeof audience !== "string" || !audience.trim()) {
      throw new TypeError("CLERK_AUDIENCE is required");
    }
    if (!Array.isArray(authorizedParties) || authorizedParties.length === 0 ||
        authorizedParties.some((party) => typeof party !== "string" || !party.trim())) {
      throw new TypeError("At least one authorized Clerk party is required");
    }

    this.issuer = parsedIssuer.toString();
    this.audience = audience;
    this.authorizedParties = new Set(authorizedParties);
    this.fetcher = fetcher;
    this.now = now;
    this.jwks = null;
    this.jwksExpiresAt = 0;
    this.pendingJwks = null;
    this.jwksUrl = new URL(".well-known/jwks.json", this.issuer).toString();
  }

  async loadKeys(forceRefresh = false) {
    if (!forceRefresh && this.jwks && this.now() * 1000 < this.jwksExpiresAt) {
      return this.jwks;
    }
    if (this.pendingJwks) return this.pendingJwks;

    this.pendingJwks = (async () => {
      const response = await this.fetcher(this.jwksUrl, {
        signal: AbortSignal.timeout(5000),
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("Clerk signing-key discovery failed");
      const body = await response.json();
      if (!Array.isArray(body.keys) || body.keys.length === 0 || body.keys.length > 20) {
        throw new Error("Invalid Clerk JWKS response");
      }
      this.jwks = body.keys;
      this.jwksExpiresAt = this.now() * 1000 + JWKS_CACHE_MS;
      return this.jwks;
    })();

    try {
      return await this.pendingJwks;
    } finally {
      this.pendingJwks = null;
    }
  }

  async verifyToken(token) {
    if (typeof token !== "string" || Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) {
      throw new Error("Invalid bearer token");
    }
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Malformed bearer token");

    const header = decodeJsonPart(parts[0]);
    const claims = decodeJsonPart(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || header.crit) {
      throw new Error("Unsupported Clerk token header");
    }

    const findSigningKey = (keys) => keys.find((key) =>
      key.kid === header.kid &&
      key.kty === "RSA" &&
      key.use === "sig" &&
      (!key.alg || key.alg === "RS256") &&
      (!Array.isArray(key.key_ops) || key.key_ops.includes("verify"))
    );

    let jwk = findSigningKey(await this.loadKeys());
    if (!jwk) jwk = findSigningKey(await this.loadKeys(true));
    if (!jwk) throw new Error("Unknown Clerk signing key");

    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    const signature = Buffer.from(parts[2], "base64url");
    const signedData = Buffer.from(parts[0] + "." + parts[1]);
    const valid = verifySignature(
      "RSA-SHA256",
      signedData,
      { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
      signature,
    );
    if (!valid) throw new Error("Invalid Clerk token signature");

    if (claims.iss !== this.issuer) throw new Error("Invalid Clerk token issuer");
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(this.audience)) throw new Error("Invalid Clerk token audience");
    if (typeof claims.sub !== "string" || !claims.sub.startsWith("user_")) {
      throw new Error("Missing or invalid Clerk user subject");
    }
    if (typeof claims.sid !== "string" || !claims.sid.startsWith("sess_")) {
      throw new Error("Missing or invalid Clerk session ID");
    }

    const now = this.now();
    if (typeof claims.exp !== "number" || claims.exp <= now - CLOCK_SKEW_SECONDS) {
      throw new Error("Expired Clerk token");
    }
    if (typeof claims.iat !== "number" || claims.iat > now + CLOCK_SKEW_SECONDS) {
      throw new Error("Invalid Clerk token issue time");
    }
    if (claims.nbf !== undefined &&
        (typeof claims.nbf !== "number" || claims.nbf > now + CLOCK_SKEW_SECONDS)) {
      throw new Error("Clerk token not active");
    }
    if (claims.sts !== undefined && claims.sts !== "active") {
      throw new Error("Clerk session is not active");
    }
    if (typeof claims.azp !== "string" || !this.authorizedParties.has(claims.azp)) {
      throw new Error("Unauthorized Clerk party");
    }

    return Object.freeze({
      subjectId: claims.sub,
      sessionId: claims.sid,
      authorizedParty: claims.azp,
    });
  }
}

export function bearerFromRequest(request) {
  const value = request.headers.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) {
    throw new Error("Missing bearer token");
  }
  return value.slice(7);
}
