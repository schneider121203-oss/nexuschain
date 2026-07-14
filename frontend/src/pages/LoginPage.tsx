import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { apiClient } from '../api/client';
import { Shield, Key, User, ArrowRight, AlertTriangle } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [userId, setUserId] = useState('usr_100');
  const [username, setUsername] = useState('jorge');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim() || !username.trim()) {
      setError('Por favor complete todos los campos.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // POST to API Gateway to retrieve JWT
      const res = await apiClient.post<{ accessToken: string }>('/api/auth/token', {
        username: username.trim(),
        userId: userId.trim(),
      });

      login(res.data.accessToken, userId.trim(), username.trim());
      navigate('/');
    } catch (err: any) {
      console.error('Login error:', err);
      setError(
        err.response?.data?.error || 
        err.message || 
        'No se pudo conectar con el API Gateway. Verifique que los contenedores estén corriendo.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-deep px-4 relative overflow-hidden">
      {/* Background Glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-md glass-card p-8 glow-blue relative z-10">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-sky-500/10 rounded-xl border border-sky-500/20 text-sky-400 mb-3">
            <Shield className="w-8 h-8 animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold tracking-wider text-slate-100">
            NEXUS<span className="text-sky-400">CHAIN</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">Plataforma de Transacciones Distribuidas</p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              ID de Usuario
            </label>
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="Ej. usr_100"
                className="w-full bg-dark-deep border border-dark-border focus:border-sky-500/50 rounded-lg py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all"
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Identificador único en el Servicio de Balance (gRPC).</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Nombre de Usuario
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ej. jorge"
                className="w-full bg-dark-deep border border-dark-border focus:border-sky-500/50 rounded-lg py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-sky-500 hover:bg-sky-400 text-white rounded-lg py-2.5 font-medium text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed glow-blue mt-4"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <>
                Autenticar & Entrar
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Footer info */}
        <div className="mt-8 pt-6 border-t border-dark-border/50 text-center">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">
            Sustentación Académica HA/CAP
          </span>
        </div>
      </div>
    </div>
  );
};
