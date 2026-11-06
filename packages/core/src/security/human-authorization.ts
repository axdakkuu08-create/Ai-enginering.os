import {
  recordApprovalDecision,
  UnauthorizedApprovalError,
} from "./approval.js";
import type { ApprovalGate } from "../types/index.js";

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

export interface HumanApprovalRequest {
  readonly gate: ApprovalGate;
  readonly credential: unknown;
  readonly status: "APPROVED" | "DENIED";
  readonly proposalDigest: string;
  readonly baseRevision: string;
  readonly timestamp: string;
}

/**
 * Authenticates through the injected trusted verifier, derives the actor from
 * its verified result, checks server-resolved approval permission, and then
 * applies the proposal-bound approval policy. No actor ID/type is accepted
 * from the approval request itself.
 */
export async function authorizeHumanApproval(
  request: HumanApprovalRequest,
  verifier: HumanIdentityVerifier,
): Promise<ApprovalGate> {
  let identity: VerifiedHumanIdentity | null;
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

  return recordApprovalDecision(request.gate, {
    status: request.status,
    actorId: identity.subjectId,
    actorType: "HUMAN",
    proposalDigest: request.proposalDigest,
    baseRevision: request.baseRevision,
    timestamp: request.timestamp,
  });
}
