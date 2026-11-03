export type ProjectStatus = "ACTIVE" | "ARCHIVED" | "PENDING";
export type TaskStep = "A" | "B" | "C" | "D";
export type TaskRunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export type ApprovalStatus = "PENDING" | "APPROVED" | "DENIED";

/** Supported dashboard navigation destinations; intentionally a closed union. */
export type NavigationRoute =
  | "/"
  | "/projects"
  | "/tasks"
  | "/evidence"
  | "/settings";

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly repository: string;
  readonly status: ProjectStatus;
  readonly defaultBranch: string;
}

export interface TaskRun {
  readonly id: string;
  readonly projectId: string;
  readonly step: TaskStep;
  readonly status: TaskRunStatus;
  /** Git commit or evidence object SHA; null until evidence exists. */
  readonly evidenceSha: string | null;
}

export interface ApprovalGate {
  readonly id: string;
  readonly taskId: string;
  readonly status: ApprovalStatus;
  /** Null until a human records an approval or denial. */
  readonly authorizedBy: string | null;
  /** ISO-8601 timestamp; null while the gate is pending. */
  readonly timestamp: string | null;
}

export interface AuditLog {
  readonly id: string;
  readonly entityId: string;
  readonly eventType: string;
  readonly details: Readonly<Record<string, unknown>>;
  /** ISO-8601 timestamp. */
  readonly timestamp: string;
}
