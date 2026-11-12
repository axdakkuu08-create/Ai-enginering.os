import type { ApprovalGate } from "../types/index.js";
import {
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

/**
 * Authoritative persistence for approval gates. Gate state is read from here
 * and written only through compareAndSet, so a decision can only be committed
 * against the exact state it was computed from.
 */
export interface ApprovalStore {
  /** Creates a new gate. Must reject duplicates and non-pending gates. */
  create(gate: ApprovalGate): Promise<void>;
  load(gateId: string): Promise<StoredApprovalGate | null>;
  /**
   * Writes `next` only if the stored version still equals `expectedVersion`.
   * Returns false if another writer changed the gate first.
   */
  compareAndSet(
    gateId: string,
    expectedVersion: number,
    next: ApprovalGate,
  ): Promise<boolean>;
}

/** Server-side time source. Callers cannot supply decision timestamps. */
export interface ApprovalClock {
  now(): Date;
}

/**
 * Reference implementation for tests and single-process use. It is not
 * durable. Production requires a database with a conditional write (for
 * example, UPDATE ... WHERE version = $expected) providing the same semantics.
 */
export class InMemoryApprovalStore implements ApprovalStore {
  private readonly gates = new Map<string, StoredApprovalGate>();

  public async create(gate: ApprovalGate): Promise<void> {
    if (
      gate.status !== "PENDING" ||
      gate.authorizedBy !== null ||
      gate.timestamp !== null
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
    gateId: string,
    expectedVersion: number,
    next: ApprovalGate,
  ): Promise<boolean> {
    const current = this.gates.get(gateId);
    if (!current || current.version !== expectedVersion) return false;
    if (next.id !== gateId) return false;
    this.gates.set(
      gateId,
      Object.freeze({ gate: next, version: current.version + 1 }),
    );
    return true;
  }
}

/**
 * Re-reads the gate from trusted storage immediately before a protected
 * operation. Returns the stored gate only if it is APPROVED for exactly this
 * proposal digest and base revision.
 */
export async function requireApprovedForProposal(
  store: ApprovalStore,
  gateId: string,
  proposalDigest: string,
  baseRevision: string,
): Promise<ApprovalGate> {
  const stored = await store.load(gateId);
  if (!stored) throw new ApprovalNotFoundError();
  if (stored.gate.status !== "APPROVED") {
    throw new UnauthorizedApprovalError("Approval gate is not approved.");
  }
  if (!canProceedForProposal(stored.gate, proposalDigest, baseRevision)) {
    throw new StaleApprovalError();
  }
  return stored.gate;
}
