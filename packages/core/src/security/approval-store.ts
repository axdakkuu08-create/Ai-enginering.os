import type { ApprovalGate, ApprovalStatus } from "../types/index.js";
import {
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
  /** Store-maintained version, incremented on every successful write. */
  readonly version: number;
}

export interface ApprovalCompareAndSet {
  readonly gateId: string;
  readonly expectedVersion: number;
  readonly expectedStatus: "PENDING" | "APPROVED";
  readonly proposalDigest: string;
  readonly baseRevision: string;
  readonly next: ApprovalGate;
  readonly serverNow: Date;
}

/**
 * Production adapters must implement compareAndSet as one atomic database
 * conditional write. A read followed by an unconditional write is not valid.
 */
export interface ApprovalStore {
  create(gate: ApprovalGate): Promise<void>;
  load(gateId: string): Promise<StoredApprovalGate | null>;
  compareAndSet(input: ApprovalCompareAndSet): Promise<boolean>;
}

/** Server-side time source. Callers cannot supply decision timestamps. */
export interface ApprovalClock {
  now(): Date;
}

/**
 * Test/reference implementation only. It is process-local and not durable.
 * Production must use PostgresApprovalStore or an equivalent durable CAS store.
 */
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

  public async compareAndSet(
    input: ApprovalCompareAndSet,
  ): Promise<boolean> {
    const current = this.gates.get(input.gateId);
    if (
      !current ||
      current.version !== input.expectedVersion ||
      current.gate.status !== input.expectedStatus ||
      current.gate.proposalDigest !== input.proposalDigest ||
      current.gate.baseRevision !== input.baseRevision ||
      input.next.id !== input.gateId
    ) {
      return false;
    }

    const allowedTransition =
      (input.expectedStatus === "PENDING" &&
        (input.next.status === "APPROVED" || input.next.status === "DENIED")) ||
      (input.expectedStatus === "APPROVED" &&
        input.next.status === "CONSUMED");
    if (!allowedTransition) return false;

    if (
      input.expectedStatus === "APPROVED" &&
      (!current.gate.expiresAt ||
        Date.parse(current.gate.expiresAt) <= input.serverNow.getTime())
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

/**
 * Atomically consumes a still-fresh approval immediately before the protected
 * action. The same human decision cannot authorize a second action or replay.
 */
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
    !canProceedForProposal(
      stored.gate,
      proposalDigest,
      baseRevision,
      serverNow,
    )
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
    proposalDigest,
    baseRevision,
    next: consumed,
    serverNow,
  });
  if (!committed) throw new ApprovalAlreadyDecidedError();
  return consumed;
}
