import type { AuthorizationRequest } from "../permissions/types.js";
import type { PermissionEngine } from "../permissions/engine.js";
import {
  ApprovalNotFoundError,
  consumeApprovalForAction,
  type ApprovalClock,
  type ApprovalStore,
} from "./approval-store.js";

export type ProtectedAction = "branch.write" | "pr.write";

export interface ProtectedActionProposal {
  readonly action: ProtectedAction;
  readonly repository: string;
  readonly targetBranch: string;
  readonly baseRevision: string;
  readonly headRevision: string;
  readonly diffDigest: string;
}

export interface ProtectedActionProposalResolver {
  /** Must load current state from a trusted provider API, never request JSON. */
  resolveCurrent(gateId: string): Promise<ProtectedActionProposal | null>;
}

export class ProtectedActionChangedError extends Error {
  public constructor() {
    super("The protected-action proposal changed during authorization.");
    this.name = "ProtectedActionChangedError";
  }
}

export class ProtectedActionDeniedError extends Error {
  public constructor(reason: string) {
    super(`Protected action denied by policy: ${reason}`);
    this.name = "ProtectedActionDeniedError";
  }
}

function validateProposal(
  proposal: ProtectedActionProposal,
): ProtectedActionProposal {
  if (
    !proposal ||
    !["branch.write", "pr.write"].includes(proposal.action) ||
    !/^[^/\s]+\/[^/\s]+$/.test(proposal.repository) ||
    !proposal.targetBranch.trim() ||
    !/^[0-9a-f]{40}$/i.test(proposal.baseRevision) ||
    !/^[0-9a-f]{40}$/i.test(proposal.headRevision) ||
    !/^[0-9a-f]{64}$/i.test(proposal.diffDigest)
  ) {
    throw new TypeError("Protected-action proposal is malformed.");
  }
  return Object.freeze({
    ...proposal,
    repository: proposal.repository.toLowerCase(),
    baseRevision: proposal.baseRevision.toLowerCase(),
    headRevision: proposal.headRevision.toLowerCase(),
    diffDigest: proposal.diffDigest.toLowerCase(),
  });
}

/** SHA-256 over the complete protected action and exact proposed revision. */
export async function digestProtectedActionProposal(
  input: ProtectedActionProposal,
): Promise<string> {
  const proposal = validateProposal(input);
  const canonical = JSON.stringify([
    1,
    proposal.action,
    proposal.repository,
    proposal.targetBranch,
    proposal.baseRevision,
    proposal.headRevision,
    proposal.diffDigest,
  ]);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export interface ProtectedActionActor {
  /** Must be derived server-side from the authenticated service/agent context. */
  readonly actorId: string;
  readonly actorType: AuthorizationRequest["actorType"];
  readonly parentAgentId?: string;
}

export interface ProtectedActionDependencies {
  readonly approvalStore: ApprovalStore;
  readonly permissionEngine: PermissionEngine;
  readonly proposalResolver: ProtectedActionProposalResolver;
  readonly clock: ApprovalClock;
}

/**
 * Reference execution gate for server-side branch/PR handlers.
 *
 * It re-fetches provider state before committing the one-use approval. The
 * callback must be a server-owned provider mutator and must use the supplied
 * immutable proposal. This class is not itself a GitHub API mutator.
 */
export class ProtectedActionGateway {
  public constructor(
    private readonly dependencies: ProtectedActionDependencies,
  ) {}

  public async execute<T>(
    gateId: string,
    actor: ProtectedActionActor,
    perform: (proposal: ProtectedActionProposal) => Promise<T>,
  ): Promise<T> {
    const { approvalStore, permissionEngine, proposalResolver, clock } =
      this.dependencies;
    const initialRaw = await proposalResolver.resolveCurrent(gateId);
    if (!initialRaw) throw new ApprovalNotFoundError();
    const initial = validateProposal(initialRaw);
    const proposalDigest = await digestProtectedActionProposal(initial);

    const decision = permissionEngine.evaluate({
      actorId: actor.actorId,
      actorType: actor.actorType,
      capability: initial.action,
      repository: initial.repository,
      branch: initial.targetBranch,
      commitSha: initial.baseRevision,
      ...(actor.parentAgentId ? { parentAgentId: actor.parentAgentId } : {}),
    });
    if (!decision.allowed) {
      throw new ProtectedActionDeniedError(decision.reason);
    }

    // Re-read the authoritative provider state immediately before consuming
    // the approval. Any base/head/diff/target/action change requires new review.
    const currentRaw = await proposalResolver.resolveCurrent(gateId);
    if (!currentRaw) throw new ProtectedActionChangedError();
    const current = validateProposal(currentRaw);
    const currentDigest = await digestProtectedActionProposal(current);
    if (currentDigest !== proposalDigest) {
      throw new ProtectedActionChangedError();
    }

    await consumeApprovalForAction(
      approvalStore,
      gateId,
      proposalDigest,
      current.baseRevision,
      clock.now(),
    );

    // If this fails, the approval intentionally stays consumed. The caller
    // must obtain a fresh human decision rather than replaying an old grant.
    return perform(current);
  }
}
