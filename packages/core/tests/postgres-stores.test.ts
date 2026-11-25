import { describe, expect, it } from "vitest";
import { createSafeAuditEvent } from "../src/security/audit-event.js";
import {
  AuditIntegrityError,
  verifyAuditLedger,
} from "../src/security/audit-ledger.js";
import {
  PostgresApprovalStore,
  PostgresAuditLedgerStore,
} from "../src/security/postgres-stores.js";
import {
  createApprovalGate,
  recordApprovalDecision,
} from "../src/security/approval.js";
import type { SqlExecutor, SqlQueryResult } from "../src/security/sql.js";

const now = new Date("2026-11-18T10:00:00.000Z");

describe("PostgresApprovalStore", () => {
  it("uses one SQL compare-and-set bound to version, status, proposal, base and old decision fields", async () => {
    let statement = "";
    let values: readonly unknown[] = [];
    const sql: SqlExecutor = {
      query: async (query, params = []): Promise<SqlQueryResult> => {
        statement = query;
        values = params;
        return { rows: [{ version: 2 }], rowCount: 1 };
      },
    };
    const gate = createApprovalGate({
      id: "gate-db",
      taskId: "task-db",
      requestedBy: "agent-db",
      proposalDigest: "digest-db",
      baseRevision: "a".repeat(40),
    });
    const approved = recordApprovalDecision(
      gate,
      {
        status: "APPROVED",
        actorId: "human-db",
        actorType: "HUMAN",
        proposalDigest: "digest-db",
        baseRevision: "a".repeat(40),
      },
      now,
    );
    const store = new PostgresApprovalStore(sql);

    await expect(
      store.compareAndSet({
        gateId: "gate-db",
        expectedVersion: 1,
        expectedStatus: "PENDING",
        expectedAuthorizedBy: null,
        expectedTimestamp: null,
        expectedExpiresAt: null,
        proposalDigest: "digest-db",
        baseRevision: "a".repeat(40),
        next: approved,
        serverNow: now,
      }),
    ).resolves.toBe(true);

    expect(statement).toContain("UPDATE aios_approval_gates");
    expect(statement).toContain("version = $2");
    expect(statement).toContain("status = $3");
    expect(statement).toContain("proposal_digest = $4");
    expect(statement).toContain("base_revision = $5");
    expect(statement).toContain("authorized_by IS NOT DISTINCT FROM $12");
    expect(values[1]).toBe(1);
    expect(values[2]).toBe("PENDING");
    expect(values[11]).toBeNull();
  });

  it("maps a stored gate without trusting client-provided fields", async () => {
    const sql: SqlExecutor = {
      query: async (): Promise<SqlQueryResult> => ({
        rows: [
          {
            gate_id: "gate-db",
            task_id: "task-db",
            requested_by: "agent-db",
            status: "APPROVED",
            proposal_digest: "digest-db",
            base_revision: "a".repeat(40),
            authorized_by: "human-db",
            decided_at: now,
            expires_at: new Date(now.getTime() + 300_000),
            consumed_at: null,
            version: "2",
          },
        ],
        rowCount: 1,
      }),
    };
    const result = await new PostgresApprovalStore(sql).load("gate-db");
    expect(result?.version).toBe(2);
    expect(result?.gate.status).toBe("APPROVED");
    expect(result?.gate.authorizedBy).toBe("human-db");
    expect(result?.gate.timestamp).toBe(now.toISOString());
  });
});

describe("PostgresAuditLedgerStore", () => {
  it("appends concurrent events in sequence and verifies persisted chain", async () => {
    let sequence = 0;
    let lastHash = "0".repeat(64);
    const stored: Array<Record<string, unknown>> = [];
    const sql: SqlExecutor = {
      query: async (query, values = []): Promise<SqlQueryResult> => {
        if (query.includes("LEFT JOIN aios_audit_events")) {
          const rows = [...stored]
            .sort(
              (left, right) => Number(left.sequence) - Number(right.sequence),
            )
            .map((entry) => ({
              head_sequence: sequence,
              head_hash: lastHash,
              entry_sequence: entry.sequence,
              previous_hash: entry.previous_hash,
              event_hash: entry.event_hash,
              event_json: entry.event_json,
            }));
          return {
            rows:
              rows.length > 0
                ? rows
                : [
                    {
                      head_sequence: sequence,
                      head_hash: lastHash,
                      entry_sequence: null,
                      previous_hash: null,
                      event_hash: null,
                      event_json: null,
                    },
                  ],
            rowCount: rows.length || 1,
          };
        }
        if (query.includes("aios_append_audit_event")) {
          const [stream, nextSequence, previousHash, eventId, hash, eventJson] =
            values;
          if (
            Number(nextSequence) !== sequence + 1 ||
            previousHash !== lastHash ||
            JSON.parse(String(eventJson)).id !== eventId
          ) {
            return { rows: [{ appended: false }], rowCount: 1 };
          }
          sequence = Number(nextSequence);
          lastHash = String(hash);
          stored.push({
            sequence,
            previous_hash: previousHash,
            event_hash: hash,
            event_json: JSON.parse(String(eventJson)),
            event_id: eventId,
            stream_id: stream,
          });
          return { rows: [{ appended: true }], rowCount: 1 };
        }
        throw new Error("Unexpected SQL statement in test fixture.");
      },
    };
    const store = new PostgresAuditLedgerStore(sql);
    const makeEvent = (id: string) =>
      createSafeAuditEvent(
        {
          id,
          actorId: "human-db",
          action: "approval.record",
          target: "org/repo#2",
          outcome: "SUCCESS",
        },
        now,
      );

    await Promise.all([
      store.append(await makeEvent("event-a")),
      store.append(await makeEvent("event-b")),
    ]);
    const entries = await store.readAll();
    expect(entries.map((entry) => entry.sequence)).toEqual([1, 2]);
    await expect(verifyAuditLedger(entries)).resolves.toBe(true);

    // Removing a valid final row must fail even though the remaining prefix
    // is internally valid: the database head still commits to sequence two.
    const removedTail = stored.pop();
    await expect(store.readAll()).rejects.toThrow(AuditIntegrityError);
    if (removedTail) stored.push(removedTail);

    stored[0].event_hash = "f".repeat(64);
    await expect(store.readAll()).rejects.toThrow(AuditIntegrityError);
  });
});
