import type { SafeAuditEvent } from "./audit-event.js";

export const AUDIT_GENESIS_HASH = "0".repeat(64);

export interface AuditLedgerEntry {
  readonly sequence: number;
  readonly previousHash: string;
  readonly hash: string;
  readonly event: SafeAuditEvent;
}

export interface AuditLedgerStore {
  append(event: SafeAuditEvent): Promise<AuditLedgerEntry>;
  readAll(): Promise<readonly AuditLedgerEntry[]>;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function hashAuditEntry(
  sequence: number,
  previousHash: string,
  event: SafeAuditEvent,
): Promise<string> {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new TypeError("Audit sequence must be a positive safe integer.");
  }
  if (!/^[0-9a-f]{64}$/.test(previousHash)) {
    throw new TypeError("Previous audit hash must be lowercase SHA-256 hex.");
  }
  return sha256(
    canonicalize({
      version: 1,
      sequence,
      previousHash,
      event,
    }),
  );
}

export async function createAuditLedgerEntry(
  sequence: number,
  previousHash: string,
  event: SafeAuditEvent,
): Promise<AuditLedgerEntry> {
  const hash = await hashAuditEntry(sequence, previousHash, event);
  return Object.freeze({
    sequence,
    previousHash,
    hash,
    event: Object.freeze(event),
  });
}

/** Verifies sequence continuity, linkage, event uniqueness, and every digest. */
export async function verifyAuditLedger(
  entries: readonly AuditLedgerEntry[],
): Promise<boolean> {
  let expectedPrevious = AUDIT_GENESIS_HASH;
  const eventIds = new Set<string>();

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (
      entry.sequence !== index + 1 ||
      entry.previousHash !== expectedPrevious ||
      eventIds.has(entry.event.id)
    ) {
      return false;
    }
    const expectedHash = await hashAuditEntry(
      entry.sequence,
      entry.previousHash,
      entry.event,
    );
    if (entry.hash !== expectedHash) return false;
    expectedPrevious = entry.hash;
    eventIds.add(entry.event.id);
  }
  return true;
}

/**
 * Process-local reference implementation for deterministic tests only.
 * It is not durable and must not be used by a production deployment.
 */
export class InMemoryAuditLedgerStore implements AuditLedgerStore {
  private entries: AuditLedgerEntry[] = [];
  private tail: Promise<void> = Promise.resolve();

  public async append(event: SafeAuditEvent): Promise<AuditLedgerEntry> {
    let result: AuditLedgerEntry | undefined;
    const operation = this.tail.then(async () => {
      const previous = this.entries.at(-1);
      const entry = await createAuditLedgerEntry(
        this.entries.length + 1,
        previous?.hash ?? AUDIT_GENESIS_HASH,
        event,
      );
      this.entries = [...this.entries, entry];
      result = entry;
    });
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    await operation;
    if (!result) throw new Error("Audit append did not produce an entry.");
    return result;
  }

  public async readAll(): Promise<readonly AuditLedgerEntry[]> {
    await this.tail;
    return Object.freeze([...this.entries]);
  }
}
