import type { ApprovalGate, ApprovalStatus } from "../types/index.js";
import {
  isValidApprovalCompareAndSet,
  type ApprovalCompareAndSet,
  type ApprovalStore,
  type StoredApprovalGate,
} from "./approval-store.js";
import {
  AUDIT_GENESIS_HASH,
  AuditIntegrityError,
  createAuditLedgerEntry,
  type AuditLedgerEntry,
  type AuditLedgerStore,
  verifyAuditLedger,
} from "./audit-ledger.js";
import type { SafeAuditEvent } from "./audit-event.js";
import type { SqlExecutor } from "./sql.js";

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("Database returned an invalid timestamp.");
  }
  return date.toISOString();
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Database returned invalid ${field}.`);
  }
  return value;
}

function asSafeVersion(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError("Database returned an invalid approval version.");
  }
  return parsed;
}

function mapApproval(row: Record<string, unknown>): StoredApprovalGate {
  const status = asString(row.status, "approval status") as ApprovalStatus;
  if (!["PENDING", "APPROVED", "DENIED", "CONSUMED"].includes(status)) {
    throw new TypeError("Database returned an unknown approval status.");
  }
  const gate: ApprovalGate = Object.freeze({
    id: asString(row.gate_id, "gate id"),
    taskId: asString(row.task_id, "task id"),
    requestedBy: asString(row.requested_by, "requester"),
    status,
    authorizedBy:
      row.authorized_by === null || row.authorized_by === undefined
        ? null
        : asString(row.authorized_by, "approver"),
    timestamp: toIso(row.decided_at),
    expiresAt: toIso(row.expires_at),
    consumedAt: toIso(row.consumed_at),
    proposalDigest: asString(row.proposal_digest, "proposal digest"),
    baseRevision: asString(row.base_revision, "base revision"),
  });
  return Object.freeze({
    gate,
    version: asSafeVersion(row.version),
  });
}

/**
 * Durable PostgreSQL adapter. The compare-and-set is a single conditional
 * UPDATE; the application must run the migration before using this adapter.
 */
export class PostgresApprovalStore implements ApprovalStore {
  public constructor(private readonly sql: SqlExecutor) {}

  public async create(gate: ApprovalGate): Promise<void> {
    if (
      gate.status !== "PENDING" ||
      gate.authorizedBy !== null ||
      gate.timestamp !== null ||
      gate.expiresAt !== null ||
      gate.consumedAt !== null
    ) {
      throw new TypeError("Only undecided pending gates may be created.");
    }
    await this.sql.query(
      `INSERT INTO aios_approval_gates
       (gate_id, task_id, requested_by, status, proposal_digest, base_revision,
        authorized_by, decided_at, expires_at, consumed_at, version)
       VALUES ($1, $2, $3, 'PENDING', $4, $5, NULL, NULL, NULL, NULL, 1)`,
      [
        gate.id,
        gate.taskId,
        gate.requestedBy,
        gate.proposalDigest,
        gate.baseRevision,
      ],
    );
  }

  public async load(gateId: string): Promise<StoredApprovalGate | null> {
    const result = await this.sql.query(
      `SELECT gate_id, task_id, requested_by, status, proposal_digest,
              base_revision, authorized_by, decided_at, expires_at,
              consumed_at, version
         FROM aios_approval_gates
        WHERE gate_id = $1`,
      [gateId],
    );
    return result.rows[0] ? mapApproval(result.rows[0]) : null;
  }

  public async compareAndSet(
    input: ApprovalCompareAndSet,
  ): Promise<boolean> {
    const allowed =
      (input.expectedStatus === "PENDING" &&
        (input.next.status === "APPROVED" ||
          input.next.status === "DENIED")) ||
      (input.expectedStatus === "APPROVED" &&
        input.next.status === "CONSUMED");
    if (!allowed || !isValidApprovalCompareAndSet(input)) {
      return false;
    }

    const result = await this.sql.query(
      `UPDATE aios_approval_gates
          SET status = $7,
              authorized_by = $8,
              decided_at = $9,
              expires_at = $10,
              consumed_at = $11,
              version = version + 1
        WHERE gate_id = $1
          AND version = $2
          AND status = $3
          AND proposal_digest = $4
          AND base_revision = $5
          AND ($3 <> 'APPROVED' OR expires_at > $6)
          AND authorized_by IS NOT DISTINCT FROM $12
          AND decided_at IS NOT DISTINCT FROM $13
          AND expires_at IS NOT DISTINCT FROM $14
       RETURNING version`,
      [
        input.gateId,
        input.expectedVersion,
        input.expectedStatus,
        input.proposalDigest,
        input.baseRevision,
        input.serverNow,
        input.next.status,
        input.next.authorizedBy,
        input.next.timestamp,
        input.next.expiresAt,
        input.next.consumedAt,
        input.expectedAuthorizedBy,
        input.expectedTimestamp,
        input.expectedExpiresAt,
      ],
    );
    return result.rows.length === 1 || result.rowCount === 1;
  }
}

/**
 * Durable append-only hash-chain adapter. It relies on a restricted DB role
 * with INSERT/SELECT only on the event table; hash chaining alone cannot stop
 * a database owner/superuser from rewriting the whole chain.
 */
export class PostgresAuditLedgerStore implements AuditLedgerStore {
  public constructor(
    private readonly sql: SqlExecutor,
    private readonly streamId = "global",
  ) {
    if (!streamId.trim()) throw new TypeError("Audit stream ID is required.");
  }

  public async append(event: SafeAuditEvent): Promise<AuditLedgerEntry> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      // Verify history on every retry. Concurrent writers may have extended
      // the chain after a competing compare-and-set succeeded.
      const existing = await this.readAll();
      const head = await this.sql.query(
        `SELECT sequence, last_hash
           FROM aios_audit_heads
          WHERE stream_id = $1`,
        [this.streamId],
      );
      const row = head.rows[0];
      if (!row) throw new Error("Audit stream head is not initialized.");
      const currentSequence = Number(row.sequence);
      const currentHash = asString(row.last_hash, "audit head hash");
      const existingHash = existing.at(-1)?.hash ?? AUDIT_GENESIS_HASH;
      if (
        !Number.isSafeInteger(currentSequence) ||
        currentSequence !== existing.length ||
        currentHash !== existingHash
      ) {
        throw new AuditIntegrityError();
      }
      const sequence = currentSequence + 1;
      const previousHash = currentHash;
      const entry = await createAuditLedgerEntry(
        sequence,
        previousHash,
        event,
      );

      const inserted = await this.sql.query(
        `WITH advanced AS (
           UPDATE aios_audit_heads
              SET sequence = $2, last_hash = $3
            WHERE stream_id = $1
              AND sequence = $4
              AND last_hash = $5
            RETURNING sequence
         )
         INSERT INTO aios_audit_events
           (stream_id, sequence, event_id, previous_hash, event_hash, event_json)
         SELECT $1, advanced.sequence, $6, $5, $3, $7::jsonb
           FROM advanced
         RETURNING sequence`,
        [
          this.streamId,
          sequence,
          entry.hash,
          sequence - 1,
          previousHash,
          event.id,
          JSON.stringify(event),
        ],
      );
      if (inserted.rows.length === 1 || inserted.rowCount === 1) {
        return entry;
      }
    }
    throw new Error("Audit append contention exceeded retry limit.");
  }

  public async readAll(): Promise<readonly AuditLedgerEntry[]> {
    const result = await this.sql.query(
      `SELECT sequence, previous_hash, event_hash, event_json
         FROM aios_audit_events
        WHERE stream_id = $1
        ORDER BY sequence ASC`,
      [this.streamId],
    );
    const entries = result.rows.map((row) => {
      const rawEvent = row.event_json;
      const event =
        typeof rawEvent === "string"
          ? (JSON.parse(rawEvent) as SafeAuditEvent)
          : (rawEvent as SafeAuditEvent);
      if (!event || typeof event.id !== "string" || !event.id.trim()) {
        throw new AuditIntegrityError();
      }
      return Object.freeze({
        sequence: asSafeVersion(row.sequence),
        previousHash: asString(row.previous_hash, "previous hash"),
        hash: asString(row.event_hash, "event hash"),
        event: Object.freeze(event),
      });
    });
    if (!(await verifyAuditLedger(entries))) {
      throw new AuditIntegrityError();
    }
    return Object.freeze(entries);
  }

  public static readonly genesisHash = AUDIT_GENESIS_HASH;
}
