import React, { useEffect, useRef } from 'react';
import { useSystemStore } from '../store/systemStore';
import { Navbar } from '../components/common/Navbar';
import { 
  Activity, 
  Cpu, 
  Network, 
  RefreshCw, 
  Database,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Zap
} from 'lucide-react';

export const SystemStatusPage: React.FC = () => {
  const { consensus, health, fetchConsensusStatus, fetchSystemHealth } = useSystemStore();

  const pollIntervalRef = useRef<any>(null);

  const syncStatus = () => {
    fetchConsensusStatus();
    fetchSystemHealth();
  };

  useEffect(() => {
    syncStatus();
    // Poll system metrics every 2 seconds for a highly responsive dashboard
    pollIntervalRef.current = setInterval(() => {
      syncStatus();
    }, 2000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Maps Raft role to CSS styling
  const getNodeColorClass = (role: string, alive: boolean) => {
    if (!alive) return 'border-red-500 bg-red-500/10 text-red-400';
    if (role === 'LEADER') return 'border-green-500 bg-green-500/10 text-green-400 glow-green';
    if (role === 'CANDIDATE') return 'border-amber-500 bg-amber-500/10 text-amber-400';
    return 'border-sky-500 bg-sky-500/10 text-sky-400 glow-blue';
  };

  // Helper to map DB names to Icons
  const getServiceIcon = (name: string) => {
    if (name.includes('db')) {
      return <Database className="w-5 h-5" />;
    } else if (name.includes('kafka') || name.includes('consensus')) {
      return <Network className="w-5 h-5" />;
    } else {
      return <Cpu className="w-5 h-5" />;
    }
  };

  return (
    <div className="min-h-screen bg-dark-deep pb-12">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        <div className="space-y-8">
          
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2 m-0 p-0">
                <Activity className="w-6 h-6 text-sky-400" />
                Diagnóstico del Sistema
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Monitoreo en vivo de consenso Raft y salud de la infraestructura de red.
              </p>
            </div>
            
            <button
              onClick={syncStatus}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-dark-border rounded-lg px-4 py-2 text-sm font-semibold flex items-center justify-center gap-2 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              Sincronizar
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Col 1 & 2: Raft Consensus Panel */}
            <div className="lg:col-span-2 space-y-6">
              <div className="glass-card p-6 h-full flex flex-col justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-200 mb-2 flex items-center gap-2">
                    <Network className="w-5 h-5 text-sky-400" />
                    Algoritmo de Consenso Raft (HA)
                  </h2>
                  <p className="text-xs text-slate-500 mb-6">
                    Red distribuida en Go que simula fallos de liderazgo. Pause o tumbe nodos para ver la re-elección de líder.
                  </p>
                </div>

                {!consensus ? (
                  <div className="py-20 flex flex-col items-center justify-center border border-dashed border-dark-border rounded-xl">
                    <Loader2Icon className="w-10 h-10 text-sky-400 animate-spin mb-4" />
                    <span className="text-xs text-slate-500 font-medium">Conectando al servicio de consenso Raft...</span>
                  </div>
                ) : (
                  <div className="space-y-8 flex-grow flex flex-col justify-center">
                    
                    {/* Visual Cluster Map */}
                    <div className="flex flex-col sm:flex-row items-center justify-around gap-8 py-6 relative">
                      {/* Connection lines background */}
                      <div className="hidden sm:block absolute left-1/6 right-1/6 top-1/2 -translate-y-1/2 h-[2px] bg-dark-border z-0"></div>
                      
                      {consensus.nodes.map((node) => (
                        <div
                          key={node.id}
                          className={`w-36 h-36 rounded-full border-2 flex flex-col items-center justify-center gap-1.5 relative z-10 transition-all duration-300 ${getNodeColorClass(
                            node.role,
                            node.alive
                          )}`}
                        >
                          {node.role === 'LEADER' && node.alive && (
                            <div className="absolute -top-2 bg-green-500 text-black text-[9px] font-bold tracking-widest px-2 py-0.5 rounded-full uppercase">
                              Líder
                            </div>
                          )}
                          {!node.alive && (
                            <div className="absolute -top-2 bg-red-500 text-white text-[9px] font-bold tracking-widest px-2 py-0.5 rounded-full uppercase">
                              Caído
                            </div>
                          )}
                          <span className="text-xs text-slate-400 font-bold uppercase tracking-wider font-mono">
                            NODO 0{node.id}
                          </span>
                          <span className="text-lg font-extrabold tracking-tight">
                            {node.alive ? node.role : 'OFFLINE'}
                          </span>
                          <span className="text-[10px] text-slate-500 font-semibold font-mono">
                            Término: {node.term}
                          </span>
                          
                          {/* Heartbeat pulse ring */}
                          {node.role === 'LEADER' && node.alive && (
                            <div className="absolute inset-0 border border-green-500/30 rounded-full heartbeat-active"></div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Term Metrics */}
                    <div className="grid grid-cols-2 gap-4 p-4 bg-slate-800/20 border border-dark-border rounded-xl">
                      <div className="text-center space-y-1">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">
                          Término Global
                        </span>
                        <span className="text-2xl font-black text-sky-400 font-mono">
                          {consensus.term}
                        </span>
                      </div>
                      <div className="text-center space-y-1 border-l border-dark-border">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">
                          ID Líder Actual
                        </span>
                        <span className={`text-2xl font-black font-mono ${consensus.leaderId !== -1 ? 'text-green-400' : 'text-rose-500'}`}>
                          {consensus.leaderId !== -1 ? `NODO 0${consensus.leaderId}` : 'SIN CONCORDIA'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Col 3: Services Health status grid */}
            <div className="lg:col-span-1">
              <div className="glass-card p-6 h-full flex flex-col">
                <h2 className="text-lg font-bold text-slate-200 mb-2 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-sky-400" />
                  Malla de Servicios
                </h2>
                <p className="text-xs text-slate-500 mb-6">
                  Estado de salud de microservicios y bases de datos agregados en el API Gateway.
                </p>

                <div className="space-y-4 flex-grow overflow-y-auto max-h-[420px] pr-1">
                  {health.length === 0 ? (
                    <div className="h-full py-12 flex flex-col items-center justify-center border border-dashed border-dark-border rounded-xl">
                      <Loader2Icon className="w-8 h-8 text-sky-400 animate-spin mb-3" />
                      <span className="text-xs text-slate-500">Cargando telemetría...</span>
                    </div>
                  ) : (
                    health.map((svc) => {
                      const isUp = svc.status === 'UP';
                      return (
                        <div
                          key={svc.name}
                          className="flex items-center justify-between p-3.5 bg-slate-800/20 border border-dark-border/60 rounded-xl hover:border-dark-border transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`p-2 rounded-lg border flex-shrink-0 ${
                              isUp 
                                ? 'bg-sky-500/5 border-sky-500/10 text-sky-400' 
                                : 'bg-rose-500/5 border-rose-500/10 text-rose-400'
                            }`}>
                              {getServiceIcon(svc.name)}
                            </div>
                            <div className="min-w-0">
                              <span className="text-xs font-bold text-slate-200 block truncate capitalize">
                                {svc.name.replace('-', ' ').replace('-db', ' DB').replace('-broker', ' Broker')}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono block">
                                {isUp ? `Latencia: ${svc.latencyMs}ms` : 'No responde'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              isUp 
                                ? 'bg-green-500/10 border-green-500/30 text-green-400' 
                                : 'bg-red-500/10 border-red-500/30 text-red-400'
                            }`}>
                              {svc.status}
                            </span>
                            {isUp ? (
                              <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

          </div>

        </div>
      </main>
    </div>
  );
};

// Simple loader helper
const Loader2Icon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={`animate-spin ${className || ''}`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);
