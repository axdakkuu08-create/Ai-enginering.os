import { describe, expect, it } from "vitest";
import {
  APPROVAL_PERMISSION,
  authorizeHumanApproval,
  type HumanApprovalDependencies,
  type HumanApprovalRequest,
  type HumanIdentityVerifier,
} from "../src/security/human-authorization.js";
import {
  createApprovalGate,
  StaleApprovalError,
  UnauthorizedApprovalError,
} from "../src/security/approval.js";
import {
  ApprovalNotFoundError,
  consumeApprovalForAction,
  InMemoryApprovalStore,
  type ApprovalClock,
} from "../src/security/approval-store.js";

const SERVER_TIME = "2026-11-06T00:00:00.000Z";
const fixedClock = (iso: string): ApprovalClock => ({
  now: () => new Date(iso),
});
const gateInput = {
  id: "gate-1",
  taskId: "task-1",
  requestedBy: "agent-1",
  proposalDigest: "proposal-1",
  baseRevision: "base-1",
};

async function setup(
  subjectId: string | null,
  permissions: readonly string[] = [APPROVAL_PERMISSION],
  delegatedActorIds?: readonly string[],
): Promise<{ store: InMemoryApprovalStore; deps: HumanApprovalDependencies }> {
  const store = new InMemoryApprovalStore();
  await store.create(createApprovalGate(gateInput));
  const verifier: HumanIdentityVerifier = {
    verifyCredential: async () =>
      subjectId === null ? null : { subjectId, permissions, delegatedActorIds },
  };
  return {
    store,
    deps: { verifier, store, clock: fixedClock(SERVER_TIME) },
  };
}

const request = (
  overrides: Partial<HumanApprovalRequest> = {},
): HumanApprovalRequest => ({
  gateId: "gate-1",
  credential: "opaque-session-credential",
  status: "APPROVED",
  proposalDigest: "proposal-1",
  baseRevision: "base-1",
  ...overrides,
});

describe("trusted human approval boundary", () => {
  it("derives the approver and timestamp from trusted dependencies", async () => {
    const { store, deps } = await setup("human-7");
    const result = await authorizeHumanApproval(request(), deps);
    expect(result.status).toBe("APPROVED");
    expect(result.authorizedBy).toBe("human-7");
    expect(result.timestamp).toBe(SERVER_TIME);
    expect(result.expiresAt).toBe("2026-11-06T00:05:00.000Z");
    expect((await store.load("gate-1"))?.version).toBe(2);
  });

  it("ignores forged actor, timestamp, and gate fields in request data", async () => {
    const { store, deps } = await setup("human-7");
    const forged = {
      ...request(),
      actorId: "admin-forged",
      actorType: "SERVICE",
      timestamp: "2000-01-01T00:00:00.000Z",
      gate: { status: "APPROVED", authorizedBy: "admin-forged" },
    } as unknown as HumanApprovalRequest;
    const result = await authorizeHumanApproval(forged, deps);
    expect(result.authorizedBy).toBe("human-7");
    expect(result.timestamp).toBe(SERVER_TIME);
    expect((await store.load("gate-1"))?.gate.authorizedBy).toBe("human-7");
  });

  it("fails closed on invalid credentials and leaves state unchanged", async () => {
    const { store, deps } = await setup(null);
    await expect(authorizeHumanApproval(request(), deps)).rejects.toThrow(
      UnauthorizedApprovalError,
    );
    expect((await store.load("gate-1"))?.gate.status).toBe("PENDING");
    expect((await store.load("gate-1"))?.version).toBe(1);
  });

  it("fails closed when identity verification throws", async () => {
    const { deps } = await setup("human-7");
    const throwing: HumanIdentityVerifier = {
      verifyCredential: async () => {
        throw new Error("provider unavailable");
      },
    };
    await expect(
      authorizeHumanApproval(request(), { ...deps, verifier: throwing }),
    ).rejects.toThrow(UnauthorizedApprovalError);
  });

  it("requires server-resolved approval permission", async () => {
    const { store, deps } = await setup("human-7", ["project:read"]);
    await expect(authorizeHumanApproval(request(), deps)).rejects.toThrow(
      UnauthorizedApprovalError,
    );
    expect((await store.load("gate-1"))?.gate.status).toBe("PENDING");
  });

  it("blocks direct requester self-approval", async () => {
    const { store, deps } = await setup("agent-1");
    await expect(authorizeHumanApproval(request(), deps)).rejects.toThrow(
      UnauthorizedApprovalError,
    );
    expect((await store.load("gate-1"))?.gate.status).toBe("PENDING");
  });

  it("blocks a verified delegation chain containing the requester", async () => {
    const { store, deps } = await setup(
      "human-7",
      [APPROVAL_PERMISSION],
      ["service-2", "agent-1"],
    );
    await expect(authorizeHumanApproval(request(), deps)).rejects.toThrow(
      UnauthorizedApprovalError,
    );
    expect((await store.load("gate-1"))?.gate.status).toBe("PENDING");
  });

  it("rejects a stale proposal with the exact error and no state change", async () => {
    const { store, deps } = await setup("human-7");
    await expect(
      authorizeHumanApproval(request({ proposalDigest: "stale" }), deps),
    ).rejects.toThrow(StaleApprovalError);
    expect((await store.load("gate-1"))?.version).toBe(1);
  });

  it("rejects an unknown gate identifier", async () => {
    const { deps } = await setup("human-7");
    await expect(
      authorizeHumanApproval(request({ gateId: "missing" }), deps),
    ).rejects.toThrow(ApprovalNotFoundError);
  });

  it("rejects invalid decision status at runtime", async () => {
    const { deps } = await setup("human-7");
    await expect(
      authorizeHumanApproval(
        request({ status: "PENDING" as unknown as "APPROVED" }),
        deps,
      ),
    ).rejects.toThrow(TypeError);
  });

  it("allows exactly one concurrent approval decision to commit", async () => {
    const { store, deps } = await setup("human-7");
    const other: HumanApprovalDependencies = {
      ...deps,
      verifier: {
        verifyCredential: async () => ({
          subjectId: "human-8",
          permissions: [APPROVAL_PERMISSION],
        }),
      },
    };
    const results = await Promise.allSettled([
      authorizeHumanApproval(request(), deps),
      authorizeHumanApproval(request({ status: "DENIED" }), other),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect((await store.load("gate-1"))?.version).toBe(2);
  });

  it("consumes the decision once and refuses subsequent replay", async () => {
    const { store, deps } = await setup("human-7");
    await authorizeHumanApproval(request(), deps);
    await expect(
      consumeApprovalForAction(
        store,
        "gate-1",
        "proposal-1",
        "base-1",
        new Date("2026-11-06T00:01:00.000Z"),
      ),
    ).resolves.toMatchObject({ status: "CONSUMED" });
    await expect(
      consumeApprovalForAction(
        store,
        "gate-1",
        "proposal-1",
        "base-1",
        new Date("2026-11-06T00:02:00.000Z"),
      ),
    ).rejects.toThrow(UnauthorizedApprovalError);
    expect((await store.load("gate-1"))?.gate.status).toBe("CONSUMED");
  });
});
