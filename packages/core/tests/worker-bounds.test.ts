import { describe, expect, it, vi } from "vitest";
import {
  assertPayloadWithinLimit,
  assertWorkerEgressAllowed,
  runWithWorkerDeadline,
  validateWorkerResourcePolicy,
  WorkerConcurrencyGuard,
  WorkerResourceLimitError,
} from "../src/security/worker-bounds.js";

const policy = () =>
  validateWorkerResourcePolicy({
    maxExecutionMs: 100,
    maxMemoryBytes: 1024,
    maxInputBytes: 4,
    maxOutputBytes: 8,
    maxConcurrentTasks: 2,
    allowedEgressOrigins: [],
  });

describe("worker resource policy", () => {
  it("rejects non-positive or unsafe resource limits", () => {
    expect(() =>
      validateWorkerResourcePolicy({ ...policy(), maxMemoryBytes: 0 }),
    ).toThrow(TypeError);
  });

  it("measures payload limits in UTF-8 bytes", () => {
    expect(() => assertPayloadWithinLimit("hello", 4)).toThrow(
      WorkerResourceLimitError,
    );
    expect(() => assertPayloadWithinLimit("é", 2)).not.toThrow();
  });

  it("denies egress by default and rejects non-allow-listed origins", () => {
    expect(() => assertWorkerEgressAllowed("https://example.com/data", policy()))
      .toThrow(WorkerResourceLimitError);
  });

  it("allows only an exact configured HTTPS origin", () => {
    const configured = validateWorkerResourcePolicy({
      ...policy(),
      allowedEgressOrigins: ["https://api.example.com"],
    });
    expect(() =>
      assertWorkerEgressAllowed("https://api.example.com/v1", configured),
    ).not.toThrow();
    expect(() =>
      assertWorkerEgressAllowed("https://evil.example.com", configured),
    ).toThrow(WorkerResourceLimitError);
    expect(() =>
      assertWorkerEgressAllowed("http://api.example.com", configured),
    ).toThrow(WorkerResourceLimitError);
  });

  it("rejects non-HTTPS or credential-bearing egress origins", () => {
    expect(() =>
      validateWorkerResourcePolicy({
        ...policy(),
        allowedEgressOrigins: ["http://example.com"],
      }),
    ).toThrow(TypeError);
    expect(() =>
      validateWorkerResourcePolicy({
        ...policy(),
        allowedEgressOrigins: ["https://user:pass@example.com"],
      }),
    ).toThrow(TypeError);
  });

  it("aborts cooperative work when its deadline expires", async () => {
    vi.useFakeTimers();
    const work = runWithWorkerDeadline(
      (signal) =>
        new Promise<string>((_, reject) => {
          signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
      10,
    );
    const assertion = expect(work).rejects.toThrow(
      WorkerResourceLimitError,
    );
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    vi.useRealTimers();
  });

  it("enforces in-process concurrency and idempotent release", () => {
    const guard = new WorkerConcurrencyGuard(1);
    const release = guard.acquire();
    expect(() => guard.acquire()).toThrow();
    release();
    release();
    expect(guard.activeCount).toBe(0);
    expect(() => guard.acquire()).not.toThrow();
  });
});
