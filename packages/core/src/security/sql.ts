/** Minimal parameterized SQL contract; provide a server-owned PostgreSQL client. */
export interface SqlQueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number | null;
}

export interface SqlExecutor {
  query(sql: string, values?: readonly unknown[]): Promise<SqlQueryResult>;
}
