import { beforeAll, describe, expect, it } from "vitest";
import { Auth0AccessTokenVerifier } from "../src/security/auth0-access-token-verifier.js";

const issuer = "https://aios-example.us.auth0.com/";
const audience = "https://api.aios.example";
const clientId = "aios-client-id";
const now = 1_794_456_000_000;

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function token(
  overrides: Record<string, unknown> = {},
  headerOverrides: Record<string, unknown> = {},
): Promise<string> {
  const header = encode({ alg: "RS256", typ: "JWT", kid: "key-1", ...headerOverrides });
  const payload = encode({
    iss: issuer,
    aud: audience,
    sub: "auth0|human-42",
    exp: Math.floor(now / 1000) + 300,
    iat: Math.floor(now / 1000),
    azp: clientId,
    permissions: ["approval:write"],
    ...overrides,
  });
  const input = new TextEncoder().encode(header + "." + payload);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, input);
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encodedSignature = btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return header + "." + payload + "." + encodedSignature;
}

function verifier(): Auth0AccessTokenVerifier {
  return new Auth0AccessTokenVerifier({
    issuer,
    audience,
    allowedClientIds: [clientId],
    now: () => now,
    fetcher: async () =>
      new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "key-1", use: "sig", alg: "RS256" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  privateKey = pair.privateKey;
  publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
});

describe("Auth0 access token verifier", () => {
  it("accepts a valid RS256 token and returns only verified identity claims", async () => {
    const result = await verifier().verifyCredential(await token());
    expect(result).toEqual({
      subjectId: "auth0|human-42",
      permissions: ["approval:write"],
    });
  });

  it("rejects a tampered signature", async () => {
    const signed = await token();
    const tampered = signed.slice(0, -1) + (signed.endsWith("A") ? "B" : "A");
    expect(await verifier().verifyCredential(tampered)).toBeNull();
  });

  it.each([
    ["wrong issuer", { iss: "https://attacker.example/" }],
    ["wrong audience", { aud: "https://other-api.example" }],
    ["unapproved client", { azp: "gemini-bridge-client" }],
    ["expired token", { exp: Math.floor(now / 1000) - 120 }],
    ["future not-before", { nbf: Math.floor(now / 1000) + 120 }],
    ["missing permissions", { permissions: undefined }],
    ["non-string subject", { sub: 42 }],
  ])("rejects %s", async (_label, claims) => {
    expect(await verifier().verifyCredential(await token(claims))).toBeNull();
  });

  it("rejects algorithm confusion and remote-key headers", async () => {
    expect(await verifier().verifyCredential(await token({}, { alg: "none" }))).toBeNull();
    expect(await verifier().verifyCredential(await token({}, { jku: "https://attacker.example/jwks" }))).toBeNull();
  });

  it("rejects malformed credentials and provider failures", async () => {
    expect(await verifier().verifyCredential({ sub: "auth0|fake" })).toBeNull();
    expect(await verifier().verifyCredential("not.a.jwt.with.extra")).toBeNull();
    const failing = new Auth0AccessTokenVerifier({
      issuer,
      audience,
      allowedClientIds: [clientId],
      now: () => now,
      fetcher: async () => { throw new Error("network failure"); },
    });
    expect(await failing.verifyCredential(await token())).toBeNull();
  });

  it("requires secure, explicit verifier configuration", () => {
    expect(() => new Auth0AccessTokenVerifier({
      issuer: "http://aios-example.us.auth0.com/",
      audience,
      allowedClientIds: [clientId],
    })).toThrow(TypeError);
    expect(() => new Auth0AccessTokenVerifier({
      issuer,
      audience,
      allowedClientIds: [],
    })).toThrow(TypeError);
  });
});
