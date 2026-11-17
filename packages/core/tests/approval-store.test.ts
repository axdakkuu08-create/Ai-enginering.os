import { describe, expect, it } from "vitest";
import {
  createApprovalGate,
  recordApprovalDecision,
  UnauthorizedApprovalError,
} from "../src/security/approval.js";
import {
  ApprovalNotFoundError,
  consumeApprovalForAction,
  InMemoryApprovalStore,
} from "../src/security/approval-store.js";

const now = new Date("2026-11-06T10:00:00.000Z");
const gateInput = {
  id: "gate-s",
  taskId: "task-s",
  requestedBy: "agent-1",
  proposalDigest: "proposal-1",
  baseRevision: "base-1",
};

describe("InMemoryApprovalStore", () => {
  it("rejects creating a gate that is already decided", async () => {
    const decided = recordApprovalDecision(
      createApprovalGate(gateInput),
      {
        status: "APPROVED",
        actorId: "human-1",
        actorType: "HUMAN",
        proposalDigest: "proposal-1",
        baseRevision: "base-1",
      },
      now,
    );
    await expect(new InMemoryApprovalStore().create(decided)).rejects.toThrow(
      TypeError,
    );
  });

  it("rejects duplicate gate identifiers", async () => {
    const store = new InMemoryApprovalStore();
    await store.create(createApprovalGate(gateInput));
    await expect(store.create(createApprovalGate(gateInput))).rejects.toThrow(
      TypeError,
    );
  });

  it("uses version, status and revision in atomic compare-and-set", async () => {
    const store = new InMemoryApprovalStore();
    await store.create(createApprovalGate(gateInput));
    const current = await store.load("gate-s");
    expect(current?.version).toBe(1);
    const next = recordApprovalDecision(
      current!.gate,
      {
        status: "DENIED",
        actorId: "human-1",
        actorType: "HUMAN",
        proposalDigest: "proposal-1",
        baseRevision: "base-1",
      },
      now,
    );

    expect(
      await store.compareAndSet({
        gateId: "gate-s",
        expectedVersion: 99,
        expectedStatus: "PENDING",
        expectedAuthorizedBy: null,
        expectedTimestamp: null,
        expectedExpiresAt: null,
        proposalDigest: "proposal-1",
        baseRevision: "base-1",
        next,
        serverNow: now,
      }),
    ).toBe(false);
    expect((await store.load("gate-s"))?.gate.status).toBe("PENDING");

    expect(
      await store.compareAndSet({
        gateId: "gate-s",
        expectedVersion: 1,
        expectedStatus: "PENDING",
        expectedAuthorizedBy: null,
        expectedTimestamp: null,
        expectedExpiresAt: null,
        proposalDigest: "proposal-1",
        baseRevision: "base-1",
        next,
        serverNow: now,
      }),
    ).toBe(true);
    expect((await store.load("gate-s"))?.version).toBe(2);
  });

  it("refuses a compare-and-set that writes another gate id", async () => {
    const store = new InMemoryApprovalStore();
    await store.create(createApprovalGate(gateInput));
    const other = createApprovalGate({ ...gateInput, id: "gate-other" });
    expect(
      await store.compareAndSet({
        gateId: "gate-s",
        expectedVersion: 1,
        expectedStatus: "PENDING",
        expectedAuthorizedBy: null,
        expectedTimestamp: null,
        expectedExpiresAt: null,
        proposalDigest: "proposal-1",
        baseRevision: "base-1",
        next: other,
        serverNow: now,
      }),
    ).toBe(false);
  });
});

describe("one-time protected-action approval", () => {
  async function approvedStore() {
    const store = new InMemoryApprovalStore();
    await store.create(createApprovalGate(gateInput));
    const current = await store.load("gate-s");
    const approved = recordApprovalDecision(
      current!.gate,
      {
        status: "APPROVED",
        actorId: "human-1",
        actorType: "HUMAN",
        proposalDigest: "proposal-1",
        baseRevision: "base-1",
      },
      now,
    );
    await store.compareAndSet({
      gateId: "gate-s",
      expectedVersion: 1,
      expectedStatus: "PENDING",
      expectedAuthorizedBy: null,
      expectedTimestamp: null,
      expectedExpiresAt: null,
      proposalDigest: "proposal-1",
      baseRevision: "base-1",
      next: approved,
      serverNow: now,
    });
    return store;
  }

  it("atomically consumes a fresh exact-revision approval once", async () => {
    const store = await approvedStore();
    const consumed = await consumeApprovalForAction(
      store,
      "gate-s",
      "proposal-1",
      "base-1",
      new Date("2026-11-06T10:01:00.000Z"),
    );
    expect(consumed.status).toBe("CONSUMED");
    expect(consumed.consumedAt).toBe("2026-11-06T10:01:00.000Z");
    await expect(
      consumeApprovalForAction(
        store,
        "gate-s",
        "proposal-1",
        "base-1",
        new Date("2026-11-06T10:02:00.000Z"),
      ),
    ).rejects.toThrow(UnauthorizedApprovalError);
  });

  it("rejects expired approvals", async () => {
    const store = await approvedStore();
    await expect(
      consumeApprovalForAction(
        store,
        "gate-s",
        "proposal-1",
        "base-1",
        new Date("2026-11-06T10:05:00.000Z"),
      ),
    ).rejects.toThrow();
  });

  it("rejects an unknown gate", async () => {
    await expect(
      consumeApprovalForAction(
        new InMemoryApprovalStore(),
        "missing",
        "proposal-1",
        "base-1",
        now,
      ),
    ).rejects.toThrow(ApprovalNotFoundError);
  });

  it("rejects a concurrent second consumption", async () => {
    const store = await approvedStore();
    const results = await Promise.allSettled([
      consumeApprovalForAction(store, "gate-s", "proposal-1", "base-1", now),
      consumeApprovalForAction(store, "gate-s", "proposal-1", "base-1", now),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const stored = await store.load("gate-s");
    expect(stored?.version).toBe(3);
    expect(stored?.gate.status).toBe("CONSUMED");
    expect(stored?.gate.authorizedBy).toBe("human-1");
  });
});
