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
 * Records a human decision on a stored approval gate.
 *
 * Provenance: the actor is the verified subject only. Any extra fields a
 * caller sends (actorId, actorType, timestamp, gate) are ignored.
 * State: the gate is read from the trusted store and the decision is written
 * with compare-and-set against the version that was read.
 */
export async function authorizeHumanApproval(
  request: HumanApprovalRequest,
  dependencies: HumanApprovalDependencies,
): Promise<ApprovalGate> {
  const { verifier, store, clock } = dependencies;

  if (typeof request.gateId !== "string" || !request.gateId.trim()) {
    throw new TypeError("Approval gate identifier must be non-empty.");
  }
  if (request.status !== "APPROVED" && request.status !== "DENIED") {
    throw new TypeError("Approval status must be APPROVED or DENIED.");
  }

  let identity: Awaited<ReturnType<HumanIdentityVerifier["verifyCredential"]>>;
  try {
    identity = await verifier.verifyCredential(request.credential);
  } catch {
    throw new UnauthorizedApprovalError("Human identity verification failed.");
  }

  if (
    !identity ||
    !identity.subjectId.trim() ||
    !identity.permissions.includes(APPROVAL_PERMISSION)
  ) {
    throw new UnauthorizedApprovalError(
      "Authenticated identity lacks approval permission.",
    );
  }

  const stored = await store.load(request.gateId);
  if (!stored) throw new ApprovalNotFoundError();

  // Throws before any write for self-approval, stale proposal, or a gate
  // that is already decided.
  const next = recordApprovalDecision(stored.gate, {
    status: request.status,
    actorId: identity.subjectId,
    actorType: "HUMAN",
    proposalDigest: request.proposalDigest,
    baseRevision: request.baseRevision,
    timestamp: clock.now().toISOString(),
  });

  const committed = await store.compareAndSet(
    request.gateId,
    stored.version,
    next,
  );
  if (!committed) throw new ApprovalAlreadyDecidedError();

  return next;
}
