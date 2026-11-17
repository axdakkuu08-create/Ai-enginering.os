import type { ApprovalGate } from "../types/index.js";
import {
  APPROVAL_TTL_MS,
  ApprovalAlreadyDecidedError,
  canProceedForProposal,
  StaleApprovalError,
  UnauthorizedApprovalError,
} from "./approval.js";

export class ApprovalNotFoundError extends Error {
  public constructor() {
    super("Approval gate was not found in the trusted store.");
    this.name = "ApprovalNotFoundError";
  }
}

export interface StoredApprovalGate {
  readonly gate: ApprovalGate;
  readonly version: number;
}

export interface ApprovalCompareAndSet {
  readonly gateId: string;
  readonly expectedVersion: number;
  readonly expectedStatus: "PENDING" | "APPROVED";
  readonly expectedAuthorizedBy: string | null;
  readonly expectedTimestamp: string | null;
  readonly expectedExpiresAt: string | null;
  readonly proposalDigest: string;
  readonly baseRevision: string;
  readonly next: ApprovalGate;
  readonly serverNow: Date;
}

/** A production adapter must implement this as one atomic conditional write. */
export interface ApprovalStore {
  create(gate: ApprovalGate): Promise<void>;
  load(gateId: string): Promise<StoredApprovalGate | null>;
  compareAndSet(input: ApprovalCompareAndSet): Promise<boolean>;
}

export interface ApprovalClock {
  now(): Date;
}

/** Validates legal state transitions and server-generated timestamps/expiry. */
export function isValidApprovalCompareAndSet(
  input: ApprovalCompareAndSet,
): boolean {
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !(input.serverNow instanceof Date) ||
    !Number.isFinite(input.serverNow.getTime()) ||
    input.next.id !== input.gateId ||
    input.next.proposalDigest !== input.proposalDigest ||
    input.next.baseRevision !== input.baseRevision
  ) {
    return false;
  }

  const now = input.serverNow.toISOString();
  if (input.expectedStatus === "PENDING") {
    const expiresAt = new Date(
      input.serverNow.getTime() + APPROVAL_TTL_MS,
    ).toISOString();
    return (
      input.expectedAuthorizedBy === null &&
      input.expectedTimestamp === null &&
      input.expectedExpiresAt === null &&
      (input.next.status === "APPROVED" || input.next.status === "DENIED") &&
      typeof input.next.authorizedBy === "string" &&
      input.next.authorizedBy.trim().length > 0 &&
      input.next.timestamp === now &&
      input.next.expiresAt === expiresAt &&
      input.next.consumedAt === null
    );
  }

  return (
    input.expectedStatus === "APPROVED" &&
    typeof input.expectedAuthorizedBy === "string" &&
    input.expectedAuthorizedBy.length > 0 &&
    typeof input.expectedTimestamp === "string" &&
    typeof input.expectedExpiresAt === "string" &&
    input.next.status === "CONSUMED" &&
    input.next.authorizedBy === input.expectedAuthorizedBy &&
    input.next.timestamp === input.expectedTimestamp &&
    input.next.expiresAt === input.expectedExpiresAt &&
    input.next.consumedAt === now &&
    Date.parse(input.expectedExpiresAt) > input.serverNow.getTime()
  );
}

/** Process-local reference implementation for tests only; not durable. */
export class InMemoryApprovalStore implements ApprovalStore {
  private readonly gates = new Map<string, StoredApprovalGate>();

  public async create(gate: ApprovalGate): Promise<void> {
    if (
      gate.status !== "PENDING" ||
      gate.authorizedBy !== null ||
      gate.timestamp !== null ||
      gate.expiresAt !== null ||
      gate.consumedAt !== null
    ) {
      throw new TypeError("New approval gates must be pending and undecided.");
    }
    if (this.gates.has(gate.id)) {
      throw new TypeError("Approval gate already exists.");
    }
    this.gates.set(gate.id, Object.freeze({ gate, version: 1 }));
  }

  public async load(gateId: string): Promise<StoredApprovalGate | null> {
    return this.gates.get(gateId) ?? null;
  }

  public async compareAndSet(input: ApprovalCompareAndSet): Promise<boolean> {
    const current = this.gates.get(input.gateId);
    if (
      !current ||
      current.version !== input.expectedVersion ||
      current.gate.status !== input.expectedStatus ||
      current.gate.authorizedBy !== input.expectedAuthorizedBy ||
      current.gate.timestamp !== input.expectedTimestamp ||
      current.gate.expiresAt !== input.expectedExpiresAt ||
      current.gate.proposalDigest !== input.proposalDigest ||
      current.gate.baseRevision !== input.baseRevision ||
      !isValidApprovalCompareAndSet(input)
    ) {
      return false;
    }

    this.gates.set(
      input.gateId,
      Object.freeze({ gate: input.next, version: current.version + 1 }),
    );
    return true;
  }
}

/** Atomically consumes a fresh approval immediately before protected work. */
export async function consumeApprovalForAction(
  store: ApprovalStore,
  gateId: string,
  proposalDigest: string,
  baseRevision: string,
  serverNow: Date,
): Promise<ApprovalGate> {
  const stored = await store.load(gateId);
  if (!stored) throw new ApprovalNotFoundError();
  if (stored.gate.status !== "APPROVED") {
    throw new UnauthorizedApprovalError("Approval is not available for use.");
  }
  if (
    !canProceedForProposal(stored.gate, proposalDigest, baseRevision, serverNow)
  ) {
    throw new StaleApprovalError();
  }

  const consumed = Object.freeze({
    ...stored.gate,
    status: "CONSUMED" as const,
    consumedAt: serverNow.toISOString(),
  });
  const committed = await store.compareAndSet({
    gateId,
    expectedVersion: stored.version,
    expectedStatus: "APPROVED",
    expectedAuthorizedBy: stored.gate.authorizedBy,
    expectedTimestamp: stored.gate.timestamp,
    expectedExpiresAt: stored.gate.expiresAt,
    proposalDigest,
    baseRevision,
    next: consumed,
    serverNow,
  });
  if (!committed) throw new ApprovalAlreadyDecidedError();
  return consumed;
}
