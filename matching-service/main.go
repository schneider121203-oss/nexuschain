package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/segmentio/kafka-go"
)

type OrderType string

const (
	Buy  OrderType = "BUY"
	Sell OrderType = "SELL"
)

type Order struct {
	ID        string    `json:"id"`
	AccountID string    `json:"accountId"`
	Type      OrderType `json:"type"`
	Price     float64   `json:"price"`
	Quantity  float64   `json:"quantity"`
}

type Trade struct {
	TradeID         string    `json:"tradeId"`
	BuyerAccountID  string    `json:"buyerAccountId"`
	SellerAccountID string    `json:"sellerAccountId"`
	Price           float64   `json:"price"`
	Quantity        float64   `json:"quantity"`
	Timestamp       time.Time `json:"timestamp"`
}

type OrderBook struct {
	mu   sync.Mutex
	Bids []*Order
	Asks []*Order
}

var (
	book        = &OrderBook{Bids: make([]*Order, 0), Asks: make([]*Order, 0)}
	kafkaWriter *kafka.Writer
)

func initKafka() {
	broker := os.Getenv("KAFKA_BROKER")
	if broker == "" {
		broker = "localhost:29092"
	}
	kafkaWriter = &kafka.Writer{
		Addr:     kafka.TCP(broker),
		Topic:    "transactions-topic",
		Balancer: &kafka.LeastBytes{},
	}
	log.Printf("📢 Kafka Writer configured to send trades to transactions-topic via broker %s\n", broker)
}

func publishTrade(trade Trade) {
	bytes, err := json.Marshal(trade)
	if err != nil {
		log.Printf("❌ Failed to serialize trade: %v\n", err)
		return
	}

	err = kafkaWriter.WriteMessages(context.Background(),
		kafka.Message{
			Key:   []byte(trade.TradeID),
			Value: bytes,
		},
	)
	if err != nil {
		log.Printf("❌ Failed to write trade to Kafka: %v\n", err)
		return
	}
	log.Printf("🎉 Trade published to Kafka: %+v\n", trade)
}

// AddOrder handles incoming orders, runs matching, and adds remaining to book
func (ob *OrderBook) AddOrder(order *Order) {
	ob.mu.Lock()
	defer ob.mu.Unlock()

	log.Printf("📥 Incoming Order: %s | Account: %s | Type: %s | Px: %.2f | Qty: %.2f\n",
		order.ID, order.AccountID, order.Type, order.Price, order.Quantity)

	if order.Type == Buy {
		ob.matchBuy(order)
	} else {
		ob.matchSell(order)
	}
}

func (ob *OrderBook) matchBuy(buyOrder *Order) {
	// Sort Asks ascending (lowest price first)
	sort.Slice(ob.Asks, func(i, j int) bool {
		return ob.Asks[i].Price < ob.Asks[j].Price
	})

	for len(ob.Asks) > 0 && buyOrder.Quantity > 0 {
		bestAsk := ob.Asks[0]
		if buyOrder.Price >= bestAsk.Price {
			// Match found!
			matchQty := buyOrder.Quantity
			if bestAsk.Quantity < matchQty {
				matchQty = bestAsk.Quantity
			}

			trade := Trade{
				TradeID:         fmt.Sprintf("TRD-%d", time.Now().UnixNano()),
				BuyerAccountID:  buyOrder.AccountID,
				SellerAccountID: bestAsk.AccountID,
				Price:           bestAsk.Price, // Trade happens at the limit price of the resting order
				Quantity:        matchQty,
				Timestamp:       time.Now(),
			}

			buyOrder.Quantity -= matchQty
			bestAsk.Quantity -= matchQty

			go publishTrade(trade)

			if bestAsk.Quantity == 0 {
				ob.Asks = ob.Asks[1:]
			}
		} else {
			break
		}
	}

	if buyOrder.Quantity > 0 {
		ob.Bids = append(ob.Bids, buyOrder)
		// Sort Bids descending (highest price first)
		sort.Slice(ob.Bids, func(i, j int) bool {
			return ob.Bids[i].Price > ob.Bids[j].Price
		})
	}
}

func (ob *OrderBook) matchSell(sellOrder *Order) {
	// Sort Bids descending (highest price first)
	sort.Slice(ob.Bids, func(i, j int) bool {
		return ob.Bids[i].Price > ob.Bids[j].Price
	})

	for len(ob.Bids) > 0 && sellOrder.Quantity > 0 {
		bestBid := ob.Bids[0]
		if sellOrder.Price <= bestBid.Price {
			// Match found!
			matchQty := sellOrder.Quantity
			if bestBid.Quantity < matchQty {
				matchQty = bestBid.Quantity
			}

			trade := Trade{
				TradeID:         fmt.Sprintf("TRD-%d", time.Now().UnixNano()),
				BuyerAccountID:  bestBid.AccountID,
				SellerAccountID: sellOrder.AccountID,
				Price:           bestBid.Price,
				Quantity:        matchQty,
				Timestamp:       time.Now(),
			}

			sellOrder.Quantity -= matchQty
			bestBid.Quantity -= matchQty

			go publishTrade(trade)

			if bestBid.Quantity == 0 {
				ob.Bids = ob.Bids[1:]
			}
		} else {
			break
		}
	}

	if sellOrder.Quantity > 0 {
		ob.Asks = append(ob.Asks, sellOrder)
		// Sort Asks ascending (lowest price first)
		sort.Slice(ob.Asks, func(i, j int) bool {
			return ob.Asks[i].Price < ob.Asks[j].Price
		})
	}
}

func orderHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var order Order
	err := json.NewDecoder(r.Body).Decode(&order)
	if err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	if order.ID == "" || order.AccountID == "" || order.Price <= 0 || order.Quantity <= 0 {
		http.Error(w, "Missing fields or invalid numbers", http.StatusBadRequest)
		return
	}

	book.AddOrder(&order)

	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte(`{"status":"Order accepted and processing"}`))
}

func bookHandler(w http.ResponseWriter, r *http.Request) {
	book.mu.Lock()
	defer book.mu.Unlock()

	response := map[string]interface{}{
		"bids": book.Bids,
		"asks": book.Asks,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func main() {
	initKafka()
	defer kafkaWriter.Close()

	http.HandleFunc("/orders", orderHandler)
	http.HandleFunc("/book", bookHandler)

	port := ":8082"
	log.Printf("🤝 Matching Service starting on port %s\n", port)
	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatalf("Failed to start server: %v\n", err)
	}
}
