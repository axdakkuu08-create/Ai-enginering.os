import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { ClerkTokenVerifier } from "./clerk-auth.mjs";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
const now = 1_800_000_000;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(claimOverrides = {}, headerOverrides = {}) {
  const head = b64({ alg: "RS256", kid: "test-key", typ: "JWT", ...headerOverrides });
  const claims = b64({ iss: "https://clerk.example", aud: "ai-engineering-os-api", sub: "user_test", azp: "https://preview.example", iat: now, exp: now + 300, ...claimOverrides });
  const data = head + "." + claims;
  return data + "." + sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url");
}
function verifier() {
  return new ClerkTokenVerifier({ issuer: "https://clerk.example", audience: "ai-engineering-os-api", allowedOrigins: ["https://preview.example"], now: () => now, fetcher: async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "content-type": "application/json" } }) });
}
test("accepts a valid signed Clerk-shaped access token", async () => {
  const identity = await verifier().verifyToken(token());
  assert.deepEqual(identity, { subjectId: "user_test", authorizedParty: "https://preview.example" });
});
for (const [name, claims] of [
  ["issuer mismatch", { iss: "https://attacker.example" }],
  ["audience mismatch", { aud: "other-api" }],
  ["origin not allow-listed", { azp: "https://evil.example" }],
  ["expired", { exp: now - 100 }],
  ["missing subject", { sub: "" }],
]) test("rejects " + name, async () => assert.rejects(() => verifier().verifyToken(token(claims))));
test("rejects a tampered signature", async () => {
  const parts = token().split(".");
  parts[1] = b64({ iss: "https://clerk.example", aud: "ai-engineering-os-api", sub: "user_attacker", azp: "https://preview.example", iat: now, exp: now + 300 });
  await assert.rejects(() => verifier().verifyToken(parts.join(".")));
});
