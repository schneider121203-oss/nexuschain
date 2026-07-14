import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { OrdersPage } from './pages/OrdersPage';
import { HistoryPage } from './pages/HistoryPage';
import { SystemStatusPage } from './pages/SystemStatusPage';

// A simple Route Guard to protect pages requiring authentication
const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<LoginPage />} />

        {/* Private Protected Routes */}
        <Route 
          path="/" 
          element={
            <PrivateRoute>
              <DashboardPage />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/orders" 
          element={
            <PrivateRoute>
              <OrdersPage />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/history" 
          element={
            <PrivateRoute>
              <HistoryPage />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/status" 
          element={
            <PrivateRoute>
              <SystemStatusPage />
            </PrivateRoute>
          } 
        />

        {/* Catch-all redirect to dashboard */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
