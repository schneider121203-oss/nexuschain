import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

const PROTO_PATH = path.resolve(__dirname, '../../proto/balance.proto');
const BALANCE_SERVICE_URL = process.env.BALANCE_SERVICE_URL || 'localhost:50051';

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const balanceProto = (grpc.loadPackageDefinition(packageDefinition) as any).nexuschain.balance;

const balanceClient = new balanceProto.BalanceService(
  BALANCE_SERVICE_URL,
  grpc.credentials.createInsecure()
);

interface TransactionResult {
  success: boolean;
  message: string;
  transactionId: string;
  remainingBalance: number;
}

/**
 * Debits `amount` from `fromAccountId` and credits `toAccountId`.
 * Uses the existing gRPC ProcessTransaction RPC — the referenceId acts
 * as the idempotency key (backed by the IdempotencyLayer we built earlier).
 */
export function processTransaction(
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  referenceId: string,
  timeoutMs = 10_000
): Promise<TransactionResult> {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + timeoutMs);

    balanceClient.ProcessTransaction(
      {
        from_account_id: fromAccountId,
        to_account_id:   toAccountId,
        amount,
        reference_id:    referenceId,
      },
      { deadline },
      (err: grpc.ServiceError | null, response: TransactionResult) => {
        if (err) {
          reject(new Error(`gRPC ProcessTransaction failed: ${err.message} (code: ${err.code})`));
        } else {
          resolve(response);
        }
      }
    );
  });
}

/**
 * Compensating transaction — reverses a debit by sending money back from `to` → `from`.
 *
 * Design decision (from implementation plan):
 * Instead of adding a new ReverseTransaction RPC to the .proto (which would require
 * rebuilding the Java service), we call ProcessTransaction with inverted accounts.
 * The `_REVERSAL` suffix on referenceId makes it a distinct idempotency key,
 * so it can execute exactly once even if called multiple times during compensation.
 *
 * This is a standard pattern in distributed systems — the "compensating transaction"
 * is semantically a new forward transaction in the opposite direction.
 */
export function reverseTransaction(
  fromAccountId: string,  // original sender (receives money back)
  toAccountId: string,    // original receiver (returns money)
  amount: number,
  originalReferenceId: string,
  timeoutMs = 10_000
): Promise<TransactionResult> {
  const reversalReferenceId = `${originalReferenceId}_REVERSAL`;

  console.log(
    `🔄 Compensating: reversing transfer ${originalReferenceId} ` +
    `(${toAccountId} → ${fromAccountId}, amount: ${amount}, ref: ${reversalReferenceId})`
  );

  // Note: from/to are inverted — money flows back from receiver to original sender
  return processTransaction(toAccountId, fromAccountId, amount, reversalReferenceId, timeoutMs);
}
