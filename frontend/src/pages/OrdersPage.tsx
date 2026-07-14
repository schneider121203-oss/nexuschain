import React, { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useOrdersStore } from '../store/ordersStore';
import { Navbar } from '../components/common/Navbar';
import { 
  BarChart2, 
  ArrowDownCircle, 
  ArrowUpCircle, 
  TrendingUp, 
  TrendingDown, 
  Loader2, 
  RefreshCw,
  Plus
} from 'lucide-react';

export const OrdersPage: React.FC = () => {
  const { userId } = useAuthStore();
  const { orderBook, fetchOrderBook, submitOrder, loading } = useOrdersStore();
  
  const [type, setType] = useState<'BUY' | 'SELL'>('BUY');
  const [price, setPrice] = useState('100');
  const [quantity, setQuantity] = useState('1');
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const pollIntervalRef = useRef<any>(null);

  useEffect(() => {
    fetchOrderBook();
    // Poll order book every 3 seconds to show live updates
    pollIntervalRef.current = setInterval(() => {
      fetchOrderBook();
    }, 3000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    const prc = parseFloat(price);
    const qty = parseFloat(quantity);

    if (isNaN(prc) || prc <= 0 || isNaN(qty) || qty <= 0) {
      setMessage({ type: 'error', text: 'Monto y cantidad deben ser positivos.' });
      return;
    }

    setMessage(null);
    const success = await submitOrder({
      accountId: userId,
      type,
      price: prc,
      quantity: qty
    });

    if (success) {
      setMessage({ type: 'success', text: 'Orden aceptada y en proceso de matching.' });
      setQuantity('1');
    } else {
      setMessage({ type: 'error', text: 'Error al enviar la orden al matching engine.' });
    }
  };

  return (
    <div className="min-h-screen bg-dark-deep pb-12">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Col 1: Order Placement Form */}
          <div className="lg:col-span-1">
            <div className="glass-card p-6">
              <h2 className="text-lg font-bold text-slate-200 mb-6 flex items-center gap-2">
                <Plus className="w-5 h-5 text-sky-400" />
                Nueva Orden Regular
              </h2>

              {message && (
                <div className={`p-3 rounded-lg text-xs mb-4 border ${
                  message.type === 'success' 
                    ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                }`}>
                  {message.text}
                </div>
              )}

              <form onSubmit={handlePlaceOrder} className="space-y-5">
                {/* Type toggle */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    Tipo de Orden
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setType('BUY')}
                      className={`py-2 px-4 rounded-lg font-bold text-xs border tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                        type === 'BUY'
                          ? 'bg-green-500/20 border-green-500/40 text-green-400 glow-green'
                          : 'bg-dark-deep border-dark-border text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <ArrowUpCircle className="w-4 h-4" />
                      COMPRA
                    </button>
                    <button
                      type="button"
                      onClick={() => setType('SELL')}
                      className={`py-2 px-4 rounded-lg font-bold text-xs border tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                        type === 'SELL'
                          ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                          : 'bg-dark-deep border-dark-border text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <ArrowDownCircle className="w-4 h-4" />
                      VENTA
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    Precio Límite
                  </label>
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    min="0.01"
                    step="0.01"
                    className="w-full bg-dark-deep border border-dark-border focus:border-sky-500/50 rounded-lg py-2.5 px-4 text-sm text-slate-100 outline-none transition-all"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    Cantidad
                  </label>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    min="0.01"
                    step="0.01"
                    className="w-full bg-dark-deep border border-dark-border focus:border-sky-500/50 rounded-lg py-2.5 px-4 text-sm text-slate-100 outline-none transition-all"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full text-white font-semibold text-sm rounded-lg py-2.5 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                    type === 'BUY'
                      ? 'bg-green-600 hover:bg-green-500 glow-green'
                      : 'bg-rose-600 hover:bg-rose-500'
                  }`}
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    `Colocar Orden ${type === 'BUY' ? 'de Compra' : 'de Venta'}`
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* Col 2 & 3: Order Book lists */}
          <div className="lg:col-span-2">
            <div className="glass-card p-6 h-full flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                  <BarChart2 className="w-5 h-5 text-sky-400" />
                  Libro de Órdenes (Matching Engine)
                </h2>
                <button
                  onClick={fetchOrderBook}
                  className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
                  title="Refrescar"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-grow">
                {/* Bids (Compras) */}
                <div className="border border-dark-border/60 bg-dark-deep/40 rounded-xl p-4 flex flex-col h-[400px]">
                  <div className="flex items-center gap-2 text-green-400 font-bold text-sm border-b border-dark-border pb-3 mb-3">
                    <TrendingUp className="w-4 h-4" />
                    BIDS (Compras)
                  </div>
                  
                  <div className="flex-grow overflow-y-auto space-y-2 pr-1">
                    {orderBook.bids.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-slate-600 text-xs font-medium">
                        No hay ofertas de compra activas
                      </div>
                    ) : (
                      orderBook.bids.map((bid, i) => (
                        <div key={bid.id || i} className="flex justify-between items-center text-xs p-2 bg-green-500/5 border border-green-500/10 rounded-lg">
                          <span className="font-mono text-slate-400">{bid.accountId}</span>
                          <div className="space-x-4">
                            <span className="text-slate-500">Cant: <strong className="text-slate-300">{bid.quantity}</strong></span>
                            <span className="text-green-400 font-bold">Px: ${bid.price}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Asks (Ventas) */}
                <div className="border border-dark-border/60 bg-dark-deep/40 rounded-xl p-4 flex flex-col h-[400px]">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-sm border-b border-dark-border pb-3 mb-3">
                    <TrendingDown className="w-4 h-4" />
                    ASKS (Ventas)
                  </div>
                  
                  <div className="flex-grow overflow-y-auto space-y-2 pr-1">
                    {orderBook.asks.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-slate-600 text-xs font-medium">
                        No hay ofertas de venta activas
                      </div>
                    ) : (
                      orderBook.asks.map((ask, i) => (
                        <div key={ask.id || i} className="flex justify-between items-center text-xs p-2 bg-rose-500/5 border border-rose-500/10 rounded-lg">
                          <span className="font-mono text-slate-400">{ask.accountId}</span>
                          <div className="space-x-4">
                            <span className="text-slate-500">Cant: <strong className="text-slate-300">{ask.quantity}</strong></span>
                            <span className="text-rose-400 font-bold">Px: ${ask.price}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};
