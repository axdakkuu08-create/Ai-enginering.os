import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  Auth0AccessTokenVerifier,
} from "../src/security/auth0-access-token-verifier.js";

const ISSUER = "https://aios-test.example/";
const AUDIENCE = "https://api.ai-engineering-os.example";
const CLIENT_ID = "aios-test-client";
const NOW = 1_800_000_000;

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function createToken(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): Promise<string> {
  const encodedHeader = encodeJson({
    alg: "RS256",
    typ: "JWT",
    kid: "test-key-1",
    ...header,
  });
  const encodedClaims = encodeJson({
    iss: ISSUER,
    aud: AUDIENCE,
    azp: CLIENT_ID,
    sub: "auth0|human-123",
    iat: NOW - 30,
    exp: NOW + 300,
    permissions: ["approval:write", "project:read"],
    ...claims,
  });
  const content = `${encodedHeader}.${encodedClaims}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(content),
  );
  return `${content}.${base64Url(new Uint8Array(signature))}`;
}

function makeFetcher(
  implementation?: typeof fetch,
): typeof fetch {
  if (implementation) return implementation;
  return (async () =>
    new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

function makeVerifier(fetcher = makeFetcher()) {
  return new Auth0AccessTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    allowedClientIds: [CLIENT_ID],
    now: () => NOW,
    fetcher,
  });
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  privateKey = pair.privateKey;
  publicJwk = {
    ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
    kid: "test-key-1",
    alg: "RS256",
    use: "sig",
  };
});

describe("Auth0 RS256 access-token verifier", () => {
  it("accepts a valid token and derives subject and permissions from signed claims", async () => {
    const token = await createToken();
    await expect(makeVerifier().verifyCredential(token)).resolves.toEqual({
      subjectId: "auth0|human-123",
      permissions: ["approval:write", "project:read"],
    });
  });

  it("rejects a wrong issuer", async () => {
    const token = await createToken({ iss: "https://other.example/" });
    await expect(makeVerifier().verifyCredential(token)).resolves.toBeNull();
  });

  it("rejects a wrong audience", async () => {
    const token = await createToken({ aud: "https://other-api.example" });
    await expect(makeVerifier().verifyCredential(token)).resolves.toBeNull();
  });

  it("accepts an audience array only when it contains the configured API", async () => {
    const token = await createToken({ aud: [AUDIENCE, "https://other-api.example"] });
    await expect(makeVerifier().verifyCredential(token)).resolves.toMatchObject({
      subjectId: "auth0|human-123",
    });
  });

  it("rejects an unapproved authorized party", async () => {
    const token = await createToken({ azp: "unapproved-client" });
    await expect(makeVerifier().verifyCredential(token)).resolves.toBeNull();
  });

  it("rejects expired and not-yet-valid tokens", async () => {
    const expired = await createToken({ exp: NOW - 120 });
    const notYetValid = await createToken({ nbf: NOW + 120 });
    await expect(makeVerifier().verifyCredential(expired)).resolves.toBeNull();
    await expect(makeVerifier().verifyCredential(notYetValid)).resolves.toBeNull();
  });

  it("rejects unsupported algorithms and malformed credentials", async () => {
    const unsupported = await createToken({}, { alg: "none" });
    await expect(makeVerifier().verifyCredential(unsupported)).resolves.toBeNull();
    await expect(makeVerifier().verifyCredential("not-a-jwt")).resolves.toBeNull();
    await expect(makeVerifier().verifyCredential("x".repeat(16_385))).resolves.toBeNull();
  });

  it("rejects a token with a modified signature", async () => {
    const token = await createToken();
    const [header, payload, signature] = token.split(".");
    const changed = `${header}.${payload}.${signature.slice(0, -1)}A`;
    await expect(makeVerifier().verifyCredential(changed)).resolves.toBeNull();
  });

  it("requires the Auth0 permissions claim to be an array of strings", async () => {
    const token = await createToken({ permissions: "approval:write" });
    await expect(makeVerifier().verifyCredential(token)).resolves.toBeNull();
  });

  it("fails closed when the JWKS endpoint is unavailable", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    const token = await createToken();
    await expect(makeVerifier(fetcher).verifyCredential(token)).resolves.toBeNull();
  });

  it("reuses cached signing keys within the cache window", async () => {
    const fetcher = vi.fn(makeFetcher());
    const verifier = makeVerifier(fetcher as unknown as typeof fetch);
    const token = await createToken();
    await verifier.verifyCredential(token);
    await verifier.verifyCredential(token);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe issuer configuration and missing client allow-lists", () => {
    expect(
      () =>
        new Auth0AccessTokenVerifier({
          issuer: "http://aios-test.example/",
          audience: AUDIENCE,
          allowedClientIds: [CLIENT_ID],
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new Auth0AccessTokenVerifier({
          issuer: ISSUER,
          audience: AUDIENCE,
          allowedClientIds: [],
        }),
    ).toThrow(TypeError);
  });
});
