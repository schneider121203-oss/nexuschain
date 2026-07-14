package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
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

	// DLQ config
	maxRetries    = 3
	baseRetryWait = 1 * time.Second
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
	// SagaID is set when the trade originates from a saga command (optional)
	SagaID string `json:"sagaId,omitempty"`
}

// DLQMessage wraps a failed trade event with error metadata for post-mortem analysis.
type DLQMessage struct {
	OriginalTopic string    `json:"originalTopic"`
	TradeID       string    `json:"tradeId"`
	OriginalEvent Trade     `json:"originalEvent"`
	ErrorMessage  string    `json:"errorMessage"`
	RetryCount    int       `json:"retryCount"`
	FailedAt      time.Time `json:"failedAt"`
}

// SagaCommand is a command from the Saga Orchestrator directing this service.
type SagaCommand struct {
	Type          string      `json:"type"`
	SagaID        string      `json:"sagaId"`
	TransactionID string      `json:"transactionId"`
	Payload       SagaPayload `json:"payload"`
	IssuedAt      string      `json:"issuedAt"`
}

type SagaPayload struct {
	FromAccountID string  `json:"fromAccountId"`
	ToAccountID   string  `json:"toAccountId"`
	Amount        float64 `json:"amount"`
	ReferenceID   string  `json:"referenceId"`
	OrderID       string  `json:"orderId,omitempty"`
}

// SagaEvent is published back to the Saga Orchestrator after processing a command.
type SagaEvent struct {
	Type          string                 `json:"type"`
	SagaID        string                 `json:"sagaId"`
	TransactionID string                 `json:"transactionId"`
	Detail        map[string]interface{} `json:"detail"`
	OccurredAt    string                 `json:"occurredAt"`
}

type OrderBook struct {
	mu   sync.Mutex
	Bids []*Order
	Asks []*Order
}

var (
	book            = &OrderBook{Bids: make([]*Order, 0), Asks: make([]*Order, 0)}
	kafkaWriter     *kafka.Writer
	dlqWriter       *kafka.Writer
	sagaEventsWriter *kafka.Writer
)

func initKafka() {
	broker := os.Getenv("KAFKA_BROKER")
	if broker == "" {
		broker = "localhost:29092"
	}

	// Primary topic writer — matched trades go here for transaction-history
	kafkaWriter = &kafka.Writer{
		Addr:                   kafka.TCP(broker),
		Topic:                  "transactions-topic",
		Balancer:               &kafka.LeastBytes{},
		AllowAutoTopicCreation: true,
	}

	// Dead Letter Queue writer
	dlqWriter = &kafka.Writer{
		Addr:                   kafka.TCP(broker),
		Topic:                  "transactions-topic.dlq",
		Balancer:               &kafka.LeastBytes{},
		AllowAutoTopicCreation: true,
	}

	// Saga events writer — results published back to the Saga Orchestrator
	sagaEventsWriter = &kafka.Writer{
		Addr:                   kafka.TCP(broker),
		Topic:                  "saga.events",
		Balancer:               &kafka.LeastBytes{},
		AllowAutoTopicCreation: true,
	}

	log.Printf("📢 Kafka writers initialized — primary: transactions-topic | DLQ: transactions-topic.dlq | saga events: saga.events (broker: %s)\n", broker)

	// Start saga commands consumer in background
	go consumeSagaCommands(broker)
}

// ─────────────────────────────────────────────────────────────────────────────
// Saga Commands Consumer
// ─────────────────────────────────────────────────────────────────────────────

// consumeSagaCommands listens for SUBMIT_ORDER commands from the Saga Orchestrator.
// When a command arrives, it creates a synthetic order and submits it to the order book.
// After matching (or failing), it publishes ORDER_MATCHED or ORDER_FAILED back to saga.events.
//
// This is the integration point between the Saga Orchestrator and the Matching Engine.
func consumeSagaCommands(broker string) {
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:  []string{broker},
		Topic:    "saga.commands",
		GroupID:  "matching-service-saga-group",
		MaxBytes: 10e6, // 10MB
	})
	defer reader.Close()

	log.Printf("👂 Matching Service: subscribed to saga.commands\n")

	for {
		msg, err := reader.ReadMessage(context.Background())
		if err != nil {
			log.Printf("❌ Error reading from saga.commands: %v\n", err)
			time.Sleep(2 * time.Second)
			continue
		}

		var cmd SagaCommand
		if err := json.Unmarshal(msg.Value, &cmd); err != nil {
			log.Printf("❌ Malformed saga command — skipping: %v\n", err)
			continue
		}

		if cmd.Type != "SUBMIT_ORDER" {
			log.Printf("⚠️  Unknown saga command type '%s' — skipping\n", cmd.Type)
			continue
		}

		log.Printf("📥 Saga command received [%s] sagaId=%s\n", cmd.Type, cmd.SagaID)
		processSagaOrder(cmd)
	}
}

// processSagaOrder creates a BUY order from the saga payload and submits it to the order book.
// The saga represents a transfer that is being "traded" — the amount is treated as both price and quantity=1.
// In a real exchange this would be more complex; for the academic project this demonstrates the integration.
func processSagaOrder(cmd SagaCommand) {
	orderId := cmd.Payload.OrderID
	if orderId == "" {
		orderId = fmt.Sprintf("SAGA-ORD-%s", cmd.SagaID[:8])
	}

	// Create a synthetic limit order: the transfer amount is the "price" for 1 unit
	// This simulates the matching of a financial transfer as an exchange order
	order := &Order{
		ID:        orderId,
		AccountID: cmd.Payload.FromAccountID,
		Type:      Buy,
		Price:     cmd.Payload.Amount,
		Quantity:  1.0,
	}

	log.Printf("🤝 Saga %s: submitting order %s to matching engine\n", cmd.SagaID, orderId)

	// Add a corresponding SELL order so there's always a match (for demo purposes)
	// In production, the seller would submit their own order independently
	sellOrder := &Order{
		ID:        orderId + "-SELL",
		AccountID: cmd.Payload.ToAccountID,
		Type:      Sell,
		Price:     cmd.Payload.Amount,
		Quantity:  1.0,
	}

	// Submit the SELL side first (so the BUY matches immediately)
	book.AddOrder(sellOrder)

	// Now submit the BUY — this will trigger the match
	book.mu.Lock()
	// Check if there's a matching sell for this saga order
	matched := false
	trade := Trade{}

	sort.Slice(book.Asks, func(i, j int) bool { return book.Asks[i].Price < book.Asks[j].Price })

	for i, ask := range book.Asks {
		if ask.ID == orderId+"-SELL" && order.Price >= ask.Price {
			trade = Trade{
				TradeID:         fmt.Sprintf("TRD-SAGA-%d", time.Now().UnixNano()),
				BuyerAccountID:  order.AccountID,
				SellerAccountID: ask.AccountID,
				Price:           ask.Price,
				Quantity:        1.0,
				Timestamp:       time.Now(),
				SagaID:          cmd.SagaID,
			}
			// Remove matched ask from book
			book.Asks = append(book.Asks[:i], book.Asks[i+1:]...)
			matched = true
			break
		}
	}
	book.mu.Unlock()

	if matched {
		// Publish trade to transactions-topic (for transaction-history to persist in Cassandra)
		// Includes sagaId so transaction-history can publish HISTORY_RECORDED event
		go publishTrade(trade)

		// Immediately publish ORDER_MATCHED event back to Saga Orchestrator
		publishSagaEvent(SagaEvent{
			Type:          "ORDER_MATCHED",
			SagaID:        cmd.SagaID,
			TransactionID: cmd.TransactionID,
			Detail: map[string]interface{}{
				"tradeId": trade.TradeID,
				"orderId": orderId,
				"price":   trade.Price,
			},
			OccurredAt: time.Now().Format(time.RFC3339),
		})
	} else {
		// Could not match — publish ORDER_FAILED so orchestrator can compensate
		publishSagaEvent(SagaEvent{
			Type:          "ORDER_FAILED",
			SagaID:        cmd.SagaID,
			TransactionID: cmd.TransactionID,
			Detail: map[string]interface{}{
				"orderId": orderId,
				"reason":  "No matching sell order found in order book",
			},
			OccurredAt: time.Now().Format(time.RFC3339),
		})
		log.Printf("❌ Saga %s: order %s could not be matched — ORDER_FAILED published\n", cmd.SagaID, orderId)
	}
}

// publishSagaEvent sends an event to the saga.events topic.
func publishSagaEvent(event SagaEvent) {
	bytes, err := json.Marshal(event)
	if err != nil {
		log.Printf("❌ Failed to serialize saga event: %v\n", err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := sagaEventsWriter.WriteMessages(ctx, kafka.Message{
		Key:   []byte(event.SagaID),
		Value: bytes,
	}); err != nil {
		log.Printf("❌ Failed to publish saga event [%s] for saga %s: %v\n", event.Type, event.SagaID, err)
	} else {
		log.Printf("📤 Saga event [%s] published for saga %s\n", event.Type, event.SagaID)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Trade publishing (unchanged logic from DLQ implementation)
// ─────────────────────────────────────────────────────────────────────────────

func publishTrade(trade Trade) {
	bytes, err := json.Marshal(trade)
	if err != nil {
		log.Printf("❌ Failed to serialize trade %s: %v\n", trade.TradeID, err)
		publishToDLQ(trade, fmt.Sprintf("serialization error: %v", err), 0)
		return
	}

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			waitDuration := time.Duration(math.Pow(2, float64(attempt-1))) * baseRetryWait
			log.Printf("⏳ Retry %d/%d for trade %s — waiting %v\n", attempt, maxRetries-1, trade.TradeID, waitDuration)
			time.Sleep(waitDuration)
		}

		lastErr = kafkaWriter.WriteMessages(context.Background(),
			kafka.Message{
				Key:   []byte(trade.TradeID),
				Value: bytes,
			},
		)

		if lastErr == nil {
			log.Printf("🎉 Trade %s published to Kafka (attempt %d)\n", trade.TradeID, attempt+1)
			return
		}

		log.Printf("⚠️  Failed to publish trade %s (attempt %d/%d): %v\n",
			trade.TradeID, attempt+1, maxRetries, lastErr)
	}

	log.Printf("🚨 All %d retries exhausted for trade %s — sending to DLQ\n", maxRetries, trade.TradeID)
	publishToDLQ(trade, fmt.Sprintf("kafka write failed after %d retries: %v", maxRetries, lastErr), maxRetries)
}

func publishToDLQ(trade Trade, errMsg string, retryCount int) {
	dlqMsg := DLQMessage{
		OriginalTopic: "transactions-topic",
		TradeID:       trade.TradeID,
		OriginalEvent: trade,
		ErrorMessage:  errMsg,
		RetryCount:    retryCount,
		FailedAt:      time.Now(),
	}

	dlqBytes, err := json.Marshal(dlqMsg)
	if err != nil {
		log.Printf("❌ CRITICAL: Failed to serialize DLQ message for trade %s: %v\n", trade.TradeID, err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := dlqWriter.WriteMessages(ctx, kafka.Message{
		Key:   []byte(trade.TradeID),
		Value: dlqBytes,
	}); err != nil {
		log.Printf("❌ CRITICAL: Failed to write to DLQ for trade %s: %v\n", trade.TradeID, err)
	} else {
		log.Printf("📬 Trade %s sent to DLQ (retries: %d, reason: %s)\n", trade.TradeID, retryCount, errMsg)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Order Book (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

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
	sort.Slice(ob.Asks, func(i, j int) bool { return ob.Asks[i].Price < ob.Asks[j].Price })

	for len(ob.Asks) > 0 && buyOrder.Quantity > 0 {
		bestAsk := ob.Asks[0]
		if buyOrder.Price >= bestAsk.Price {
			matchQty := buyOrder.Quantity
			if bestAsk.Quantity < matchQty {
				matchQty = bestAsk.Quantity
			}
			trade := Trade{
				TradeID:         fmt.Sprintf("TRD-%d", time.Now().UnixNano()),
				BuyerAccountID:  buyOrder.AccountID,
				SellerAccountID: bestAsk.AccountID,
				Price:           bestAsk.Price,
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
		sort.Slice(ob.Bids, func(i, j int) bool { return ob.Bids[i].Price > ob.Bids[j].Price })
	}
}

func (ob *OrderBook) matchSell(sellOrder *Order) {
	sort.Slice(ob.Bids, func(i, j int) bool { return ob.Bids[i].Price > ob.Bids[j].Price })

	for len(ob.Bids) > 0 && sellOrder.Quantity > 0 {
		bestBid := ob.Bids[0]
		if sellOrder.Price <= bestBid.Price {
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
		sort.Slice(ob.Asks, func(i, j int) bool { return ob.Asks[i].Price < ob.Asks[j].Price })
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Handlers (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

func orderHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var order Order
	if err := json.NewDecoder(r.Body).Decode(&order); err != nil {
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
	response := map[string]interface{}{"bids": book.Bids, "asks": book.Asks}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func main() {
	initKafka()
	defer kafkaWriter.Close()
	defer dlqWriter.Close()
	defer sagaEventsWriter.Close()

	http.HandleFunc("/orders", orderHandler)
	http.HandleFunc("/book", bookHandler)

	port := ":8082"
	log.Printf("🤝 Matching Service starting on port %s\n", port)
	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatalf("Failed to start server: %v\n", err)
	}
}
