import { create } from 'zustand';
import { apiClient } from '../api/client';
import { BalanceResponse, SagaInstance } from '../types/types';

interface BalanceState {
  balance: number;
  currency: string;
  loading: boolean;
  error: string | null;
  fetchBalance: (accountId: string) => Promise<void>;
  executeTransfer: (
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    referenceId: string
  ) => Promise<{ success: boolean; data?: SagaInstance; error?: string }>;
}

export const useBalanceStore = create<BalanceState>((set) => ({
  balance: 0,
  currency: 'USD',
  loading: false,
  error: null,

  fetchBalance: async (accountId) => {
    set({ loading: true, error: null });
    try {
      // API Gateway maps /api/balance/:id -> balance-service:50051 GetBalance
      const res = await apiClient.get<BalanceResponse>(`/api/balance/${accountId}`);
      set({ 
        balance: res.data.balance, 
        currency: res.data.currency || 'USD',
        loading: false 
      });
    } catch (err: any) {
      console.error('Error fetching balance:', err);
      set({ 
        error: err.response?.data?.error || err.message || 'Failed to fetch balance', 
        loading: false 
      });
    }
  },

  executeTransfer: async (fromAccountId, toAccountId, amount, referenceId) => {
    set({ loading: true, error: null });
    try {
      // Calls API Gateway proxy route: POST /api/saga/transfer -> saga-orchestrator:8083/saga/start
      const res = await apiClient.post<SagaInstance>('/api/saga/transfer', {
        fromAccountId,
        toAccountId,
        amount,
        referenceId,
      });

      // Fetch balance again to reflect debit locally (optimistic or sychronous gRPC lock update)
      // Note: Since balance is lock-debited sychronously on saga start, balance should drop immediately!
      await useBalanceStore.getState().fetchBalance(fromAccountId);
      
      set({ loading: false });
      return { success: true, data: res.data };
    } catch (err: any) {
      console.error('Saga transfer failed:', err);
      const errMsg = err.response?.data?.error || err.message || 'Saga transfer failed';
      set({ error: errMsg, loading: false });
      return { success: false, error: errMsg };
    }
  },
}));
