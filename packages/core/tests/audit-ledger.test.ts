import { describe, expect, it } from "vitest";
import { createSafeAuditEvent } from "../src/security/audit-event.js";
import {
  InMemoryAuditLedgerStore,
  verifyAuditLedger,
} from "../src/security/audit-ledger.js";

const event = (id: string) =>
  createSafeAuditEvent(
    {
      id,
      actorId: "human-1",
      action: "approval.record",
      target: "org/repo#1",
      outcome: "SUCCESS",
      details: { message: "reviewed" },
    },
    new Date("2026-11-18T00:00:00.000Z"),
  );

describe("tamper-evident audit ledger", () => {
  it("appends sequentially and verifies the hash chain", async () => {
    const store = new InMemoryAuditLedgerStore();
    await Promise.all([store.append(event("a")), store.append(event("b"))]);
    const entries = await store.readAll();

    expect(entries.map((entry) => entry.sequence)).toEqual([1, 2]);
    expect(entries[1].previousHash).toBe(entries[0].hash);
    await expect(verifyAuditLedger(entries)).resolves.toBe(true);
  });

  it("detects event modification, reordering, and duplicate IDs", async () => {
    const store = new InMemoryAuditLedgerStore();
    await store.append(event("a"));
    await store.append(event("b"));
    const entries = await store.readAll();

    const changed = {
      ...entries[0],
      event: { ...entries[0].event, action: "approval.forged" },
    };
    await expect(verifyAuditLedger([changed, entries[1]])).resolves.toBe(false);
    await expect(verifyAuditLedger([...entries].reverse())).resolves.toBe(
      false,
    );
    await expect(
      verifyAuditLedger([
        entries[0],
        { ...entries[1], event: entries[0].event },
      ]),
    ).resolves.toBe(false);
  });
});
