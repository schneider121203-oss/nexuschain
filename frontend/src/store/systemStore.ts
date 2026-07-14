import { create } from 'zustand';
import { apiClient } from '../api/client';
import { ConsensusStatus, ServiceHealth, SagaInstance, SagaStatusResponse } from '../types/types';

interface SystemState {
  consensus: ConsensusStatus | null;
  health: ServiceHealth[];
  recentSagas: SagaInstance[];
  activeSagaDetails: SagaStatusResponse | null;
  loading: boolean;
  error: string | null;
  
  fetchConsensusStatus: () => Promise<void>;
  fetchSystemHealth: () => Promise<void>;
  fetchRecentSagas: () => Promise<void>;
  fetchSagaDetails: (sagaId: string) => Promise<void>;
}

export const useSystemStore = create<SystemState>((set) => ({
  consensus: null,
  health: [],
  recentSagas: [],
  activeSagaDetails: null,
  loading: false,
  error: null,

  fetchConsensusStatus: async () => {
    try {
      const res = await apiClient.get<ConsensusStatus>('/api/system/consensus/status');
      set({ consensus: res.data });
    } catch (err: any) {
      console.error('Error fetching Raft status:', err);
      // Don't set global error to avoid blocking the whole UI if just Raft is loading
    }
  },

  fetchSystemHealth: async () => {
    try {
      const res = await apiClient.get<{ services: ServiceHealth[] }>('/api/system/health');
      set({ health: res.data.services });
    } catch (err: any) {
      console.error('Error fetching services health:', err);
    }
  },

  fetchRecentSagas: async () => {
    try {
      const res = await apiClient.get<{ sagas: SagaInstance[] }>('/api/sagas?limit=20');
      set({ recentSagas: res.data.sagas });
    } catch (err: any) {
      console.error('Error fetching recent sagas:', err);
    }
  },

  fetchSagaDetails: async (sagaId) => {
    set({ loading: true, error: null });
    try {
      const statusRes = await apiClient.get<SagaInstance>(`/api/saga/${sagaId}`);
      const stepsRes = await apiClient.get<{ steps: any[] }>(`/api/saga/${sagaId}/steps`);
      
      set({
        activeSagaDetails: {
          ...statusRes.data,
          steps: stepsRes.data.steps
        },
        loading: false
      });
    } catch (err: any) {
      console.error('Error fetching saga details:', err);
      set({
        error: err.response?.data?.error || err.message || 'Failed to fetch saga logs',
        loading: false
      });
    }
  }
}));
