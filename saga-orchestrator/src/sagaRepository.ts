import { PoolClient } from 'pg';
import { query, withTransaction } from './db';
import { SagaInstance, SagaState, SagaPayload, SagaStepLog } from './types';

// ──────────────────────────────────────────────────────────────────────────────
// Reads
// ──────────────────────────────────────────────────────────────────────────────

export async function getSaga(sagaId: string): Promise<SagaInstance | null> {
  const rows = await query<any>(
    `SELECT saga_id, transaction_id, current_state, payload, created_at, updated_at, retry_count
     FROM saga_instances WHERE saga_id = $1`,
    [sagaId]
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

export async function getSagaByTransactionId(transactionId: string): Promise<SagaInstance | null> {
  const rows = await query<any>(
    `SELECT saga_id, transaction_id, current_state, payload, created_at, updated_at, retry_count
     FROM saga_instances WHERE transaction_id = $1`,
    [transactionId]
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

export async function listRecentSagas(limit = 50, offset = 0): Promise<SagaInstance[]> {
  const rows = await query<any>(
    `SELECT saga_id, transaction_id, current_state, payload, created_at, updated_at, retry_count
     FROM saga_instances
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map(mapRow);
}

/**
 * Returns sagas stuck in an intermediate state for longer than `olderThanMinutes`.
 * Used by the watchdog to detect and compensate timed-out transactions.
 */
export async function getStuckSagas(olderThanMinutes: number): Promise<SagaInstance[]> {
  const rows = await query<any>(
    `SELECT saga_id, transaction_id, current_state, payload, created_at, updated_at, retry_count
     FROM saga_instances
     WHERE current_state IN ('PENDING', 'BALANCE_LOCKED', 'MATCHED', 'COMPENSATING')
       AND updated_at < now() - ($1 || ' minutes')::interval`,
    [olderThanMinutes]
  );
  return rows.map(mapRow);
}

export async function getSagaSteps(sagaId: string): Promise<SagaStepLog[]> {
  const rows = await query<any>(
    `SELECT id, saga_id, step_name, status, detail, timestamp
     FROM saga_steps_log WHERE saga_id = $1 ORDER BY timestamp ASC`,
    [sagaId]
  );
  return rows.map((r: any) => ({
    id: r.id,
    sagaId: r.saga_id,
    stepName: r.step_name,
    status: r.status,
    detail: r.detail,
    timestamp: r.timestamp,
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// Writes
// ──────────────────────────────────────────────────────────────────────────────

export async function createSaga(
  sagaId: string,
  transactionId: string,
  payload: SagaPayload
): Promise<SagaInstance> {
  const rows = await query<any>(
    `INSERT INTO saga_instances (saga_id, transaction_id, current_state, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [sagaId, transactionId, SagaState.PENDING, JSON.stringify(payload)]
  );
  return mapRow(rows[0]);
}

/**
 * Atomically transitions a saga to a new state.
 * Uses a WHERE clause guard to prevent invalid backward transitions:
 * only updates if the current DB state matches `fromState`.
 * Returns the updated saga, or null if the guard prevented the update.
 */
export async function transitionState(
  sagaId: string,
  fromState: SagaState,
  toState: SagaState,
  payloadPatch?: Partial<SagaPayload>
): Promise<SagaInstance | null> {
  return withTransaction(async (client: PoolClient) => {
    // Patch payload if needed (e.g., store orderId or tradeId when they become available)
    let updateSql: string;
    let params: unknown[];

    if (payloadPatch) {
      updateSql = `
        UPDATE saga_instances
        SET current_state = $1,
            updated_at    = now(),
            payload       = payload || $2::jsonb
        WHERE saga_id = $3 AND current_state = $4
        RETURNING *`;
      params = [toState, JSON.stringify(payloadPatch), sagaId, fromState];
    } else {
      updateSql = `
        UPDATE saga_instances
        SET current_state = $1,
            updated_at    = now()
        WHERE saga_id = $2 AND current_state = $3
        RETURNING *`;
      params = [toState, sagaId, fromState];
    }

    const result = await client.query(updateSql, params);
    if (result.rowCount === 0) return null;
    return mapRow(result.rows[0]);
  });
}

export async function incrementRetryCount(sagaId: string): Promise<void> {
  await query(
    `UPDATE saga_instances SET retry_count = retry_count + 1, updated_at = now() WHERE saga_id = $1`,
    [sagaId]
  );
}

/**
 * Appends an immutable step record to the saga audit log.
 * Every state transition and compensation attempt is recorded here.
 */
export async function logStep(
  sagaId: string,
  stepName: string,
  status: SagaStepLog['status'],
  detail?: Record<string, unknown>
): Promise<void> {
  await query(
    `INSERT INTO saga_steps_log (saga_id, step_name, status, detail)
     VALUES ($1, $2, $3, $4)`,
    [sagaId, stepName, status, detail ? JSON.stringify(detail) : null]
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function mapRow(r: any): SagaInstance {
  return {
    sagaId:        r.saga_id,
    transactionId: r.transaction_id,
    currentState:  r.current_state as SagaState,
    payload:       typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    createdAt:     r.created_at,
    updatedAt:     r.updated_at,
    retryCount:    r.retry_count,
  };
}
