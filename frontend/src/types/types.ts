// Types definitions for NexusChain Frontend

export interface User {
  username: string;
  userId: string;
}

export interface BalanceResponse {
  accountId: string;
  balance: number;
  currency: string;
}

export interface Order {
  id: string;
  accountId: string;
  type: 'BUY' | 'SELL';
  price: number;
  quantity: number;
}

export interface OrderBook {
  bids: Order[];
  asks: Order[];
}

export interface Transaction {
  tradeId: string;
  buyerAccountId: string;
  sellerAccountId: string;
  price: number;
  quantity: number;
  timestamp: string;
  sagaId?: string;
}

export interface RaftNodeStatus {
  id: number;
  role: 'FOLLOWER' | 'CANDIDATE' | 'LEADER';
  term: number;
  alive: boolean;
}

export interface ConsensusStatus {
  leaderId: number;
  term: number;
  nodes: RaftNodeStatus[];
}

export interface ServiceHealth {
  name: string;
  status: 'UP' | 'DOWN';
  latencyMs: number;
}

export interface SystemHealthResponse {
  timestamp: string;
  services: ServiceHealth[];
}

export interface SagaStep {
  id: string;
  sagaId: string;
  stepName: string;
  status: 'SUCCESS' | 'FAILED' | 'COMPENSATED' | 'TIMED_OUT';
  detail: Record<string, any>;
  timestamp: string;
}

export interface SagaInstance {
  sagaId: string;
  transactionId: string;
  currentState: 'PENDING' | 'BALANCE_LOCKED' | 'MATCHED' | 'SETTLED' | 'COMPENSATING' | 'ROLLED_BACK' | 'FAILED';
  payload: {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    referenceId: string;
  };
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SagaStatusResponse extends SagaInstance {
  steps: SagaStep[];
}
