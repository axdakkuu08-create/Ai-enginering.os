export interface GitHubAppRepository {
  readonly id: number;
  readonly fullName: string;
}

export interface GitHubAppAuthConfig {
  /** GitHub App numeric ID, supplied by trusted server configuration. */
  readonly appId: string;
  /** Installation ID is trusted configuration, never a request parameter. */
  readonly installationId: number;
  /** PEM-encoded RSA private key. Keep this server-side and out of logs. */
  readonly privateKeyPem: string;
  /** Expected account that owns the installation. */
  readonly expectedAccountLogin: string;
  /** Explicit repository allow-list, including immutable GitHub repository IDs. */
  readonly allowedRepositories: readonly GitHubAppRepository[];
}

export interface GitHubAppHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type GitHubAppHttpClient = (
  url: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Promise<GitHubAppHttpResponse>;

export interface ScopedInstallationToken {
  /** Short-lived token. Never persist or log this value. */
  readonly token: string;
  readonly expiresAt: string;
  readonly repository: GitHubAppRepository;
  readonly permissions: Readonly<Record<string, string>>;
}

export class GitHubAppAuthorizationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GitHubAppAuthorizationError";
  }
}

const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";
const TOKEN_TTL_SECONDS = 9 * 60;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeTextBase64Url(value: string): string {
  return encodeBase64Url(new TextEncoder().encode(value));
}

function encodeDerLength(length: number): Uint8Array {
  if (length < 128) return new Uint8Array([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function wrapPkcs1AsPkcs8(pkcs1: Uint8Array): Uint8Array {
  const algorithmIdentifier = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ]);
  const octetString = new Uint8Array([
    0x04,
    ...encodeDerLength(pkcs1.length),
    ...pkcs1,
  ]);
  const body = new Uint8Array([
    0x02, 0x01, 0x00,
    ...algorithmIdentifier,
    ...octetString,
  ]);
  return new Uint8Array([0x30, ...encodeDerLength(body.length), ...body]);
}

function pemToDer(pem: string): ArrayBuffer {
  const isPkcs1 = pem.includes("-----BEGIN RSA PRIVATE KEY-----");
  const normalized = pem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new GitHubAppAuthorizationError(
      "GitHub App private key is malformed.",
    );
  }
  const binary = atob(normalized);
  const decoded = Uint8Array.from(
    binary,
    (character) => character.charCodeAt(0),
  );
  const bytes = isPkcs1 ? wrapPkcs1AsPkcs8(decoded) : decoded;
  const result = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(result).set(bytes);
  return result;
}

function validateConfig(config: GitHubAppAuthConfig): void {
  if (
    !/^\d+$/.test(config.appId) ||
    !Number.isSafeInteger(config.installationId) ||
    config.installationId <= 0
  ) {
    throw new GitHubAppAuthorizationError(
      "GitHub App and installation IDs must be valid numeric identifiers.",
    );
  }
  if (!config.expectedAccountLogin.trim() || !config.privateKeyPem.trim()) {
    throw new GitHubAppAuthorizationError(
      "GitHub App account and private-key configuration are required.",
    );
  }
  if (config.allowedRepositories.length === 0) {
    throw new GitHubAppAuthorizationError(
      "At least one explicitly authorized repository is required.",
    );
  }
  const names = new Set<string>();
  const ids = new Set<number>();
  for (const repository of config.allowedRepositories) {
    if (
      !Number.isSafeInteger(repository.id) ||
      repository.id <= 0 ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.fullName)
    ) {
      throw new GitHubAppAuthorizationError(
        "The repository allow-list contains an invalid entry.",
      );
    }
    const normalizedName = repository.fullName.toLowerCase();
    if (names.has(normalizedName) || ids.has(repository.id)) {
      throw new GitHubAppAuthorizationError(
        "The repository allow-list contains duplicate entries.",
      );
    }
    names.add(normalizedName);
    ids.add(repository.id);
  }
}

/** Creates a short-lived RS256 JWT for GitHub App authentication. */
export async function createGitHubAppJwt(
  appId: string,
  privateKeyPem: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (
    !/^\d+$/.test(appId) ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds <= 0
  ) {
    throw new GitHubAppAuthorizationError("GitHub App JWT claims are invalid.");
  }
  const header = encodeTextBase64Url(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  );
  const payload = encodeTextBase64Url(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + TOKEN_TTL_SECONDS,
      iss: appId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemToDer(privateKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new GitHubAppAuthorizationError(
      "GitHub App private key could not be imported.",
    );
  }
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

async function requestJson(
  http: GitHubAppHttpClient,
  url: string,
  method: "GET" | "POST",
  authorization: string,
  body?: string,
): Promise<Record<string, unknown>> {
  let response: GitHubAppHttpResponse;
  try {
    response = await http(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: authorization,
        "X-GitHub-Api-Version": API_VERSION,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
    });
  } catch {
    throw new GitHubAppAuthorizationError(
      "GitHub App authorization request failed.",
    );
  }
  if (!response.ok) {
    throw new GitHubAppAuthorizationError(
      `GitHub App authorization was rejected (HTTP ${response.status}).`,
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new GitHubAppAuthorizationError(
      "GitHub returned an unreadable authorization response.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GitHubAppAuthorizationError(
      "GitHub returned an invalid authorization response.",
    );
  }
  return value as Record<string, unknown>;
}

/**
 * Mints a single-repository installation token.
 *
 * All identity, installation, and repository constraints come from trusted
 * server configuration. The caller can select only an allow-listed slug;
 * it cannot supply an installation ID, repository ID, or permissions.
 */
export async function authorizeGitHubRepository(
  config: GitHubAppAuthConfig,
  requestedFullName: string,
  http: GitHubAppHttpClient,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<ScopedInstallationToken> {
  validateConfig(config);
  if (!requestedFullName.trim()) {
    throw new GitHubAppAuthorizationError("A repository target is required.");
  }
  const repository = config.allowedRepositories.find(
    (entry) => entry.fullName.toLowerCase() === requestedFullName.toLowerCase(),
  );
  if (!repository) {
    throw new GitHubAppAuthorizationError(
      "Repository is not in the server-side allow-list.",
    );
  }

  const appJwt = await createGitHubAppJwt(
    config.appId,
    config.privateKeyPem,
    nowSeconds,
  );
  const installation = await requestJson(
    http,
    `${API_BASE}/app/installations/${config.installationId}`,
    "GET",
    `Bearer ${appJwt}`,
  );
  const account = installation.account as Record<string, unknown> | undefined;
  if (
    installation.id !== config.installationId ||
    account?.login !== config.expectedAccountLogin
  ) {
    throw new GitHubAppAuthorizationError(
      "GitHub App installation identity did not match trusted configuration.",
    );
  }

  const tokenResponse = await requestJson(
    http,
    `${API_BASE}/app/installations/${config.installationId}/access_tokens`,
    "POST",
    `Bearer ${appJwt}`,
    JSON.stringify({
      repository_ids: [repository.id],
      permissions: { contents: "read" },
    }),
  );
  if (
    typeof tokenResponse.token !== "string" ||
    !tokenResponse.token ||
    typeof tokenResponse.expires_at !== "string" ||
    !Number.isFinite(Date.parse(tokenResponse.expires_at))
  ) {
    throw new GitHubAppAuthorizationError(
      "GitHub did not return a valid short-lived installation token.",
    );
  }

  const permissions = tokenResponse.permissions;
  if (
    !permissions ||
    typeof permissions !== "object" ||
    Array.isArray(permissions) ||
    (permissions as Record<string, unknown>).contents !== "read" ||
    Object.values(permissions as Record<string, unknown>).some(
      (value) => value !== "read",
    )
  ) {
    throw new GitHubAppAuthorizationError(
      "Installation token permissions exceed the read-only policy.",
    );
  }

  const accessible = await requestJson(
    http,
    `${API_BASE}/installation/repositories?per_page=100`,
    "GET",
    `Bearer ${tokenResponse.token}`,
  );
  const repositories = accessible.repositories;
  if (
    accessible.total_count !== 1 ||
    !Array.isArray(repositories) ||
    repositories.length !== 1
  ) {
    throw new GitHubAppAuthorizationError(
      "Installation token is not restricted to exactly one repository.",
    );
  }
  const granted = repositories[0] as Record<string, unknown>;
  if (
    granted.id !== repository.id ||
    typeof granted.full_name !== "string" ||
    granted.full_name.toLowerCase() !== repository.fullName.toLowerCase()
  ) {
    throw new GitHubAppAuthorizationError(
      "Installation token repository scope does not match the requested repository.",
    );
  }

  return Object.freeze({
    token: tokenResponse.token,
    expiresAt: tokenResponse.expires_at,
    repository: Object.freeze({ ...repository }),
    permissions: Object.freeze({ ...(permissions as Record<string, string>) }),
  });
}
