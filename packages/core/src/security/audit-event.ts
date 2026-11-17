export interface AuditEventInput {
  readonly id: string;
  readonly actorId: string;
  readonly action: string;
  readonly target: string;
  readonly outcome: "SUCCESS" | "DENIED" | "FAILED";
  readonly proposalDigest?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface SafeAuditEvent extends AuditEventInput {
  readonly timestamp: string;
  readonly details: Readonly<Record<string, unknown>>;
}

const SENSITIVE_KEY =
  /(authorization|cookie|password|secret|token|private.?key|api.?key|credential|session|signing.?key)/i;

const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

function redactString(value: string): string {
  return SECRET_VALUE_PATTERNS.reduce(
    (safe, pattern) => safe.replace(pattern, "[REDACTED]"),
    value,
  ).slice(0, 2000);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return Object.freeze(
      value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1)),
    );
  }
  if (typeof value === "object") {
    const safe: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const [key, nested] of Object.entries(value).slice(0, 50)) {
      if (!SENSITIVE_KEY.test(key)) {
        safe[key.slice(0, 100)] = sanitizeValue(nested, depth + 1);
      }
    }
    return Object.freeze(safe);
  }
  return "[UNSUPPORTED]";
}

/**
 * Sanitizes before persistence and derives the event time locally. Call this
 * only in the trusted server process; never persist a client timestamp.
 */
export function createSafeAuditEvent(
  input: AuditEventInput,
  serverNow: Date = new Date(),
): SafeAuditEvent {
  if (
    !input.id.trim() ||
    !input.actorId.trim() ||
    !input.action.trim() ||
    !input.target.trim()
  ) {
    throw new TypeError(
      "Audit event identity, actor, action, and target are required.",
    );
  }
  if (!(serverNow instanceof Date) || !Number.isFinite(serverNow.getTime())) {
    throw new TypeError("A valid server clock value is required.");
  }
  if (!["SUCCESS", "DENIED", "FAILED"].includes(input.outcome)) {
    throw new TypeError("Audit event outcome is invalid.");
  }

  const details = sanitizeValue(input.details ?? {}, 0) as Readonly<
    Record<string, unknown>
  >;
  return Object.freeze({
    id: input.id,
    timestamp: serverNow.toISOString(),
    actorId: redactString(input.actorId),
    action: redactString(input.action),
    target: redactString(input.target),
    outcome: input.outcome,
    ...(input.proposalDigest ? { proposalDigest: input.proposalDigest } : {}),
    details,
  });
}
