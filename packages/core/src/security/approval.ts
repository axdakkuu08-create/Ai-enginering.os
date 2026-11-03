import type { ApprovalGate, ApprovalStatus } from "../types/index.js";

export class UnauthorizedApprovalError extends Error {
  public constructor(message = "An agent cannot approve its own requested change.") {
    super(message);
    this.name = "UnauthorizedApprovalError";
  }
}

/** New gates always begin pending and therefore cannot authorize execution. */
export function createApprovalGate(input: {
  readonly id: string;
  readonly taskId: string;
}): ApprovalGate {
  return Object.freeze({
    id: input.id,
    taskId: input.taskId,
    status: "PENDING" as const,
    authorizedBy: null,
    timestamp: null,
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
