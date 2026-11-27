import { createPublicKey, verify as verifySignature, constants } from "node:crypto";

const MAX_TOKEN_BYTES = 16_384;
const JWKS_CACHE_MS = 300_000;
const CLOCK_SKEW_SECONDS = 60;

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

export class Auth0TokenVerifier {
  constructor({ issuer, audience, allowedClientIds, fetcher = fetch, now = () => Date.now() / 1000 }) {
    const parsedIssuer = new URL(issuer);
    if (
      parsedIssuer.protocol !== "https:" ||
      parsedIssuer.username ||
      parsedIssuer.password ||
      parsedIssuer.pathname !== "/" ||
      parsedIssuer.search ||
      parsedIssuer.hash
    ) {
      throw new TypeError("AUTH0_ISSUER must be an HTTPS tenant origin");
    }
    if (typeof audience !== "string" || !audience.trim()) {
      throw new TypeError("AUTH0_AUDIENCE is required");
    }
    if (!Array.isArray(allowedClientIds) || allowedClientIds.length === 0 ||
        allowedClientIds.some((id) => typeof id !== "string" || !id.trim())) {
      throw new TypeError("At least one AUTH0_ALLOWED_CLIENT_IDS entry is required");
    }

    this.issuer = parsedIssuer.toString();
    this.audience = audience;
    this.allowedClientIds = new Set(allowedClientIds);
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
      if (!response.ok) throw new Error("Auth0 signing-key discovery failed");
      const body = await response.json();
      if (!Array.isArray(body.keys) || body.keys.length === 0 || body.keys.length > 20) {
        throw new Error("Invalid Auth0 JWKS response");
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
      throw new Error("Unsupported token header");
    }

    const findSigningKey = (keys) => keys.find((key) =>
      key.kid === header.kid &&
      key.kty === "RSA" &&
      key.use === "sig" &&
      (!key.alg || key.alg === "RS256")
    );

    let jwk = findSigningKey(await this.loadKeys());
    if (!jwk) jwk = findSigningKey(await this.loadKeys(true));
    if (!jwk) throw new Error("Unknown Auth0 signing key");

    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    const signature = Buffer.from(parts[2], "base64url");
    const signedData = Buffer.from(parts[0] + "." + parts[1]);
    const valid = verifySignature(
      "RSA-SHA256",
      signedData,
      { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
      signature,
    );
    if (!valid) throw new Error("Invalid token signature");

    if (claims.iss !== this.issuer) throw new Error("Invalid token issuer");
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(this.audience)) throw new Error("Invalid token audience");
    if (typeof claims.sub !== "string" || !claims.sub) throw new Error("Missing token subject");

    const now = this.now();
    if (typeof claims.exp !== "number" || claims.exp <= now - CLOCK_SKEW_SECONDS) {
      throw new Error("Expired token");
    }
    if (typeof claims.iat !== "number" || claims.iat > now + CLOCK_SKEW_SECONDS) {
      throw new Error("Invalid token issue time");
    }
    if (claims.nbf !== undefined &&
        (typeof claims.nbf !== "number" || claims.nbf > now + CLOCK_SKEW_SECONDS)) {
      throw new Error("Token not active");
    }

    if (typeof claims.azp !== "string" || !this.allowedClientIds.has(claims.azp)) {
      throw new Error("Unauthorized Auth0 client");
    }

    return Object.freeze({ subjectId: claims.sub, authorizedParty: claims.azp });
  }
}

export function bearerFromRequest(request) {
  const value = request.headers.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) {
    throw new Error("Missing bearer token");
  }
  return value.slice(7);
}
