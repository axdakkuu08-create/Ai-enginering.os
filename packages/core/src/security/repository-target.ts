export interface RepositoryTargetInput {
  readonly owner: string;
  readonly repository: string;
  readonly baseBranch: string;
  readonly targetBranch: string;
  /** Explicit installation allow-list, expressed as owner/repository slugs. */
  readonly allowedRepositories: readonly string[];
}

export interface ValidatedRepositoryTarget {
  readonly owner: string;
  readonly repository: string;
  readonly fullName: string;
  readonly baseBranch: string;
  readonly targetBranch: string;
}

export class InvalidRepositoryTargetError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRepositoryTargetError";
  }
}

const REPOSITORY_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;
const INVALID_BRANCH_CHARS = /[\u0000-\u0020~^:?*\\[\]]/;

function assertBranchName(branch: string, label: string): void {
  if (
    !branch ||
    branch.length > 255 ||
    INVALID_BRANCH_CHARS.test(branch) ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("//") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch
      .split("/")
      .some((part) => part.startsWith(".") || part.endsWith(".lock"))
  ) {
    throw new InvalidRepositoryTargetError(
      `${label} is not a valid Git branch name.`,
    );
  }
}

/** Validates syntax, explicit repository allow-list membership, and branch separation. */
export function validateRepositoryTarget(
  input: RepositoryTargetInput,
): ValidatedRepositoryTarget {
  const { owner, repository, baseBranch, targetBranch } = input;
  if (!REPOSITORY_SEGMENT.test(owner) || !REPOSITORY_SEGMENT.test(repository)) {
    throw new InvalidRepositoryTargetError(
      "Repository owner or name is malformed.",
    );
  }

  const fullName = `${owner}/${repository}`;
  const allowed = input.allowedRepositories.some(
    (entry) => entry.toLowerCase() === fullName.toLowerCase(),
  );
  if (!allowed) {
    throw new InvalidRepositoryTargetError(
      "Repository is not in the approved allow-list.",
    );
  }

  assertBranchName(baseBranch, "Base branch");
  assertBranchName(targetBranch, "Target branch");

  if (
    targetBranch.toLowerCase() === "main" ||
    targetBranch.toLowerCase() === "master"
  ) {
    throw new InvalidRepositoryTargetError(
      "Protected branches cannot be target branches.",
    );
  }
  if (baseBranch.toLowerCase() === targetBranch.toLowerCase()) {
    throw new InvalidRepositoryTargetError(
      "Base and target branches must be different.",
    );
  }

  return Object.freeze({
    owner,
    repository,
    fullName,
    baseBranch,
    targetBranch,
  });
}
