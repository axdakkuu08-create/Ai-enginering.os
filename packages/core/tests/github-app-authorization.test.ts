import { describe, expect, it } from "vitest";
import {
  authorizeGitHubRepository,
  createGitHubAppJwt,
  GitHubAppAuthorizationError,
  type GitHubAppAuthConfig,
  type GitHubAppHttpClient,
} from "../src/security/github-app-authorization.js";

const repository = {
  id: 1444678703,
  fullName: "axdakkuu08-create/Ai-enginering.os",
};

async function privateKeyPem(): Promise<string> {
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
  const der = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  let binary = "";
  for (const byte of der) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----`;
}

async function config(): Promise<GitHubAppAuthConfig> {
  return {
    appId: "123456",
    installationId: 987654,
    privateKeyPem: await privateKeyPem(),
    expectedAccountLogin: "axdakkuu08-create",
    allowedRepositories: [repository],
  };
}

function jsonResponse(value: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
  };
}

function successfulHttp(): GitHubAppHttpClient {
  return async (url, init) => {
    if (url.endsWith("/app/installations/987654")) {
      expect(init.method).toBe("GET");
      expect(init.headers.Authorization).toMatch(/^Bearer /);
      return jsonResponse({
        id: 987654,
        account: { login: "axdakkuu08-create" },
      });
    }
    if (url.endsWith("/app/installations/987654/access_tokens")) {
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body ?? "{}")).toEqual({
        repository_ids: [repository.id],
        permissions: { contents: "read" },
      });
      return jsonResponse({
        token: "short-lived-fixture-token",
        expires_at: "2026-11-06T19:00:00Z",
        permissions: { contents: "read", metadata: "read" },
      });
    }
    if (url.endsWith("/installation/repositories?per_page=100")) {
      expect(init.headers.Authorization).toBe(
        "Bearer short-lived-fixture-token",
      );
      return jsonResponse({
        total_count: 1,
        repositories: [{ id: repository.id, full_name: repository.fullName }],
      });
    }
    throw new Error("Unexpected GitHub API request");
  };
}

describe("GitHub App installation authorization", () => {
  it("creates a short-lived RS256 app JWT with bounded claims", async () => {
    const pem = await privateKeyPem();
    const jwt = await createGitHubAppJwt("123456", pem, 1_800_000_000);
    const [headerPart, payloadPart, signaturePart] = jwt.split(".");
    expect(
      JSON.parse(atob(headerPart.replace(/-/g, "+").replace(/_/g, "/"))),
    ).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const payload = JSON.parse(
      atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { iat: number; exp: number; iss: string };
    expect(payload).toEqual({
      iat: 1_799_999_940,
      exp: 1_800_000_540,
      iss: "123456",
    });
    expect(signaturePart.length).toBeGreaterThan(100);
  });

  it("mints a token scoped to exactly the configured repository and read-only contents", async () => {
    const result = await authorizeGitHubRepository(
      await config(),
      repository.fullName,
      successfulHttp(),
      1_800_000_000,
    );
    expect(result.repository).toEqual(repository);
    expect(result.token).toBe("short-lived-fixture-token");
    expect(result.permissions).toEqual({ contents: "read", metadata: "read" });
  });

  it("rejects a repository not present in the trusted server allow-list before network access", async () => {
    let requests = 0;
    const http: GitHubAppHttpClient = async () => {
      requests += 1;
      return jsonResponse({});
    };
    await expect(
      authorizeGitHubRepository(
        await config(),
        "another-owner/another-repository",
        http,
      ),
    ).rejects.toThrow(GitHubAppAuthorizationError);
    expect(requests).toBe(0);
  });

  it("rejects an installation owned by an unexpected account", async () => {
    const http: GitHubAppHttpClient = async () =>
      jsonResponse({ id: 987654, account: { login: "unexpected-owner" } });
    await expect(
      authorizeGitHubRepository(await config(), repository.fullName, http),
    ).rejects.toThrow(/installation identity/i);
  });

  it("rejects a token whose repository scope contains additional repositories", async () => {
    const http: GitHubAppHttpClient = async (url) => {
      if (url.endsWith("/app/installations/987654")) {
        return jsonResponse({
          id: 987654,
          account: { login: "axdakkuu08-create" },
        });
      }
      if (url.endsWith("/access_tokens")) {
        return jsonResponse({
          token: "short-lived-fixture-token",
          expires_at: "2026-11-06T19:00:00Z",
          permissions: { contents: "read" },
        });
      }
      return jsonResponse({
        total_count: 2,
        repositories: [
          { id: repository.id, full_name: repository.fullName },
          { id: 111, full_name: "other-owner/other-repository" },
        ],
      });
    };
    await expect(
      authorizeGitHubRepository(await config(), repository.fullName, http),
    ).rejects.toThrow(/exactly one repository/i);
  });

  it("rejects write-capable installation token permissions", async () => {
    const http: GitHubAppHttpClient = async (url) => {
      if (url.endsWith("/app/installations/987654")) {
        return jsonResponse({
          id: 987654,
          account: { login: "axdakkuu08-create" },
        });
      }
      if (url.endsWith("/access_tokens")) {
        return jsonResponse({
          token: "short-lived-fixture-token",
          expires_at: "2026-11-06T19:00:00Z",
          permissions: { contents: "write" },
        });
      }
      return jsonResponse({
        repositories: [{ id: repository.id, full_name: repository.fullName }],
      });
    };
    await expect(
      authorizeGitHubRepository(await config(), repository.fullName, http),
    ).rejects.toThrow(/read-only policy/i);
  });
});
