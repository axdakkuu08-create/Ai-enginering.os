import {
  ApprovalAlreadyDecidedError,
  recordApprovalDecision,
  UnauthorizedApprovalError,
} from "./approval.js";
import type { ApprovalGate } from "../types/index.js";
import {
  ApprovalNotFoundError,
  type ApprovalClock,
  type ApprovalStore,
} from "./approval-store.js";

export const APPROVAL_PERMISSION = "approval:write";

export interface VerifiedHumanIdentity {
  /** Stable subject identifier from the trusted identity provider. */
  readonly subjectId: string;
  /** Server-resolved permissions; never copied from client request fields. */
  readonly permissions: readonly string[];
  /** Verified OAuth actor-chain subjects, when the IdP supplies them. */
  readonly delegatedActorIds?: readonly string[];
}

/**
 * Implement this interface only in a trusted server-side authentication
 * adapter. Never accept a verifier implementation or identity object from a
 * browser/client request.
 */
export interface HumanIdentityVerifier {
  verifyCredential(credential: unknown): Promise<VerifiedHumanIdentity | null>;
}

/**
 * Caller-supplied input. It deliberately has no actor ID, actor type,
 * timestamp or gate state: those are derived by the server.
 */
export interface HumanApprovalRequest {
  readonly gateId: string;
  readonly credential: unknown;
  readonly status: "APPROVED" | "DENIED";
  readonly proposalDigest: string;
  readonly baseRevision: string;
}

export interface HumanApprovalDependencies {
  readonly verifier: HumanIdentityVerifier;
  readonly store: ApprovalStore;
  readonly clock: ApprovalClock;
}

/**
 * Records a human decision on a gate loaded from trusted storage.
 * Server time, verified identity and atomic persistence are dependencies
 * owned by the server composition root, not by request JSON.
 */
export async function authorizeHumanApproval(
  request: HumanApprovalRequest,
  dependencies: HumanApprovalDependencies,
): Promise<ApprovalGate> {
  const { verifier, store, clock } = dependencies;

  if (
    !request ||
    typeof request.gateId !== "string" ||
    !request.gateId.trim()
  ) {
    throw new TypeError("Approval gate identifier must be non-empty.");
  }
  if (request.status !== "APPROVED" && request.status !== "DENIED") {
    throw new TypeError("Approval status must be APPROVED or DENIED.");
  }
  if (
    typeof request.proposalDigest !== "string" ||
    !request.proposalDigest.trim() ||
    typeof request.baseRevision !== "string" ||
    !request.baseRevision.trim()
  ) {
    throw new TypeError("Proposal digest and base revision are required.");
  }

  let identity;
  try {
    identity = await verifier.verifyCredential(request.credential);
  } catch {
    throw new UnauthorizedApprovalError("Human identity verification failed.");
  }

  if (
    !identity ||
    typeof identity.subjectId !== "string" ||
    !identity.subjectId.trim() ||
    !Array.isArray(identity.permissions) ||
    !identity.permissions.includes(APPROVAL_PERMISSION) ||
    (identity.delegatedActorIds !== undefined &&
      (!Array.isArray(identity.delegatedActorIds) ||
        !identity.delegatedActorIds.every(
          (id) => typeof id === "string" && id.trim().length > 0,
        )))
  ) {
    throw new UnauthorizedApprovalError(
      "Authenticated identity lacks approval permission or valid identity claims.",
    );
  }

  const stored = await store.load(request.gateId);
  if (!stored) throw new ApprovalNotFoundError();

  const serverNow = clock.now();
  const next = recordApprovalDecision(
    stored.gate,
    {
      status: request.status,
      actorId: identity.subjectId,
      actorType: "HUMAN",
      proposalDigest: request.proposalDigest,
      baseRevision: request.baseRevision,
      delegatedActorIds: identity.delegatedActorIds,
    },
    serverNow,
  );

  const committed = await store.compareAndSet({
    gateId: request.gateId,
    expectedVersion: stored.version,
    expectedStatus: "PENDING",
    proposalDigest: request.proposalDigest,
    baseRevision: request.baseRevision,
    next,
    serverNow,
  });
  if (!committed) throw new ApprovalAlreadyDecidedError();

  return next;
}
