import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { ClerkKeyDiscoveryError, ClerkTokenVerifier, bearerFromRequest } from "./clerk-auth.mjs";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "clerk-test-key", alg: "RS256", use: "sig", key_ops: ["verify"] };
const now = 1_800_000_000;
const issuer = "https://sample.clerk.accounts.dev";
const audience = "ai-engineering-os-api";
const party = "https://dashboard.example";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function token(claimOverrides = {}, headerOverrides = {}, signingKey = privateKey) {
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
  return data + "." + sign("RSA-SHA256", Buffer.from(data), signingKey).toString("base64url");
}

function verifier(fetcher, clock = () => now) {
  return new ClerkTokenVerifier({
    issuer,
    audience,
    authorizedParties: [party],
    now: clock,
    fetcher: fetcher ?? (async (url) => {
      assert.equal(url, "https://sample.clerk.accounts.dev/.well-known/jwks.json");
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  });
}

test("accepts a valid Clerk session token and returns only stable identity fields", async () => {
  const identity = await verifier().verifyToken(token());
  assert.deepEqual(identity, {
    subjectId: "user_test123",
    sessionId: "sess_test123",
    authorizedParty: party,
  });
  assert.equal(Object.isFrozen(identity), true);
  assert.equal("permissions" in identity, false);
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
  ["non-numeric expiry", { exp: "never" }],
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
  for (const invalid of ["http://sample.clerk.accounts.dev", "https://sample.clerk.accounts.dev/", "https://sample.clerk.accounts.dev/path"]) {
    assert.throws(() => new ClerkTokenVerifier({ issuer: invalid, audience, authorizedParties: [party] }));
  }
});

test("requires exact allowed frontend origins", () => {
  for (const invalid of [[], [""], ["https://dashboard.example/"], ["ftp://dashboard.example"]]) {
    assert.throws(() => new ClerkTokenVerifier({ issuer, audience, authorizedParties: invalid }));
  }
});

test("allows localhost HTTP only for development authorized parties", () => {
  assert.doesNotThrow(() => new ClerkTokenVerifier({
    issuer, audience, authorizedParties: ["http://localhost:3000"],
  }));
});

test("classifies JWKS HTTP failures as infrastructure errors", async () => {
  const unavailable = verifier(async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(() => unavailable.verifyToken(token()), ClerkKeyDiscoveryError);
});

test("classifies JWKS network failures as infrastructure errors", async () => {
  const unavailable = verifier(async () => { throw new Error("network timeout"); });
  await assert.rejects(() => unavailable.verifyToken(token()), ClerkKeyDiscoveryError);
});

test("rejects malformed and oversized JWKS responses as infrastructure errors", async () => {
  const malformed = verifier(async () => new Response("{not-json", { status: 200 }));
  await assert.rejects(() => malformed.verifyToken(token()), ClerkKeyDiscoveryError);

  const oversized = verifier(async () => new Response(" ".repeat(65_537), { status: 200 }));
  await assert.rejects(() => oversized.verifyToken(token()), ClerkKeyDiscoveryError);
});

test("coalesces concurrent JWKS discovery requests", async () => {
  let calls = 0;
  const instance = verifier(async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  });
  await Promise.all([instance.verifyToken(token()), instance.verifyToken(token()), instance.verifyToken(token())]);
  assert.equal(calls, 1);
});

test("throttles unknown-kid refreshes to prevent JWKS fetch amplification", async () => {
  let calls = 0;
  const instance = verifier(async () => {
    calls += 1;
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  });
  const unknownKidToken = token({}, { kid: "attacker-controlled-kid" });
  await instance.loadKeys();
  await assert.rejects(() => instance.verifyToken(unknownKidToken), /Unknown Clerk signing key/);
  await assert.rejects(() => instance.verifyToken(unknownKidToken), /Unknown Clerk signing key/);
  assert.equal(calls, 2, "one initial discovery plus one forced refresh only");
});

test("rejects RSA signing keys below the 2048-bit minimum", async () => {
  const weak = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const weakJwk = { ...weak.publicKey.export({ format: "jwk" }), kid: "clerk-test-key", alg: "RS256", use: "sig", key_ops: ["verify"] };
  const weakVerifier = verifier(async () => new Response(JSON.stringify({ keys: [weakJwk] }), { status: 200 }));
  await assert.rejects(() => weakVerifier.verifyToken(token({}, {}, weak.privateKey)), ClerkKeyDiscoveryError);
});

test("rejects malformed and oversized bearer tokens", async () => {
  await assert.rejects(() => verifier().verifyToken("not-a-jwt"));
  await assert.rejects(() => verifier().verifyToken("x".repeat(16_385)));
  await assert.rejects(() => verifier().verifyToken("@@@.@@@.@@@"));
});

test("rejects malformed bearer header values", () => {
  assert.equal(bearerFromRequest({ headers: { authorization: "Bearer abc.def.ghi" } }), "abc.def.ghi");
  for (const value of [undefined, "Basic abc", "Bearer ", "Bearer abc extra", "Bearer  abc"]) {
    assert.throws(() => bearerFromRequest({ headers: { authorization: value } }));
  }
});

