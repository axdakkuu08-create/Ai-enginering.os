export class WorkerConcurrencyLimitError extends Error {
  public constructor(message = "Maximum concurrent agent task limit reached.") {
    super(message);
    this.name = "WorkerConcurrencyLimitError";
  }
}

export class WorkerResourceLimitError extends Error {
  public constructor(message = "Worker resource policy limit exceeded.") {
    super(message);
    this.name = "WorkerResourceLimitError";
  }
}

export interface WorkerResourcePolicy {
  readonly maxExecutionMs: number;
  readonly maxMemoryBytes: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxConcurrentTasks: number;
  /** Exact HTTPS origins. Empty means all worker egress is denied. */
  readonly allowedEgressOrigins: readonly string[];
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
}

/**
 * Validates a declarative worker budget. These values must also be enforced by
 * the execution platform; validation alone does not impose OS/container quotas.
 */
export function validateWorkerResourcePolicy(
  policy: WorkerResourcePolicy,
): WorkerResourcePolicy {
  assertPositiveSafeInteger(policy.maxExecutionMs, "maxExecutionMs");
  assertPositiveSafeInteger(policy.maxMemoryBytes, "maxMemoryBytes");
  assertPositiveSafeInteger(policy.maxInputBytes, "maxInputBytes");
  assertPositiveSafeInteger(policy.maxOutputBytes, "maxOutputBytes");
  assertPositiveSafeInteger(policy.maxConcurrentTasks, "maxConcurrentTasks");

  const origins = policy.allowedEgressOrigins.map((origin) => {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new TypeError("Egress entries must be valid HTTPS origins.");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.origin !== origin.replace(/\/$/, "")
    ) {
      throw new TypeError("Egress entries must be exact HTTPS origins.");
    }
    return parsed.origin;
  });

  if (new Set(origins).size !== origins.length) {
    throw new TypeError("Egress origins must not contain duplicates.");
  }

  return Object.freeze({
    ...policy,
    allowedEgressOrigins: Object.freeze(origins),
  });
}

/** Measures UTF-8 bytes, not JavaScript UTF-16 code units. */
export function assertPayloadWithinLimit(
  payload: string,
  maxBytes: number,
  label: "input" | "output" = "input",
): void {
  assertPositiveSafeInteger(maxBytes, "maxBytes");
  const actualBytes = new TextEncoder().encode(payload).byteLength;
  if (actualBytes > maxBytes) {
    throw new WorkerResourceLimitError(
      `Worker ${label} payload exceeds the configured byte limit.`,
    );
  }
}

/**
 * Exact-origin allow-list check. A network firewall must enforce this
 * independently.
 */
export function assertWorkerEgressAllowed(
  destination: string,
  policy: WorkerResourcePolicy,
): void {
  let parsed: URL;
  try {
    parsed = new URL(destination);
  } catch {
    throw new WorkerResourceLimitError("Worker egress destination is invalid.");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !policy.allowedEgressOrigins.includes(parsed.origin)
  ) {
    throw new WorkerResourceLimitError(
      "Worker egress destination is not allowed.",
    );
  }
}

/**
 * Adds an aborting deadline for cooperative tasks. The operation must observe
 * the signal; this wrapper cannot forcibly terminate a non-cooperative task.
 */
export async function runWithWorkerDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  maxExecutionMs: number,
): Promise<T> {
  assertPositiveSafeInteger(maxExecutionMs, "maxExecutionMs");
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(
        new WorkerResourceLimitError("Worker execution deadline exceeded."),
      );
    }, maxExecutionMs);
  });

  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/**
 * In-process concurrency guard only. It is not a distributed quota or an
 * OS/container isolation boundary.
 */
export class WorkerConcurrencyGuard {
  private activeTasks = 0;

  public constructor(private readonly maxConcurrentTasks = 1) {
    assertPositiveSafeInteger(maxConcurrentTasks, "maxConcurrentTasks");
  }

  public get activeCount(): number {
    return this.activeTasks;
  }

  public acquire(): () => void {
    if (this.activeTasks >= this.maxConcurrentTasks) {
      throw new WorkerConcurrencyLimitError();
    }

    this.activeTasks += 1;
    let released = false;

    return (): void => {
      if (released) return;
      released = true;
      this.activeTasks -= 1;
    };
  }
}
