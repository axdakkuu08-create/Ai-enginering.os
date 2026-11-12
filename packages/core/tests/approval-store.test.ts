import { describe, expect, it } from "vitest";
import {
  createApprovalGate,
  recordApprovalDecision,
  UnauthorizedApprovalError,
} from "../src/security/approval.js";
import {
  ApprovalNotFoundError,
  InMemoryApprovalStore,
  requireApprovedForProposal,
} from "../src/security/approval-store.js";

const gateInput = {
  id: "gate-s",
  taskId: "task-s",
  requestedBy: "agent-1",
  proposalDigest: "proposal-1",
  baseRevision: "base-1",
};

describe("InMemoryApprovalStore", () => {
  it("rejects creating a gate that is already decided", async () => {
    const decided = recordApprovalDecision(createApprovalGate(gateInput), {
      status: "APPROVED",
      actorId: "human-1",
      actorType: "HUMAN",
      proposalDigest: "proposal-1",
      baseRevision: "base-1",
      timestamp: "2026-11-06T00:00:00.000Z",
    });
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

  it("refuses a compare-and-set against a stale version", async () => {
    const store = new InMemoryApprovalStore();
    await store.create(createApprovalGate(gateInput));
    const current = await store.load("gate-s");
    expect(current?.version).toBe(1);

    const next = recordApprovalDecision(current!.gate, {
      status: "DENIED",
      actorId: "human-1",
      actorType: "HUMAN",
      proposalDigest: "proposal-1",
      baseRevision: "base-1",
      timestamp: "2026-11-06T00:00:00.000Z",
    });

    expect(await store.compareAndSet("gate-s", 99, next)).toBe(false);
    expect((await store.load("gate-s"))?.gate.status).toBe("PENDING");
    expect(await store.compareAndSet("gate-s", 1, next)).toBe(true);
    expect((await store.load("gate-s"))?.version).toBe(2);
  });

  it("refuses a compare-and-set that would write a different gate id", async () => {
    const store = new InMemoryApprovalStore();
    await store.create(createApprovalGate(gateInput));
    const other = createApprovalGate({ ...gateInput, id: "gate-other" });
    expect(await store.compareAndSet("gate-s", 1, other)).toBe(false);
  });
});

describe("requireApprovedForProposal", () => {
  it("rejects a pending gate", async () => {
    const store = new InMemoryApprovalStore();
    await store.create(createApprovalGate(gateInput));
    await expect(
      requireApprovedForProposal(store, "gate-s", "proposal-1", "base-1"),
    ).rejects.toThrow(UnauthorizedApprovalError);
  });

  it("rejects an unknown gate", async () => {
    await expect(
      requireApprovedForProposal(
        new InMemoryApprovalStore(),
        "missing",
        "proposal-1",
        "base-1",
      ),
    ).rejects.toThrow(ApprovalNotFoundError);
  });
});
