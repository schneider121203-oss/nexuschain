import { v4 as uuidv4 } from 'uuid';
import {
  SagaState,
  SagaPayload,
  SagaEvent,
  SagaCommand,
  SagaInstance,
  COMPENSABLE_STATES,
  TERMINAL_STATES,
  StartSagaRequest,
} from './types';
import {
  createSaga,
  getSaga,
  transitionState,
  logStep,
  getStuckSagas,
  incrementRetryCount,
} from './sagaRepository';
import { publishCommand } from './kafka';
import { processTransaction, reverseTransaction } from './balanceClient';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/** Sagas stuck longer than this will be compensated by the watchdog */
const WATCHDOG_TIMEOUT_MINUTES = parseInt(process.env.SAGA_TIMEOUT_MINUTES || '5');
/** Watchdog polling interval */
const WATCHDOG_INTERVAL_MS = parseInt(process.env.SAGA_WATCHDOG_INTERVAL_MS || '60000');
/** Max compensation retries before marking saga as FAILED */
const MAX_COMPENSATION_RETRIES = 3;

// ──────────────────────────────────────────────────────────────────────────────
// 1. Start a new Saga
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Entry point for a new saga.
 * Called by the REST endpoint POST /saga/start.
 *
 * Flow:
 *   1. Persist saga in PENDING state
 *   2. Call balance-service (synchronous gRPC) to debit the sender
 *   3. If debit succeeds → transition to BALANCE_LOCKED and publish SUBMIT_ORDER command to Kafka
 *   4. If debit fails → transition to FAILED (no compensation needed, money never moved)
 *
 * The caller receives the sagaId immediately and can poll GET /saga/:sagaId for status.
 */
export async function startSaga(req: StartSagaRequest): Promise<SagaInstance> {
  const sagaId        = uuidv4();
  const transactionId = req.referenceId;

  const payload: SagaPayload = {
    fromAccountId: req.fromAccountId,
    toAccountId:   req.toAccountId,
    amount:        req.amount,
    referenceId:   req.referenceId,
  };

  // Persist — creates the durable saga record before any external call
  const saga = await createSaga(sagaId, transactionId, payload);
  await logStep(sagaId, 'saga_created', 'SUCCESS', { transactionId, payload });

  console.log(`🆕 Saga ${sagaId} created (PENDING) for transaction ${transactionId}`);

  // Execute balance debit asynchronously so the HTTP response returns immediately
  // The client polls for status — this is the async saga pattern
  executeBalanceStep(saga).catch(err =>
    console.error(`❌ Unhandled error in executeBalanceStep for saga ${sagaId}:`, err)
  );

  return saga;
}

/**
 * Step 1 of the saga: debit the sender's balance.
 * This is the first and most critical step — if it fails, no money has moved.
 */
async function executeBalanceStep(saga: SagaInstance): Promise<void> {
  const { sagaId, payload } = saga;

  try {
    console.log(`💳 Saga ${sagaId}: calling balance-service (debit ${payload.amount} from ${payload.fromAccountId})`);

    const result = await processTransaction(
      payload.fromAccountId,
      payload.toAccountId,
      payload.amount,
      payload.referenceId
    );

    if (!result.success) {
      // Balance rejected (insufficient funds, same account, etc.)
      await logStep(sagaId, 'balance_debit', 'FAILED', { reason: result.message });
      await transitionState(sagaId, SagaState.PENDING, SagaState.FAILED);
      console.log(`❌ Saga ${sagaId} → FAILED (balance rejected: ${result.message})`);
      return;
    }

    // Debit succeeded — transition and publish the next command
    await logStep(sagaId, 'balance_debit', 'SUCCESS', {
      remainingBalance: result.remainingBalance,
      transactionId:    result.transactionId,
    });
    const updated = await transitionState(sagaId, SagaState.PENDING, SagaState.BALANCE_LOCKED);
    if (!updated) {
      console.warn(`⚠️  Saga ${sagaId}: state transition PENDING→BALANCE_LOCKED was rejected (concurrent update?)`);
      return;
    }

    console.log(`🔒 Saga ${sagaId} → BALANCE_LOCKED — publishing SUBMIT_ORDER`);

    // Publish SUBMIT_ORDER command to matching-service via Kafka
    const orderId = `ORD-${sagaId}`;
    const command: SagaCommand = {
      type:          'SUBMIT_ORDER',
      sagaId,
      transactionId: payload.referenceId,
      payload:       { ...payload, orderId },
      issuedAt:      new Date().toISOString(),
    };
    await publishCommand(command);
    await logStep(sagaId, 'submit_order_command', 'SUCCESS', { orderId });

  } catch (err: any) {
    console.error(`❌ Saga ${sagaId}: balance step threw an exception:`, err.message);
    await logStep(sagaId, 'balance_debit', 'FAILED', { error: err.message });
    await transitionState(sagaId, SagaState.PENDING, SagaState.FAILED);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. Handle incoming Saga Events (from Kafka)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Main event handler — called by the Kafka consumer for each message
 * on the saga.events topic.
 *
 * This is the core of the state machine:
 *   ORDER_MATCHED    → BALANCE_LOCKED → MATCHED (wait for HISTORY_RECORDED)
 *   ORDER_FAILED     → BALANCE_LOCKED → COMPENSATING → attempt reversal
 *   HISTORY_RECORDED → MATCHED → SETTLED ✅
 *   HISTORY_FAILED   → MATCHED → COMPENSATING → attempt reversal
 */
export async function handleSagaEvent(event: SagaEvent): Promise<void> {
  console.log(`📨 Received saga event [${event.type}] for saga ${event.sagaId}`);

  const saga = await getSaga(event.sagaId);
  if (!saga) {
    console.warn(`⚠️  Saga ${event.sagaId} not found — ignoring event ${event.type}`);
    return;
  }

  if (TERMINAL_STATES.has(saga.currentState)) {
    console.log(`ℹ️  Saga ${event.sagaId} is already in terminal state ${saga.currentState} — ignoring late event ${event.type}`);
    return;
  }

  switch (event.type) {
    case 'ORDER_MATCHED':
      await handleOrderMatched(saga, event);
      break;

    case 'ORDER_FAILED':
      await handleOrderFailed(saga, event);
      break;

    case 'HISTORY_RECORDED':
      await handleHistoryRecorded(saga, event);
      break;

    case 'HISTORY_FAILED':
      await handleHistoryFailed(saga, event);
      break;

    default:
      console.warn(`⚠️  Unknown saga event type: ${(event as any).type}`);
  }
}

async function handleOrderMatched(saga: SagaInstance, event: SagaEvent): Promise<void> {
  const { sagaId } = saga;
  const tradeId = event.detail.tradeId as string | undefined;

  await logStep(sagaId, 'order_matched', 'SUCCESS', event.detail);
  const updated = await transitionState(
    sagaId,
    SagaState.BALANCE_LOCKED,
    SagaState.MATCHED,
    tradeId ? { tradeId } : undefined
  );

  if (updated) {
    console.log(`✅ Saga ${sagaId} → MATCHED (tradeId: ${tradeId}) — waiting for HISTORY_RECORDED`);
  } else {
    console.warn(`⚠️  Saga ${sagaId}: ORDER_MATCHED transition blocked (expected BALANCE_LOCKED, got ${saga.currentState})`);
  }
}

async function handleOrderFailed(saga: SagaInstance, event: SagaEvent): Promise<void> {
  const { sagaId } = saga;

  await logStep(sagaId, 'order_failed', 'FAILED', event.detail);
  console.log(`⚠️  Saga ${sagaId}: order failed — initiating compensation`);

  await compensate(saga, 'ORDER_FAILED');
}

async function handleHistoryRecorded(saga: SagaInstance, event: SagaEvent): Promise<void> {
  const { sagaId } = saga;

  await logStep(sagaId, 'history_recorded', 'SUCCESS', event.detail);
  const updated = await transitionState(sagaId, SagaState.MATCHED, SagaState.SETTLED);

  if (updated) {
    console.log(`🎉 Saga ${sagaId} → SETTLED ✅  Transaction fully committed.`);
  } else {
    console.warn(`⚠️  Saga ${sagaId}: HISTORY_RECORDED arrived but saga is in ${saga.currentState}`);
  }
}

async function handleHistoryFailed(saga: SagaInstance, event: SagaEvent): Promise<void> {
  const { sagaId } = saga;

  await logStep(sagaId, 'history_failed', 'FAILED', event.detail);
  console.log(`⚠️  Saga ${sagaId}: history write failed — initiating compensation`);

  await compensate(saga, 'HISTORY_FAILED');
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. Compensation (rollback)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Executes the compensation step: reverses the balance debit.
 *
 * The compensating transaction uses the _REVERSAL suffix pattern so it's
 * idempotent — if called multiple times (e.g., watchdog + manual retry),
 * only the first execution actually transfers money.
 *
 * On success  → ROLLED_BACK ✅
 * On failure after MAX_COMPENSATION_RETRIES → FAILED ❌ (manual intervention needed)
 */
export async function compensate(saga: SagaInstance, trigger: string): Promise<void> {
  const { sagaId, payload, retryCount } = saga;

  if (!COMPENSABLE_STATES.has(saga.currentState)) {
    console.warn(`⚠️  Saga ${sagaId} is in ${saga.currentState} — not compensable`);
    return;
  }

  if (retryCount >= MAX_COMPENSATION_RETRIES) {
    await logStep(sagaId, 'compensation_abandoned', 'FAILED', {
      trigger,
      reason: `Max retries (${MAX_COMPENSATION_RETRIES}) exceeded — manual intervention required`,
    });
    await transitionState(sagaId, saga.currentState, SagaState.FAILED);
    console.error(`❌ Saga ${sagaId} → FAILED (compensation exhausted after ${retryCount} retries)`);
    return;
  }

  // Move to COMPENSATING state
  const compensating = await transitionState(sagaId, saga.currentState, SagaState.COMPENSATING);
  if (!compensating) {
    // Another process already moved this saga — avoid double-compensation
    console.warn(`⚠️  Saga ${sagaId}: could not acquire COMPENSATING state — already being compensated`);
    return;
  }

  await incrementRetryCount(sagaId);
  await logStep(sagaId, 'compensation_started', 'COMPENSATED', { trigger, attempt: retryCount + 1 });

  try {
    console.log(`🔄 Saga ${sagaId}: compensating (attempt ${retryCount + 1}) — reversing balance debit`);

    const result = await reverseTransaction(
      payload.fromAccountId,
      payload.toAccountId,
      payload.amount,
      payload.referenceId
    );

    if (result.success) {
      await logStep(sagaId, 'balance_reversed', 'COMPENSATED', {
        reversalRef:       `${payload.referenceId}_REVERSAL`,
        remainingBalance:  result.remainingBalance,
      });
      await transitionState(sagaId, SagaState.COMPENSATING, SagaState.ROLLED_BACK);
      console.log(`✅ Saga ${sagaId} → ROLLED_BACK — compensation successful`);
    } else {
      await logStep(sagaId, 'balance_reversed', 'FAILED', { reason: result.message });
      // Put it back to COMPENSATING for the watchdog to retry
      console.error(`❌ Saga ${sagaId}: reversal rejected by balance-service: ${result.message}`);
    }

  } catch (err: any) {
    await logStep(sagaId, 'balance_reversed', 'FAILED', { error: err.message });
    console.error(`❌ Saga ${sagaId}: exception during reversal:`, err.message);
    // Saga stays in COMPENSATING — watchdog will retry
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. Watchdog — detects and compensates timed-out sagas
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Scans for sagas stuck in intermediate states longer than WATCHDOG_TIMEOUT_MINUTES.
 * For each stuck saga, triggers compensation.
 *
 * This is the key mechanism that distinguishes a real Saga implementation from
 * "a pipeline that hopes everything succeeds" — it closes Gap 3.2 from the plan.
 *
 * Example scenario for the sustentation demo:
 *   1. Start a saga
 *   2. docker pause nexus_matching_service  (simulate crash)
 *   3. Wait ~5 minutes
 *   4. Watchdog detects BALANCE_LOCKED saga timed out → triggers reversal
 *   5. SELECT * FROM saga_instances → state is ROLLED_BACK
 *   6. Verify the balance was returned: GET /api/balance/usr_100
 */
export async function runWatchdog(): Promise<void> {
  console.log(`🐕 Watchdog: scanning for sagas stuck > ${WATCHDOG_TIMEOUT_MINUTES} minutes...`);

  try {
    const stuckSagas = await getStuckSagas(WATCHDOG_TIMEOUT_MINUTES);

    if (stuckSagas.length === 0) {
      console.log('🐕 Watchdog: no stuck sagas found');
      return;
    }

    console.log(`🐕 Watchdog: found ${stuckSagas.length} stuck saga(s) — compensating`);

    for (const saga of stuckSagas) {
      console.log(`🐕 Watchdog: compensating stuck saga ${saga.sagaId} (state: ${saga.currentState}, age: ${Math.round((Date.now() - saga.updatedAt.getTime()) / 60000)}m)`);
      await logStep(saga.sagaId, 'watchdog_timeout', 'TIMED_OUT', {
        state:    saga.currentState,
        ageMs:    Date.now() - saga.updatedAt.getTime(),
        trigger:  'WATCHDOG',
      });
      await compensate(saga, 'WATCHDOG_TIMEOUT');
    }
  } catch (err) {
    console.error('❌ Watchdog error:', err);
  }
}

/**
 * Starts the watchdog timer. Runs once immediately, then on the configured interval.
 */
export function startWatchdog(): NodeJS.Timeout {
  console.log(`🐕 Starting watchdog (interval: ${WATCHDOG_INTERVAL_MS}ms, timeout: ${WATCHDOG_TIMEOUT_MINUTES}min)`);
  runWatchdog(); // run once at startup
  return setInterval(runWatchdog, WATCHDOG_INTERVAL_MS);
}
