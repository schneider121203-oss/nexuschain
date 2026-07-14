import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// We target the API Gateway (port 8080)
const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:8080';

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor: Attach JWT Token if logged in
apiClient.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response Interceptor: Auto-logout on 401 Unauthorized
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.warn('⚠️ Token expired or unauthorized. Logging out...');
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);
