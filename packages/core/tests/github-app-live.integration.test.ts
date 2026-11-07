import { describe, expect, it } from "vitest";
import {
  authorizeGitHubRepository,
  type GitHubAppAuthConfig,
  type GitHubAppHttpClient,
} from "../src/security/github-app-authorization.js";

declare const process: {
  readonly env: Readonly<Record<string, string | undefined>>;
};

const env = process.env;
const liveConfigRequested = Boolean(
  env.GH_APP_ID ||
    env.GH_APP_INSTALLATION_ID ||
    env.GH_APP_PRIVATE_KEY ||
    env.GH_APP_ACCOUNT_LOGIN ||
    env.GH_APP_REPOSITORY ||
    env.GH_APP_REPOSITORY_ID,
);

function readLiveConfig(): GitHubAppAuthConfig {
  const appId = env.GH_APP_ID ?? "";
  const installationId = Number(env.GH_APP_INSTALLATION_ID);
  const privateKeyPem = env.GH_APP_PRIVATE_KEY ?? "";
  const expectedAccountLogin = env.GH_APP_ACCOUNT_LOGIN ?? "";
  const fullName = env.GH_APP_REPOSITORY ?? "";
  const repositoryId = Number(env.GH_APP_REPOSITORY_ID);

  if (
    !/^\d+$/.test(appId) ||
    !Number.isSafeInteger(installationId) ||
    installationId <= 0 ||
    !privateKeyPem.trim() ||
    !expectedAccountLogin.trim() ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName) ||
    !Number.isSafeInteger(repositoryId) ||
    repositoryId <= 0
  ) {
    throw new Error(
      "Live GitHub App verification configuration is incomplete or invalid.",
    );
  }

  return {
    appId,
    installationId,
    privateKeyPem,
    expectedAccountLogin,
    allowedRepositories: [{ id: repositoryId, fullName }],
  };
}

const liveHttp: GitHubAppHttpClient = async (url, init) =>
  fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body ? { body: init.body } : {}),
  });

describe.skipIf(!liveConfigRequested)("live GitHub App installation verification", () => {
  it("authenticates the configured installation and verifies a single read-only repository token", async () => {
    const config = readLiveConfig();
    const requestedRepository = config.allowedRepositories[0];

    if (!requestedRepository) {
      throw new Error("A live repository allow-list entry is required.");
    }

    const result = await authorizeGitHubRepository(
      config,
      requestedRepository.fullName,
      liveHttp,
    );

    expect(result.repository).toEqual(requestedRepository);
    expect(result.permissions.contents).toBe("read");
    expect(Object.values(result.permissions).every((value) => value === "read")).toBe(
      true,
    );
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
  });
});
