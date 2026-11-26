import { createPublicKey, verify as verifySignature, constants } from "node:crypto";

const MAX_TOKEN_BYTES = 16_384;
const CACHE_MS = 300_000;
const CLOCK_SKEW = 60;

function decodePart(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error("Malformed JWT encoding");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

export class ClerkTokenVerifier {
  constructor({ issuer, audience, allowedOrigins, fetcher = fetch, now = () => Date.now() / 1000 }) {
    const parsed = new URL(issuer);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new TypeError("CLERK_ISSUER must be an HTTPS origin");
    }
    if (!audience || !Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
      throw new TypeError("Clerk audience and an explicit origin allow-list are required");
    }
    this.issuer = issuer.replace(/\/$/, "");
    this.audience = audience;
    this.allowedOrigins = new Set(allowedOrigins.map((origin) => {
      const url = new URL(origin);
      if (url.protocol !== "https:" && url.hostname !== "localhost") throw new TypeError("Allowed origins must use HTTPS");
      if (url.origin !== origin) throw new TypeError("Allowed origins must be exact origins without paths");
      return origin;
    }));
    this.fetcher = fetcher;
    this.now = now;
    this.jwks = null;
    this.jwksExpires = 0;
    this.pending = null;
    this.jwksUrl = new URL("/.well-known/jwks.json", this.issuer).toString();
  }

  async loadKeys(force = false) {
    if (!force && this.jwks && this.now() * 1000 < this.jwksExpires) return this.jwks;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const response = await this.fetcher(this.jwksUrl, { signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("Clerk signing-key discovery failed");
      const body = await response.json();
      if (!Array.isArray(body.keys) || body.keys.length > 20) throw new Error("Invalid Clerk JWKS response");
      this.jwks = body.keys;
      this.jwksExpires = this.now() * 1000 + CACHE_MS;
      return this.jwks;
    })();
    try { return await this.pending; } finally { this.pending = null; }
  }

  async verifyToken(token) {
    if (typeof token !== "string" || token.length > MAX_TOKEN_BYTES) throw new Error("Invalid bearer token");
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Malformed bearer token");
    const header = decodePart(parts[0]);
    const claims = decodePart(parts[1]);
    if (!["RS256", "ES256"].includes(header.alg) || typeof header.kid !== "string") throw new Error("Unsupported token algorithm");
    const keys = await this.loadKeys();
    let jwk = keys.find((key) => key.kid === header.kid && key.use !== "enc" && (!key.alg || key.alg === header.alg));
    if (!jwk) {
      const refreshed = await this.loadKeys(true);
      jwk = refreshed.find((key) => key.kid === header.kid && key.use !== "enc" && (!key.alg || key.alg === header.alg));
    }
    if (!jwk) throw new Error("Unknown Clerk signing key");
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const signature = Buffer.from(parts[2], "base64url");
    const data = Buffer.from(parts[0] + "." + parts[1]);
    const valid = header.alg === "RS256"
      ? verifySignature("RSA-SHA256", data, { key, padding: constants.RSA_PKCS1_PADDING }, signature)
      : verifySignature("sha256", data, { key, dsaEncoding: "ieee-p1363" }, signature);
    if (!valid) throw new Error("Invalid token signature");
    if (claims.iss !== this.issuer) throw new Error("Invalid token issuer");
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(this.audience)) throw new Error("Invalid token audience");
    if (typeof claims.sub !== "string" || !claims.sub) throw new Error("Missing token subject");
    const now = this.now();
    if (typeof claims.exp !== "number" || claims.exp <= now - CLOCK_SKEW) throw new Error("Expired token");
    if (typeof claims.iat !== "number" || claims.iat > now + CLOCK_SKEW) throw new Error("Invalid token issue time");
    if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now + CLOCK_SKEW)) throw new Error("Token not active");
    if (typeof claims.azp !== "string" || !this.allowedOrigins.has(claims.azp)) throw new Error("Unauthorized token origin");
    return Object.freeze({ subjectId: claims.sub, authorizedParty: claims.azp });
  }
}

export function bearerFromRequest(request) {
  const value = request.headers.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) throw new Error("Missing bearer token");
  return value.slice(7);
}
