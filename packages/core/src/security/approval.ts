import type {
  ApprovalGate,
  ApprovalStatus,
} from "../types/index.js";

export class UnauthorizedApprovalError extends Error {
  public constructor(message = "An agent cannot approve its own requested change.") {
    super(message);
    this.name = "UnauthorizedApprovalError";
  }
}

export class StaleApprovalError extends Error {
  public constructor(message = "Approval does not match the current proposal revision.") {
    super(message);
    this.name = "StaleApprovalError";
  }
}

export interface ApprovalDecision {
  readonly status: "APPROVED" | "DENIED";
  readonly actorId: string;
  readonly actorType: "HUMAN" | "AGENT" | "SERVICE";
  readonly proposalDigest: string;
  readonly baseRevision: string;
  readonly timestamp: string;
}

/** New gates are pending and are bound to one exact proposal and base revision. */
export function createApprovalGate(input: {
  readonly id: string;
  readonly taskId: string;
  readonly proposalDigest: string;
  readonly baseRevision: string;
}): ApprovalGate {
  if (!input.id.trim() || !input.taskId.trim()) {
    throw new TypeError("Approval gate and task identifiers must be non-empty.");
  }
  if (!input.proposalDigest.trim() || !input.baseRevision.trim()) {
    throw new TypeError("Proposal digest and base revision must be non-empty.");
  }

  return Object.freeze({
    id: input.id,
    taskId: input.taskId,
    status: "PENDING" as const,
    authorizedBy: null,
    timestamp: null,
    proposalDigest: input.proposalDigest,
    baseRevision: input.baseRevision,
  });
}

/** Only an explicitly approved gate may proceed. */
export function canProceed(status: ApprovalStatus): boolean {
  return status === "APPROVED";
}

/** Rejects an agent attempting to approve a change it requested. */
export function assertNotSelfApproval(
  agentId: string,
  requestedBy: string,
): void {
  if (!agentId.trim() || !requestedBy.trim()) {
    throw new UnauthorizedApprovalError("Approval identities must be non-empty.");
  }

  if (agentId === requestedBy) {
    throw new UnauthorizedApprovalError();
  }
}

/** Only a human decision for the exact current proposal can change the gate. */
export function recordApprovalDecision(
  gate: ApprovalGate,
  decision: ApprovalDecision,
): ApprovalGate {
  if (!decision.actorId.trim()) {
    throw new UnauthorizedApprovalError("Approval identity must be non-empty.");
  }
  if (decision.actorType !== "HUMAN") {
    throw new UnauthorizedApprovalError("Only a human actor may decide an approval gate.");
  }
  if (
    decision.proposalDigest !== gate.proposalDigest ||
    decision.baseRevision !== gate.baseRevision
  ) {
    throw new StaleApprovalError();
  }
  if (!Number.isFinite(Date.parse(decision.timestamp))) {
    throw new TypeError("Approval timestamp must be a valid date.");
  }

  return Object.freeze({
    ...gate,
    status: decision.status,
    authorizedBy: decision.actorId,
    timestamp: decision.timestamp,
  });
}

/** Any proposal or base-revision change invalidates a previous decision. */
export function refreshApprovalForProposal(
  gate: ApprovalGate,
  proposalDigest: string,
  baseRevision: string,
): ApprovalGate {
  if (!proposalDigest.trim() || !baseRevision.trim()) {
    throw new TypeError("Proposal digest and base revision must be non-empty.");
  }
  if (
    gate.proposalDigest === proposalDigest &&
    gate.baseRevision === baseRevision
  ) {
    return gate;
  }

  return Object.freeze({
    ...gate,
    status: "PENDING" as const,
    authorizedBy: null,
    timestamp: null,
    proposalDigest,
    baseRevision,
  });
}

/** Re-check status and revision binding immediately before protected work. */
export function canProceedForProposal(
  gate: ApprovalGate,
  proposalDigest: string,
  baseRevision: string,
): boolean {
  return (
    gate.status === "APPROVED" &&
    gate.proposalDigest === proposalDigest &&
    gate.baseRevision === baseRevision
  );
}
