import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { apiClient } from '../api/client';
import { Transaction } from '../types/types';
import { Navbar } from '../components/common/Navbar';
import { 
  History, 
  ArrowUpRight, 
  ArrowDownLeft, 
  RefreshCw, 
  AlertCircle,
  Database,
  Calendar,
  DollarSign
} from 'lucide-react';

export const HistoryPage: React.FC = () => {
  const { userId } = useAuthStore();
  const [trades, setTrades] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      // Calls API Gateway: GET /api/history/:accountId -> transaction-history:8085
      const res = await apiClient.get<{ items: Transaction[] }>(`/api/history/${userId}`);
      setTrades(res.data.items || []);
    } catch (err: any) {
      console.error('Failed to fetch trades history:', err);
      setError(
        err.response?.data?.error || 
        err.message || 
        'Error al obtener historial desde Cassandra'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [userId]);

  return (
    <div className="min-h-screen bg-dark-deep pb-12">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        <div className="space-y-6">
          
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2 m-0 p-0">
                <History className="w-6 h-6 text-sky-400" />
                Historial de Transacciones
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Auditoría inmutable leída de forma asíncrona desde **Apache Cassandra**.
              </p>
            </div>
            
            <button
              onClick={fetchHistory}
              disabled={loading}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-dark-border rounded-lg px-4 py-2 text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
              Sincronizar
            </button>
          </div>

          {/* Cassandra Notice Box */}
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3">
            <Database className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider block">
                Consistencia Eventual Explicitada
              </span>
              <p className="text-xs text-slate-400">
                Esta pantalla consulta una base de datos Cassandra replicada asíncronamente mediante Kafka. Los nuevos trades pueden tardar unos segundos en aparecer. Esto demuestra las implicaciones prácticas de consistencia en el teorema CAP.
              </p>
            </div>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs flex items-center gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Trades Table */}
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-dark-border bg-slate-800/20 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="py-4 px-6">Dirección</th>
                    <th className="py-4 px-6">ID de Trade</th>
                    <th className="py-4 px-6">Contraparte</th>
                    <th className="py-4 px-6">Monto / Cantidad</th>
                    <th className="py-4 px-6">Fecha y Hora</th>
                    <th className="py-4 px-6">Saga ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-border/40 text-sm">
                  {trades.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-500 font-medium bg-dark-card/20">
                        {loading ? 'Consultando Cassandra...' : 'No se encontraron registros para esta cuenta.'}
                      </td>
                    </tr>
                  ) : (
                    trades.map((trade) => {
                      const isBuyer = trade.buyerAccountId === userId;
                      const counterparty = isBuyer ? trade.sellerAccountId : trade.buyerAccountId;
                      
                      return (
                        <tr key={trade.tradeId} className="hover:bg-slate-800/10 transition-colors">
                          {/* Direction badge */}
                          <td className="py-4 px-6">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 border rounded-full text-xs font-semibold ${
                              isBuyer 
                                ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                                : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                            }`}>
                              {isBuyer ? (
                                <>
                                  <ArrowDownLeft className="w-3.5 h-3.5" />
                                  COMPRA
                                </>
                              ) : (
                                <>
                                  <ArrowUpRight className="w-3.5 h-3.5" />
                                  VENTA
                                </>
                              )}
                            </span>
                          </td>

                          {/* Trade ID */}
                          <td className="py-4 px-6 font-mono text-xs text-slate-400 font-bold">
                            {trade.tradeId}
                          </td>

                          {/* Counterparty */}
                          <td className="py-4 px-6 font-mono text-xs text-slate-300">
                            {counterparty}
                          </td>

                          {/* Price & Quantity */}
                          <td className="py-4 px-6">
                            <div className="font-semibold text-slate-200">
                              ${trade.price * trade.quantity} {trade.price * trade.quantity > 0 ? 'USD' : ''}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {trade.quantity} unidades @ ${trade.price}
                            </div>
                          </td>

                          {/* Timestamp */}
                          <td className="py-4 px-6 text-xs text-slate-400">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-slate-600" />
                              {new Date(trade.timestamp).toLocaleString()}
                            </div>
                          </td>

                          {/* Saga ID */}
                          <td className="py-4 px-6">
                            {trade.sagaId ? (
                              <span className="font-mono text-[10px] text-sky-400 bg-sky-500/5 px-2 py-0.5 border border-sky-500/10 rounded">
                                {trade.sagaId.slice(0, 8)}...
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-600 italic">
                                Directo gRPC
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};
