import { create } from 'zustand';
import { apiClient } from '../api/client';
import { Order, OrderBook } from '../types/types';

interface OrdersState {
  orderBook: OrderBook;
  loading: boolean;
  error: string | null;
  fetchOrderBook: () => Promise<void>;
  submitOrder: (order: Omit<Order, 'id'>) => Promise<boolean>;
}

export const useOrdersStore = create<OrdersState>((set) => ({
  orderBook: { bids: [], asks: [] },
  loading: false,
  error: null,

  fetchOrderBook: async () => {
    try {
      // API Gateway maps GET /api/matching/book -> matching-service:8082/book
      const res = await apiClient.get<OrderBook>('/api/matching/book');
      set({ orderBook: res.data });
    } catch (err: any) {
      console.error('Error fetching order book:', err);
      set({ error: err.message || 'Failed to fetch order book' });
    }
  },

  submitOrder: async (order) => {
    set({ loading: true, error: null });
    try {
      // Generate a temporary order ID for UI matching (or let backend assign it)
      const orderId = `ORD-UI-${Date.now().toString().slice(-6)}`;
      
      // API Gateway maps POST /api/matching/orders -> matching-service:8082/orders
      await apiClient.post('/api/matching/orders', {
        id: orderId,
        accountId: order.accountId,
        type: order.type,
        price: order.price,
        quantity: order.quantity
      });
      
      set({ loading: false });
      // Refresh order book immediately
      await useOrdersStore.getState().fetchOrderBook();
      return true;
    } catch (err: any) {
      console.error('Error submitting order:', err);
      set({ 
        error: err.response?.data?.error || err.message || 'Failed to submit order',
        loading: false 
      });
      return false;
    }
  }
}));
