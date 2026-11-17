import type { ApprovalGate } from "../types/index.js";

export const APPROVAL_TTL_MS = 5 * 60 * 1000;

export class UnauthorizedApprovalError extends Error {
  public constructor(
    message = "An agent cannot approve its own requested change.",
  ) {
    super(message);
    this.name = "UnauthorizedApprovalError";
  }
}

export class StaleApprovalError extends Error {
  public constructor(
    message = "Approval does not match the current proposal revision or has expired.",
  ) {
    super(message);
    this.name = "StaleApprovalError";
  }
}

export class ApprovalAlreadyDecidedError extends Error {
  public constructor() {
    super(
      "An approval gate can receive only one decision for its current revision.",
    );
    this.name = "ApprovalAlreadyDecidedError";
  }
}

export interface ApprovalDecision {
  readonly status: "APPROVED" | "DENIED";
  readonly actorId: string;
  readonly actorType: "HUMAN" | "AGENT" | "SERVICE";
  readonly proposalDigest: string;
  readonly baseRevision: string;
  /** Delegation chain supplied only by the trusted identity verifier. */
  readonly delegatedActorIds?: readonly string[];
}

function normalizeIdentity(value: string): string {
  // Case-folding is intentionally conservative: opaque IDs that differ only
  // by case are treated as the same requester to fail closed on aliases.
  return value.trim().normalize("NFC").toLocaleLowerCase("en-US");
}

/** New gates are pending and are bound to one exact proposal and base revision. */
export function createApprovalGate(input: {
  readonly id: string;
  readonly taskId: string;
  readonly requestedBy: string;
  readonly proposalDigest: string;
  readonly baseRevision: string;
}): ApprovalGate {
  if (!input.id.trim() || !input.taskId.trim() || !input.requestedBy.trim()) {
    throw new TypeError(
      "Approval gate, task, and requester identifiers must be non-empty.",
    );
  }
  if (!input.proposalDigest.trim() || !input.baseRevision.trim()) {
    throw new TypeError("Proposal digest and base revision must be non-empty.");
  }

  return Object.freeze({
    id: input.id,
    taskId: input.taskId,
    requestedBy: input.requestedBy,
    status: "PENDING" as const,
    authorizedBy: null,
    timestamp: null,
    expiresAt: null,
    consumedAt: null,
    proposalDigest: input.proposalDigest,
    baseRevision: input.baseRevision,
  });
}

/**
 * Compares canonicalized opaque identity values and the verified delegation
 * chain. A case-only collision is denied rather than risking self-approval.
 */
export function assertNotSelfApproval(
  approverId: string,
  requestedBy: string,
  delegatedActorIds: readonly string[] = [],
): void {
  const normalizedApproverId = normalizeIdentity(approverId);
  const normalizedRequesterId = normalizeIdentity(requestedBy);
  if (!normalizedApproverId || !normalizedRequesterId) {
    throw new UnauthorizedApprovalError(
      "Approval identities must be non-empty.",
    );
  }

  const actorIds = delegatedActorIds.map((id) =>
    typeof id === "string" ? normalizeIdentity(id) : "",
  );
  if (actorIds.some((id) => !id)) {
    throw new UnauthorizedApprovalError(
      "The verified delegation chain is malformed.",
    );
  }
  if (
    normalizedApproverId === normalizedRequesterId ||
    actorIds.includes(normalizedRequesterId)
  ) {
    throw new UnauthorizedApprovalError();
  }
}

/** Applies a verified human decision using a server-owned clock. */
export function recordApprovalDecision(
  gate: ApprovalGate,
  decision: ApprovalDecision,
  serverNow: Date,
): ApprovalGate {
  if (gate.status !== "PENDING") {
    throw new ApprovalAlreadyDecidedError();
  }
  if (decision.status !== "APPROVED" && decision.status !== "DENIED") {
    throw new TypeError("Approval decision status is invalid.");
  }
  if (!decision.actorId.trim()) {
    throw new UnauthorizedApprovalError("Approval identity must be non-empty.");
  }
  if (decision.actorType !== "HUMAN") {
    throw new UnauthorizedApprovalError(
      "Only a human actor may decide an approval gate.",
    );
  }
  assertNotSelfApproval(
    decision.actorId,
    gate.requestedBy,
    decision.delegatedActorIds,
  );
  if (
    decision.proposalDigest !== gate.proposalDigest ||
    decision.baseRevision !== gate.baseRevision
  ) {
    throw new StaleApprovalError();
  }
  if (!(serverNow instanceof Date) || !Number.isFinite(serverNow.getTime())) {
    throw new TypeError("A valid server clock value is required.");
  }

  const timestamp = serverNow.toISOString();
  const expiresAt = new Date(
    serverNow.getTime() + APPROVAL_TTL_MS,
  ).toISOString();

  return Object.freeze({
    ...gate,
    status: decision.status,
    authorizedBy: decision.actorId,
    timestamp,
    expiresAt,
    consumedAt: null,
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
    expiresAt: null,
    consumedAt: null,
    proposalDigest,
    baseRevision,
  });
}

/** A decision is usable only before expiry and for the exact proposal. */
export function canProceedForProposal(
  gate: ApprovalGate,
  proposalDigest: string,
  baseRevision: string,
  serverNow: Date,
): boolean {
  return (
    gate.status === "APPROVED" &&
    gate.proposalDigest === proposalDigest &&
    gate.baseRevision === baseRevision &&
    gate.expiresAt !== null &&
    Number.isFinite(Date.parse(gate.expiresAt)) &&
    serverNow instanceof Date &&
    Number.isFinite(serverNow.getTime()) &&
    Date.parse(gate.expiresAt) > serverNow.getTime()
  );
}
