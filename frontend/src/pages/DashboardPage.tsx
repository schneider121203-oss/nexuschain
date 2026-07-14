import React, { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useBalanceStore } from '../store/balanceStore';
import { useSystemStore } from '../store/systemStore';
import { Navbar } from '../components/common/Navbar';
import { v4 as uuidv4 } from 'uuid';
import { 
  Wallet, 
  Send, 
  RefreshCw, 
  CheckCircle, 
  XCircle, 
  Loader2, 
  ChevronRight, 
  Clock, 
  Info,
  ShieldCheck
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const { userId } = useAuthStore();
  const { balance, currency, fetchBalance, executeTransfer, loading: balanceLoading } = useBalanceStore();
  const { activeSagaDetails, fetchSagaDetails } = useSystemStore();

  const [toAccountId, setToAccountId] = useState(userId === 'usr_100' ? 'usr_200' : 'usr_100');
  const [amount, setAmount] = useState('50');
  const [referenceId, setReferenceId] = useState('');
  const [transferStatus, setTransferStatus] = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  const [sagaPolling, setSagaPolling] = useState(false);

  // Poll timer ref
  const pollIntervalRef = useRef<any>(null);

  // Generate a fresh idempotency key on mount or after transfer
  const generateNewRef = () => {
    setReferenceId(`ref-saga-${uuidv4().slice(0, 8)}`);
  };

  useEffect(() => {
    if (userId) {
      fetchBalance(userId);
      generateNewRef();
    }
  }, [userId]);

  // Saga Polling Loop
  const startSagaPolling = (sagaId: string) => {
    setSagaPolling(true);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      await fetchSagaDetails(sagaId);
    }, 1000);
  };

  // Clear polling if Saga completes or errors out
  useEffect(() => {
    if (activeSagaDetails) {
      const state = activeSagaDetails.currentState;
      if (state === 'SETTLED') {
        setTransferStatus('success');
        setSagaPolling(false);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        // Refresh balance to see final committed state
        if (userId) fetchBalance(userId);
      } else if (state === 'ROLLED_BACK' || state === 'FAILED') {
        setTransferStatus('failed');
        setSagaPolling(false);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        // Refresh balance to see refund state
        if (userId) fetchBalance(userId);
      }
    }
  }, [activeSagaDetails]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !toAccountId.trim() || !amount.trim()) return;

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return;

    setTransferStatus('running');

    const result = await executeTransfer(userId, toAccountId.trim(), amt, referenceId);
    if (result.success && result.data) {
      // Start polling Saga Orchestrator steps
      startSagaPolling(result.data.sagaId);
    } else {
      setTransferStatus('failed');
    }
  };

  // Maps saga status to visual badges
  const getSagaStateClass = (state: string) => {
    switch (state) {
      case 'SETTLED':
        return 'bg-green-500/10 border-green-500/30 text-green-400';
      case 'ROLLED_BACK':
        return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
      case 'FAILED':
        return 'bg-red-500/10 border-red-500/30 text-red-400';
      case 'COMPENSATING':
        return 'bg-rose-500/15 border-rose-500/40 text-rose-300 animate-pulse';
      default:
        return 'bg-sky-500/10 border-sky-500/30 text-sky-400 animate-pulse';
    }
  };

  const getStepStatusIcon = (status: string, stepName: string) => {
    if (status === 'SUCCESS') {
      return <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />;
    } else if (status === 'FAILED') {
      return <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />;
    } else if (status === 'COMPENSATED') {
      return <RefreshCw className="w-5 h-5 text-amber-400 flex-shrink-0 animate-spin" />;
    } else {
      return <Clock className="w-5 h-5 text-sky-400 flex-shrink-0" />;
    }
  };

  return (
    <div className="min-h-screen bg-dark-deep pb-12">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Col 1 & 2: Balance & Form */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* Balance Card */}
            <div className="glass-card p-6 glow-blue flex items-center justify-between relative overflow-hidden">
              <div className="absolute -right-4 -bottom-4 text-sky-500/5 pointer-events-none">
                <Wallet className="w-40 h-40" />
              </div>
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest block">
                  Saldo de Cuenta (gRPC)
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold text-slate-100 tracking-tight">
                    {balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-sm font-semibold text-sky-400">{currency}</span>
                </div>
                <div className="text-[10px] text-slate-500 flex items-center gap-1.5 pt-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-green-500/70" />
                  ID de Cuenta: <span className="font-mono text-slate-400 font-bold">{userId}</span>
                </div>
              </div>
              <button
                onClick={() => userId && fetchBalance(userId)}
                disabled={balanceLoading}
                className="p-3 bg-slate-800/60 hover:bg-slate-700/60 border border-dark-border text-slate-400 hover:text-slate-200 rounded-xl transition-all"
                title="Actualizar saldo"
              >
                <RefreshCw className={`w-5 h-5 ${balanceLoading ? 'animate-spin text-sky-400' : ''}`} />
              </button>
            </div>

            {/* Transfer form */}
            <div className="glass-card p-6">
              <h2 className="text-lg font-bold text-slate-200 mb-6 flex items-center gap-2">
                <Send className="w-5 h-5 text-sky-400" />
                Nueva Transferencia Asíncrona (Saga)
              </h2>

              <form onSubmit={handleTransfer} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      Cuenta Destino
                    </label>
                    <input
                      type="text"
                      value={toAccountId}
                      onChange={(e) => setToAccountId(e.target.value)}
                      placeholder="Ej. usr_200"
                      className="w-full bg-dark-deep border border-dark-border focus:border-sky-500/50 rounded-lg py-2.5 px-4 text-sm text-slate-100 outline-none transition-all"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      Monto a Transferir
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        min="0.01"
                        step="0.01"
                        className="w-full bg-dark-deep border border-dark-border focus:border-sky-500/50 rounded-lg py-2.5 px-4 text-sm text-slate-100 outline-none transition-all"
                        required
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-500 font-semibold">
                        {currency}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Idempotency Key visualization */}
                <div className="p-4 bg-slate-800/30 border border-dark-border/80 rounded-lg space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-sky-400 uppercase tracking-wider">
                    <Info className="w-4 h-4" />
                    Llave de Idempotencia (`referenceId`)
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-xs text-slate-400 select-all block break-all">
                      {referenceId}
                    </span>
                    <button
                      type="button"
                      onClick={generateNewRef}
                      className="text-xs text-slate-500 hover:text-sky-400 transition-colors flex-shrink-0 flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> Regenerar
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Garantiza exactamente un procesamiento en el balance-service. Si la transferencia se reintenta automáticamente por red, no duplicará el cargo.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-4">
                  <button
                    type="submit"
                    disabled={transferStatus === 'running' || sagaPolling}
                    className="bg-sky-500 hover:bg-sky-400 text-white rounded-lg px-6 py-2.5 font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed glow-blue"
                  >
                    {transferStatus === 'running' || sagaPolling ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Procesando Saga...
                      </>
                    ) : (
                      <>
                        Enviar Transferencia
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Col 3: Saga Steps Timeline */}
          <div className="lg:col-span-1">
            <div className="glass-card p-6 h-full flex flex-col min-h-[400px]">
              <h2 className="text-lg font-bold text-slate-200 mb-6 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-sky-400" />
                Seguimiento de Saga
              </h2>

              {!activeSagaDetails ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-dark-border rounded-xl">
                  <Send className="w-12 h-12 text-slate-600 mb-3 animate-bounce" />
                  <p className="text-sm text-slate-400 font-medium">Ninguna transacción activa</p>
                  <p className="text-xs text-slate-600 mt-1 max-w-[200px]">
                    Inicie una transferencia para ver la coreografía de la saga en tiempo real.
                  </p>
                </div>
              ) : (
                <div className="flex-grow space-y-6">
                  {/* Saga Header */}
                  <div className="p-3 bg-slate-800/40 border border-dark-border rounded-lg space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 font-mono">SAGA ID</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 border rounded-full font-mono ${getSagaStateClass(activeSagaDetails.currentState)}`}>
                        {activeSagaDetails.currentState}
                      </span>
                    </div>
                    <div className="font-mono text-xs text-slate-300 font-bold truncate">
                      {activeSagaDetails.sagaId}
                    </div>
                  </div>

                  {/* Saga Timeline Steps */}
                  <div className="space-y-6 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-[2px] before:bg-dark-border">
                    {activeSagaDetails.steps.map((step, idx) => (
                      <div key={step.id} className="flex gap-4 items-start relative pl-1">
                        <div className="w-6 h-6 rounded-full bg-dark-deep border border-dark-border flex items-center justify-center relative z-10">
                          {getStepStatusIcon(step.status, step.stepName)}
                        </div>
                        <div className="flex-1 min-w-0 bg-slate-800/20 border border-dark-border/40 p-3 rounded-lg space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-300 truncate">
                              {step.stepName}
                            </span>
                            <span className="text-[9px] text-slate-500">
                              {new Date(step.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          
                          {/* Errors / Details visualization */}
                          {step.status === 'FAILED' && step.detail?.error && (
                            <div className="text-[10px] bg-rose-500/10 border border-rose-500/20 text-rose-400 p-2 rounded block break-words">
                              {step.detail.error}
                            </div>
                          )}

                          {step.status === 'SUCCESS' && step.stepName === 'order_matched' && step.detail?.tradeId && (
                            <div className="text-[10px] text-slate-500 font-mono truncate">
                              Trade ID: {step.detail.tradeId}
                            </div>
                          )}

                          {step.status === 'COMPENSATED' && step.stepName === 'balance_reversed' && step.detail?.reversalRef && (
                            <div className="text-[10px] text-amber-500 font-mono truncate">
                              Reversal Ref: {step.detail.reversalRef}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Pending state placeholder indicator */}
                    {sagaPolling && (
                      <div className="flex gap-4 items-center pl-1">
                        <div className="w-6 h-6 rounded-full bg-dark-deep border border-dark-border flex items-center justify-center relative z-10">
                          <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
                        </div>
                        <span className="text-xs text-sky-400 animate-pulse">Esperando siguiente evento de Kafka...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};
