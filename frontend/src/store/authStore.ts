import { create } from 'zustand';

interface AuthState {
  token: string | null;
  userId: string | null;
  username: string | null;
  isAuthenticated: boolean;
  login: (token: string, userId: string, username: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  userId: null,
  username: null,
  isAuthenticated: false,
  login: (token, userId, username) => set({ 
    token, 
    userId, 
    username, 
    isAuthenticated: true 
  }),
  logout: () => set({ 
    token: null, 
    userId: null, 
    username: null, 
    isAuthenticated: false 
  }),
}));
