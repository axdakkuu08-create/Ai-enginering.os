import { describe, expect, it } from "vitest";
import {
  APPROVAL_PERMISSION,
  authorizeHumanApproval,
  type HumanIdentityVerifier,
} from "../src/security/human-authorization.js";
import {
  createApprovalGate,
  recordApprovalDecision,
} from "../src/security/approval.js";
import { createSafeAuditEvent } from "../src/security/audit-event.js";

const makeGate = () =>
  createApprovalGate({
    id: "os103-gate",
    taskId: "os103-task",
    requestedBy: "agent-requester",
    proposalDigest: "sha256:proposal-a",
    baseRevision: "a".repeat(40),
  });

const makeDecision = (timestamp: string) => ({
  status: "APPROVED" as const,
  actorId: "independent-human",
  actorType: "HUMAN" as const,
  proposalDigest: "sha256:proposal-a",
  baseRevision: "a".repeat(40),
  timestamp,
});

/**
 * These are intentional expected-failure tests. They describe controls that
 * the current code does not yet provide. Vitest marks them as expected failures
 * so the free CI suite can remain executable while clearly reporting the gaps.
 *
 * A green workflow containing these tests does NOT mean OS-10.3 is secure.
 * Remove .fails only after the corresponding control is implemented and
 * independently verified.
 */
describe("OS-10.3 assurance gaps — expected failures", () => {
  it.fails("rejects an approval outside an explicit freshness window", () => {
    expect(() =>
      recordApprovalDecision(makeGate(), makeDecision("2000-01-01T00:00:00.000Z")),
    ).toThrow();
  });

  it.fails("does not accept a verifier supplied by an untrusted caller", async () => {
    const untrustedVerifier: HumanIdentityVerifier = {
      verifyCredential: async () => ({
        subjectId: "attacker-controlled-subject",
        permissions: [APPROVAL_PERMISSION],
      }),
    };

    await expect(
      authorizeHumanApproval(
        {
          gate: makeGate(),
          credential: "untrusted-input",
          status: "APPROVED",
          proposalDigest: "sha256:proposal-a",
          baseRevision: "a".repeat(40),
          timestamp: "2026-11-11T00:00:00.000Z",
        },
        untrustedVerifier,
      ),
    ).rejects.toThrow();
  });

  it.fails("binds approval gates to repository and protected action context", () => {
    const gate = makeGate();
    expect(gate).toHaveProperty("repository");
    expect(gate).toHaveProperty("action");
    expect(gate).toHaveProperty("targetBranch");
  });

  it.fails("provides tamper-evident audit sequence and integrity metadata", () => {
    const event = createSafeAuditEvent({
      id: "audit-1",
      timestamp: "2026-11-11T00:00:00.000Z",
      actorId: "human-1",
      action: "approval.record",
      target: "org/repo",
      outcome: "SUCCESS",
    });
    expect(event).toHaveProperty("sequence");
    expect(event).toHaveProperty("previousHash");
    expect(event).toHaveProperty("integrityHash");
  });
});
