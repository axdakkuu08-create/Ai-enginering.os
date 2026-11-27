import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { ClerkTokenVerifier } from "./clerk-auth.mjs";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "clerk-test-key", alg: "RS256", use: "sig", key_ops: ["verify"] };
const now = 1_800_000_000;
const issuer = "https://sample.clerk.accounts.dev";
const audience = "ai-engineering-os-api";
const party = "https://dashboard.example";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function token(claimOverrides = {}, headerOverrides = {}) {
  const header = b64({ alg: "RS256", kid: "clerk-test-key", typ: "JWT", ...headerOverrides });
  const claims = b64({
    iss: issuer,
    aud: [audience],
    sub: "user_test123",
    sid: "sess_test123",
    azp: party,
    sts: "active",
    iat: now,
    nbf: now - 1,
    exp: now + 60,
    ...claimOverrides,
  });
  const data = header + "." + claims;
  return data + "." + sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url");
}

function verifier(fetcher) {
  return new ClerkTokenVerifier({
    issuer,
    audience,
    authorizedParties: [party],
    now: () => now,
    fetcher: fetcher ?? (async (url) => {
      assert.equal(url, "https://sample.clerk.accounts.dev/.well-known/jwks.json");
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  });
}

test("accepts a valid Clerk session token and returns the Clerk user/session IDs", async () => {
  const identity = await verifier().verifyToken(token());
  assert.deepEqual(identity, {
    subjectId: "user_test123",
    sessionId: "sess_test123",
    authorizedParty: party,
  });
});

for (const [name, claims] of [
  ["issuer mismatch", { iss: "https://attacker.example/" }],
  ["audience mismatch", { aud: "another-api" }],
  ["unapproved authorized party", { azp: "https://attacker.example" }],
  ["expired token", { exp: now - 100 }],
  ["missing subject", { sub: "" }],
  ["non-Clerk subject", { sub: "legacy-provider|legacy-user" }],
  ["missing session ID", { sid: "" }],
  ["future issue time", { iat: now + 120 }],
  ["token not active", { nbf: now + 120 }],
  ["pending session", { sts: "pending" }],
]) {
  test("rejects " + name, async () => assert.rejects(() => verifier().verifyToken(token(claims))));
}

test("rejects a tampered signature", async () => {
  const parts = token().split(".");
  parts[1] = b64({
    iss: issuer,
    aud: audience,
    sub: "user_attacker",
    sid: "sess_attacker",
    azp: party,
    iat: now,
    exp: now + 60,
  });
  await assert.rejects(() => verifier().verifyToken(parts.join(".")));
});

test("rejects non-RS256 algorithms", async () => {
  await assert.rejects(() => verifier().verifyToken(token({}, { alg: "HS256" })));
});

test("requires an exact HTTPS Clerk issuer origin", () => {
  assert.throws(() => new ClerkTokenVerifier({
    issuer: "http://sample.clerk.accounts.dev",
    audience,
    authorizedParties: [party],
  }));
});

test("requires at least one authorized party", () => {
  assert.throws(() => new ClerkTokenVerifier({
    issuer,
    audience,
    authorizedParties: [],
  }));
});

test("treats JWKS discovery failures as infrastructure errors", async () => {
  const unavailable = verifier(async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(() => unavailable.verifyToken(token()), /Clerk signing-key discovery failed/);
});
