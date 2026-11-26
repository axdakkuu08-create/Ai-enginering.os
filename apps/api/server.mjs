import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { ClerkTokenVerifier, bearerFromRequest } from "./clerk-auth.mjs";

const required = ["CLERK_ISSUER", "CLERK_AUDIENCE", "ALLOWED_ORIGINS", "DATABASE_URL"];
for (const key of required) if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
const allowedOrigins = process.env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean);
const verifier = new ClerkTokenVerifier({ issuer: process.env.CLERK_ISSUER, audience: process.env.CLERK_AUDIENCE, allowedOrigins });
const sql = postgres(process.env.DATABASE_URL, { max: 5, idle_timeout: 20, connect_timeout: 10, ssl: "require", prepare: false });
const maxBody = 16_384;

function send(response, status, body, origin) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...(origin ? { "access-control-allow-origin": origin, "vary": "Origin", "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS" } : {}),
  });
  response.end(JSON.stringify(body));
}
async function readBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBody) throw new Error("Request body too large");
  }
  return raw ? JSON.parse(raw) : {};
}
async function authenticate(request) {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || !allowedOrigins.includes(origin)) throw Object.assign(new Error("Origin is not allowed"), { status: 403 });
  const identity = await verifier.verifyToken(bearerFromRequest(request));
  if (identity.authorizedParty !== origin) throw Object.assign(new Error("Token origin does not match request origin"), { status: 403 });
  const rows = await sql.unsafe("SELECT permission FROM app.aios_user_permissions WHERE subject_id = $1 AND enabled = true", [identity.subjectId]);
  return { ...identity, permissions: rows.map((row) => row.permission) };
}
function requirePermission(identity, permission) {
  if (!identity.permissions.includes(permission)) throw Object.assign(new Error("Insufficient permission"), { status: 403 });
}
async function appendAudit(tx, streamId, event) {
  await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext($1))", [streamId]);
  const heads = await tx.unsafe("SELECT sequence, last_hash FROM app.aios_audit_heads WHERE stream_id = $1 FOR UPDATE", [streamId]);
  const previous = heads[0] ?? { sequence: 0, last_hash: "0".repeat(64) };
  const sequence = Number(previous.sequence) + 1;
  const eventId = randomUUID();
  const payload = { ...event, eventId, streamId, sequence, occurredAt: new Date().toISOString() };
  const eventHash = createHash("sha256").update(String(previous.last_hash).trim() + JSON.stringify(payload)).digest("hex");
  if (!heads.length) throw new Error("Audit stream is not initialized");
  await tx.unsafe("UPDATE app.aios_audit_heads SET sequence = $2, last_hash = $3 WHERE stream_id = $1", [streamId, sequence, eventHash]);
  await tx.unsafe("INSERT INTO app.aios_audit_events(stream_id, sequence, event_id, previous_hash, event_hash, event_json) VALUES ($1, $2, $3, $4, $5, $6::jsonb)", [streamId, sequence, eventId, String(previous.last_hash).trim(), eventHash, JSON.stringify(payload)]);
  return payload;
}
const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (request.method === "OPTIONS") {
    if (typeof origin !== "string" || !allowedOrigins.includes(origin)) return send(response, 403, { error: "Origin not allowed" });
    response.writeHead(204, { "access-control-allow-origin": origin, "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS", "vary": "Origin" });
    return response.end();
  }
  const url = new URL(request.url, "http://localhost");
  try {
    if (request.method === "GET" && url.pathname === "/healthz") return send(response, 200, { status: "ok", service: "aios-api", mode: "staging" }, origin && allowedOrigins.includes(origin) ? origin : undefined);
    if (request.method === "GET" && url.pathname === "/readyz") {
      await sql`SELECT 1`;
      return send(response, 200, { status: "ready", database: "connected" }, origin && allowedOrigins.includes(origin) ? origin : undefined);
    }
    if (url.pathname.startsWith("/v1/")) {
      const identity = await authenticate(request);
      if (request.method === "GET" && url.pathname === "/v1/me") return send(response, 200, { subject: identity.subjectId, permissions: identity.permissions }, origin);
      const auditMatch = url.pathname.match(/^\/v1\/audit\/([A-Za-z0-9._:-]{1,128})$/);
      if (request.method === "GET" && auditMatch) {
        requirePermission(identity, "audit:read");
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
        const rows = await sql.unsafe("SELECT sequence, event_id, previous_hash, event_hash, event_json FROM app.aios_audit_events WHERE stream_id = $1 ORDER BY sequence DESC LIMIT $2", [auditMatch[1], limit]);
        return send(response, 200, { events: rows }, origin);
      }
      const approvalMatch = url.pathname.match(/^\/v1\/approvals\/([A-Za-z0-9._:-]{1,128})\/decision$/);
      if (request.method === "POST" && approvalMatch) {
        requirePermission(identity, "approval:write");
        const body = await readBody(request);
        if (!["APPROVED", "DENIED"].includes(body.status) || typeof body.proposalDigest !== "string" || typeof body.baseRevision !== "string") {
          return send(response, 400, { error: "Invalid approval decision payload" }, origin);
        }
        const result = await sql.begin(async (tx) => {
          const gates = await tx.unsafe("SELECT gate_id, task_id, requested_by, status, proposal_digest, base_revision FROM app.aios_approval_gates WHERE gate_id = $1 FOR UPDATE", [approvalMatch[1]]);
          const gate = gates[0];
          if (!gate) throw Object.assign(new Error("Approval gate not found"), { status: 404 });
          if (gate.requested_by === identity.subjectId) throw Object.assign(new Error("Self-approval is forbidden"), { status: 403 });
          if (gate.status !== "PENDING" || gate.proposal_digest !== body.proposalDigest || gate.base_revision !== body.baseRevision) {
            throw Object.assign(new Error("Approval is stale or already decided"), { status: 409 });
          }
          const decidedAt = new Date();
          const expiresAt = new Date(decidedAt.getTime() + 60 * 60 * 1000);
          const updated = await tx.unsafe("UPDATE app.aios_approval_gates SET status = $2, authorized_by = $3, decided_at = $4, expires_at = $5, version = version + 1 WHERE gate_id = $1 AND status = 'PENDING' RETURNING gate_id, status, authorized_by, decided_at, expires_at, version", [gate.gate_id, body.status, identity.subjectId, decidedAt, expiresAt]);
          await appendAudit(tx, "approvals", { type: "approval.decision", actor: identity.subjectId, gateId: gate.gate_id, taskId: gate.task_id, decision: body.status, proposalDigest: body.proposalDigest, baseRevision: body.baseRevision });
          return updated[0];
        });
        return send(response, 200, { approval: result }, origin);
      }
      return send(response, 404, { error: "Route not found" }, origin);
    }
    return send(response, 404, { error: "Route not found" });
  } catch (error) {
    const status = Number(error?.status) || (error?.message?.includes("token") || error?.message?.includes("JWT") || error?.message?.includes("bearer") ? 401 : 500);
    if (status === 500) console.error(JSON.stringify({ event: "request_failed", path: url.pathname, name: error?.name || "Error" }));
    return send(response, status, { error: status === 500 ? "Internal server error" : error.message }, origin && allowedOrigins.includes(origin) ? origin : undefined);
  }
});
server.requestTimeout = 10_000;
server.headersTimeout = 12_000;
server.keepAliveTimeout = 5_000;
const port = Number(process.env.PORT || 3000);
verifier.loadKeys().then(async () => { await sql`SELECT 1`; server.listen(port, "0.0.0.0"); console.log(JSON.stringify({ event: "clerk_jwks_ready", issuer: process.env.CLERK_ISSUER, audience: process.env.CLERK_AUDIENCE })); console.log(JSON.stringify({ event: "neon_database_ready", database: "ai_engineering_os", environment: "staging" })); }).catch((error) => { console.error(JSON.stringify({ event: "startup_dependency_unavailable", name: error?.name || "Error" })); process.exit(1); });
async function shutdown() {
  server.close(async () => { await sql.end({ timeout: 5 }); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
