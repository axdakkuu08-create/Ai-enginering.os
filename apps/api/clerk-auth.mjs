import { createPublicKey, verify as verifySignature, constants } from "node:crypto";

const MAX_TOKEN_BYTES = 16_384;
const MAX_JWKS_BYTES = 65_536;
const JWKS_CACHE_MS = 300_000;
const JWKS_REFRESH_COOLDOWN_MS = 15_000;
const CLOCK_SKEW_SECONDS = 5;
const MIN_RSA_MODULUS_BITS = 2048;

export class ClerkKeyDiscoveryError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ClerkKeyDiscoveryError";
  }
}

function decodeJsonPart(part) {
  if (typeof part !== "string" || !/^[A-Za-z0-9_-]+$/.test(part)) {
    throw new Error("Malformed JWT encoding");
  }
  let value;
  try {
    value = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch (error) {
    throw new Error("Malformed JWT JSON", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Malformed JWT JSON");
  }
  return value;
}

function isAllowedOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    const secure = parsed.protocol === "https:";
    const local = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    return (secure || local) && parsed.origin === value && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

export class ClerkTokenVerifier {
  constructor({ issuer, audience, authorizedParties, fetcher = fetch, now = () => Date.now() / 1000 }) {
    let parsedIssuer;
    try {
      parsedIssuer = new URL(issuer);
    } catch (error) {
      throw new TypeError("CLERK_ISSUER must be an exact HTTPS Clerk instance origin", { cause: error });
    }
    if (!isAllowedOrigin(issuer) || parsedIssuer.protocol !== "https:") {
      throw new TypeError("CLERK_ISSUER must be an exact HTTPS Clerk instance origin without a trailing slash");
    }
    if (typeof audience !== "string" || !audience.trim() || audience !== audience.trim()) {
      throw new TypeError("CLERK_AUDIENCE is required and must not contain surrounding whitespace");
    }
    if (!Array.isArray(authorizedParties) || authorizedParties.length === 0 ||
        authorizedParties.some((party) => !isAllowedOrigin(party))) {
      throw new TypeError("Authorized Clerk parties must be exact HTTPS origins (HTTP localhost is allowed for development)");
    }

    this.issuer = parsedIssuer.origin;
    this.audience = audience;
    this.authorizedParties = new Set(authorizedParties);
    this.fetcher = fetcher;
    this.now = now;
    this.jwks = null;
    this.jwksExpiresAt = 0;
    this.pendingJwks = null;
    this.lastForcedRefreshAt = 0;
    this.jwksUrl = new URL("/.well-known/jwks.json", this.issuer).toString();
  }

  async loadKeys(forceRefresh = false) {
    if (!forceRefresh && this.jwks && this.now() * 1000 < this.jwksExpiresAt) {
      return this.jwks;
    }
    if (this.pendingJwks) return this.pendingJwks;

    this.pendingJwks = (async () => {
      let response;
      try {
        response = await this.fetcher(this.jwksUrl, {
          signal: AbortSignal.timeout(5000),
          headers: { accept: "application/json" },
        });
      } catch (error) {
        throw new ClerkKeyDiscoveryError("Clerk signing-key discovery unavailable", { cause: error });
      }
      if (!response?.ok) throw new ClerkKeyDiscoveryError("Clerk signing-key discovery failed");

      let body;
      try {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Clerk JWKS response body is unavailable");
        const chunks = [];
        let totalBytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = Buffer.from(value);
            totalBytes += chunk.length;
            if (totalBytes > MAX_JWKS_BYTES) {
              await reader.cancel();
              throw new Error("Clerk JWKS response exceeds the size limit");
            }
            chunks.push(chunk);
          }
        } finally {
          reader.releaseLock();
        }
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (error) {
        throw new ClerkKeyDiscoveryError("Clerk signing-key response is invalid or too large", { cause: error });
      }
      if (!Array.isArray(body?.keys) || body.keys.length === 0 || body.keys.length > 20) {
        throw new ClerkKeyDiscoveryError("Invalid Clerk JWKS response");
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

  async refreshKeysForUnknownKid() {
    const now = this.now() * 1000;
    if (now - this.lastForcedRefreshAt < JWKS_REFRESH_COOLDOWN_MS) return this.jwks ?? [];
    this.lastForcedRefreshAt = now;
    return this.loadKeys(true);
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
    if (!/^[A-Za-z0-9_-]+$/.test(parts[2])) throw new Error("Malformed JWT signature");

    const findSigningKey = (keys) => keys.find((key) =>
      key.kid === header.kid &&
      key.kty === "RSA" &&
      key.use === "sig" &&
      (key.alg === undefined || key.alg === "RS256") &&
      (key.key_ops === undefined || (Array.isArray(key.key_ops) && key.key_ops.includes("verify")))
    );

    let jwk = findSigningKey(await this.loadKeys());
    if (!jwk) jwk = findSigningKey(await this.refreshKeysForUnknownKid());
    if (!jwk) throw new Error("Unknown Clerk signing key");

    let publicKey;
    try {
      publicKey = createPublicKey({ key: jwk, format: "jwk" });
    } catch (error) {
      throw new ClerkKeyDiscoveryError("Clerk signing key is invalid", { cause: error });
    }
    if (publicKey.asymmetricKeyDetails?.modulusLength < MIN_RSA_MODULUS_BITS) {
      throw new ClerkKeyDiscoveryError("Clerk RSA signing key is below the minimum strength");
    }
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
    if (!Number.isFinite(claims.exp) || claims.exp <= now - CLOCK_SKEW_SECONDS) {
      throw new Error("Expired Clerk token");
    }
    if (!Number.isFinite(claims.iat) || claims.iat > now + CLOCK_SKEW_SECONDS) {
      throw new Error("Invalid Clerk token issue time");
    }
    if (claims.nbf !== undefined &&
        (!Number.isFinite(claims.nbf) || claims.nbf > now + CLOCK_SKEW_SECONDS)) {
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
  if (typeof value !== "string" || !/^Bearer [^\\s]+$/.test(value)) {
    throw new Error("Missing or malformed bearer token");
  }
  return value.slice(7);
}
