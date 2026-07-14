import { Pool, PoolClient } from 'pg';

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'nexuschain_db',
  user:     process.env.DB_USER     || 'nexus_user',
  password: process.env.DB_PASSWORD || 'nexus_password',
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

/**
 * DDL for the Saga Orchestrator tables.
 * Hibernate's ddl-auto=update handles the balance-service tables;
 * the orchestrator manages its own schema here since it's a separate service.
 *
 * Tables defined in plan_tecnico_nexuschain.md §4.2
 */
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS saga_instances (
    saga_id        TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL UNIQUE,
    current_state  VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    payload        JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    retry_count    INT NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_saga_state_updated
    ON saga_instances (current_state, updated_at);

  CREATE TABLE IF NOT EXISTS saga_steps_log (
    id         BIGSERIAL PRIMARY KEY,
    saga_id    TEXT NOT NULL REFERENCES saga_instances(saga_id) ON DELETE CASCADE,
    step_name  VARCHAR(50) NOT NULL,
    status     VARCHAR(20) NOT NULL,
    detail     JSONB,
    timestamp  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_steps_saga_id
    ON saga_steps_log (saga_id, timestamp DESC);
`;

export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA_SQL);
    console.log('✅ Saga Orchestrator DB schema initialized');
  } finally {
    client.release();
  }
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
