import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { Shield, Wallet, Activity, RefreshCw, BarChart2, LogOut } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { username, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path: string) => location.pathname === path;

  const linkClass = (path: string) => `
    flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
    ${isActive(path) 
      ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30 glow-blue' 
      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'}
  `;

  return (
    <nav className="border-b border-dark-border bg-dark-card/90 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="p-2 bg-sky-500/10 rounded-lg border border-sky-500/20 text-sky-400">
              <Shield className="w-6 h-6 animate-pulse" />
            </div>
            <span className="font-bold text-lg tracking-wider text-slate-100 bg-clip-text">
              NEXUS<span className="text-sky-400">CHAIN</span>
            </span>
          </div>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-2">
            <Link to="/" className={linkClass('/')}>
              <Wallet className="w-4 h-4" />
              Saldos
            </Link>
            <Link to="/orders" className={linkClass('/orders')}>
              <BarChart2 className="w-4 h-4" />
              Matching Engine
            </Link>
            <Link to="/history" className={linkClass('/history')}>
              <RefreshCw className="w-4 h-4" />
              Historial (Cassandra)
            </Link>
            <Link to="/status" className={linkClass('/status')}>
              <Activity className="w-4 h-4" />
              Estado del Sistema
            </Link>
          </div>

          {/* User Info / Logout */}
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <div className="text-xs text-slate-500">Operando como</div>
              <div className="text-sm font-semibold text-slate-300">{username}</div>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 rounded-lg transition-all"
              title="Cerrar sesión"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};
