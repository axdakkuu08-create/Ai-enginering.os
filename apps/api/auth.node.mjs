import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { Auth0TokenVerifier } from "./auth0-auth.mjs";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "auth0-test-key", alg: "RS256", use: "sig" };
const now = 1_800_000_000;
const issuer = "https://tenant.example/";
const audience = "https://api.aios.example";
const clientId = "auth0-client-test";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function token(claimOverrides = {}, headerOverrides = {}) {
  const header = b64({ alg: "RS256", kid: "auth0-test-key", typ: "JWT", ...headerOverrides });
  const claims = b64({
    iss: issuer,
    aud: [audience, "https://tenant.example/userinfo"],
    sub: "auth0|user_test",
    azp: clientId,
    iat: now,
    exp: now + 300,
    ...claimOverrides,
  });
  const data = header + "." + claims;
  return data + "." + sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url");
}

function verifier() {
  return new Auth0TokenVerifier({
    issuer,
    audience,
    allowedClientIds: [clientId],
    now: () => now,
    fetcher: async (url) => {
      assert.equal(url, "https://tenant.example/.well-known/jwks.json");
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
}

test("accepts a valid Auth0 RS256 access token and treats azp as a client ID", async () => {
  const identity = await verifier().verifyToken(token());
  assert.deepEqual(identity, { subjectId: "auth0|user_test", authorizedParty: clientId });
});

for (const [name, claims] of [
  ["issuer mismatch", { iss: "https://attacker.example/" }],
  ["audience mismatch", { aud: "https://other-api.example" }],
  ["unapproved client ID", { azp: "attacker-client" }],
  ["expired token", { exp: now - 100 }],
  ["missing subject", { sub: "" }],
  ["future issue time", { iat: now + 120 }],
  ["token not active", { nbf: now + 120 }],
]) {
  test("rejects " + name, async () => assert.rejects(() => verifier().verifyToken(token(claims))));
}

test("rejects a tampered signature", async () => {
  const parts = token().split(".");
  parts[1] = b64({
    iss: issuer,
    aud: audience,
    sub: "auth0|attacker",
    azp: clientId,
    iat: now,
    exp: now + 300,
  });
  await assert.rejects(() => verifier().verifyToken(parts.join(".")));
});

test("rejects non-RS256 algorithms", async () => {
  await assert.rejects(() => verifier().verifyToken(token({}, { alg: "HS256" })));
});

test("requires an exact HTTPS Auth0 tenant issuer", () => {
  assert.throws(() => new Auth0TokenVerifier({
    issuer: "http://tenant.example/",
    audience,
    allowedClientIds: [clientId],
  }));
});

test("requires a non-empty client ID allow-list", () => {
  assert.throws(() => new Auth0TokenVerifier({
    issuer,
    audience,
    allowedClientIds: [],
  }));
});
