/**
 * Shared types and enums for the NexusChain Saga Orchestrator.
 *
 * The Saga pattern here is ORCHESTRATOR-based (not choreography):
 * this service is the single coordinator that commands other services
 * and reacts to their responses. This trades decoupling for auditability —
 * a correct trade-off for a financial system where audit is a regulatory requirement.
 *
 * State machine:
 *
 *   PENDING
 *     ├─→ BALANCE_LOCKED  (balance-service confirmed debit)
 *     │     ├─→ MATCHED        (matching-service confirmed order)
 *     │     │     ├─→ SETTLED       ✅ terminal
 *     │     │     └─→ COMPENSATING  (history write failed)
 *     │     └─→ COMPENSATING  (matching failed or timed out)
 *     │           ├─→ ROLLED_BACK   ✅ terminal
 *     │           └─→ FAILED        ❌ terminal (compensation also failed)
 *     └─→ FAILED           ❌ terminal (balance-service rejected)
 */

// ──────────────────────────────────────────────────────────────────────────────
// State Machine
// ──────────────────────────────────────────────────────────────────────────────

export enum SagaState {
  PENDING         = 'PENDING',
  BALANCE_LOCKED  = 'BALANCE_LOCKED',
  MATCHED         = 'MATCHED',
  COMPENSATING    = 'COMPENSATING',
  SETTLED         = 'SETTLED',
  ROLLED_BACK     = 'ROLLED_BACK',
  FAILED          = 'FAILED',
}

/** States from which automatic compensation is possible */
export const COMPENSABLE_STATES = new Set([
  SagaState.BALANCE_LOCKED,
  SagaState.MATCHED,
  SagaState.COMPENSATING,
]);

/** Terminal states — no further transitions expected */
export const TERMINAL_STATES = new Set([
  SagaState.SETTLED,
  SagaState.ROLLED_BACK,
  SagaState.FAILED,
]);

// ──────────────────────────────────────────────────────────────────────────────
// Database row shapes
// ──────────────────────────────────────────────────────────────────────────────

export interface SagaInstance {
  sagaId: string;
  transactionId: string;
  currentState: SagaState;
  payload: SagaPayload;
  createdAt: Date;
  updatedAt: Date;
  retryCount: number;
}

export interface SagaStepLog {
  id: number;
  sagaId: string;
  stepName: string;
  status: 'SUCCESS' | 'FAILED' | 'COMPENSATED' | 'TIMED_OUT';
  detail: Record<string, unknown> | null;
  timestamp: Date;
}

// ──────────────────────────────────────────────────────────────────────────────
// Business payload
// ──────────────────────────────────────────────────────────────────────────────

/** The business data that travels through the entire saga lifecycle */
export interface SagaPayload {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  referenceId: string;
  orderId?: string;   // assigned when the matching order is submitted
  tradeId?: string;   // assigned when the order is matched
}

// ──────────────────────────────────────────────────────────────────────────────
// Kafka message schemas
// ──────────────────────────────────────────────────────────────────────────────

/** Commands published by the Orchestrator to direct other services */
export type SagaCommandType =
  | 'SUBMIT_ORDER'       // Orchestrator → Matching Service
  | 'RELEASE_LOCK';      // (reserved for future explicit lock release)

export interface SagaCommand {
  type: SagaCommandType;
  sagaId: string;
  transactionId: string;
  payload: SagaPayload;
  issuedAt: string; // ISO timestamp
}

/** Events published by services back to the Orchestrator */
export type SagaEventType =
  | 'ORDER_MATCHED'       // Matching Service → Orchestrator
  | 'ORDER_FAILED'        // Matching Service → Orchestrator
  | 'HISTORY_RECORDED'    // Transaction History → Orchestrator
  | 'HISTORY_FAILED';     // Transaction History → Orchestrator

export interface SagaEvent {
  type: SagaEventType;
  sagaId: string;
  transactionId: string;
  detail: Record<string, unknown>;
  occurredAt: string; // ISO timestamp
}

// ──────────────────────────────────────────────────────────────────────────────
// HTTP API shapes (REST endpoints of the Orchestrator)
// ──────────────────────────────────────────────────────────────────────────────

export interface StartSagaRequest {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  referenceId: string;
}

export interface StartSagaResponse {
  sagaId: string;
  transactionId: string;
  currentState: SagaState;
  message: string;
}
