const { Kafka } = require('kafkajs');
const cassandra = require('cassandra-driver');
require('dotenv').config();

const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');
const cassandraContactPoints = (process.env.CASSANDRA_CONTACT_POINTS || 'localhost').split(',');
const cassandraLocalDataCenter = process.env.CASSANDRA_LOCAL_DATA_CENTER || 'datacenter1';
const keyspace = process.env.CASSANDRA_KEYSPACE || 'nexuschain';

// DLQ config
const MAX_RETRIES = 3;
const BASE_RETRY_WAIT_MS = 1000;

// 1. Initialize Cassandra Client
const cassandraClient = new cassandra.Client({
  contactPoints: cassandraContactPoints,
  localDataCenter: cassandraLocalDataCenter
});

async function setupCassandra() {
  try {
    await cassandraClient.connect();
    console.log('🔌 Connected to Cassandra cluster');

    await cassandraClient.execute(`
      CREATE KEYSPACE IF NOT EXISTS ${keyspace} 
      WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
    `);
    console.log(`🗃️ Keyspace '${keyspace}' verified/created`);

    // Add saga_id column to support saga event correlation
    await cassandraClient.execute(`
      CREATE TABLE IF NOT EXISTS ${keyspace}.trades (
        trade_id text,
        buyer_account_id text,
        seller_account_id text,
        price double,
        quantity double,
        timestamp timestamp,
        saga_id text,
        PRIMARY KEY (trade_id)
      );
    `);
    console.log(`📋 Table '${keyspace}.trades' verified/created`);

    // Dynamic schema evolution: alter table to add saga_id if the table pre-existed without it
    await cassandraClient.execute(`
      ALTER TABLE ${keyspace}.trades ADD IF NOT EXISTS saga_id text;
    `);
    console.log(`📋 Schema evolved: Column 'saga_id' verified/added to '${keyspace}.trades'`);
  } catch (err) {
    console.error('❌ Cassandra initialization failed:', err);
    process.exit(1);
  }
}

// 2. Initialize Kafka — consumer + DLQ producer + saga events producer
const kafka = new Kafka({
  clientId: 'transaction-history-recorder',
  brokers: kafkaBrokers,
  retry: { retries: 3 }
});

const consumer = kafka.consumer({ groupId: 'cassandra-recorder-group' });

/**
 * DLQ producer — sends failed events to transactions-topic.dlq
 */
const dlqProducer = kafka.producer();

/**
 * Saga events producer — notifies the Saga Orchestrator when a trade has been
 * persisted in Cassandra (HISTORY_RECORDED) or if the persistence fails (HISTORY_FAILED).
 *
 * This closes the saga loop:
 *   Saga Orchestrator → (SUBMIT_ORDER) → Matching Service
 *   Matching Service  → (ORDER_MATCHED) → Saga Orchestrator
 *   Saga Orchestrator → waits for HISTORY_RECORDED to transition to SETTLED
 *   Transaction History → (HISTORY_RECORDED) → Saga Orchestrator ← this service
 */
const sagaEventsProducer = kafka.producer();

/**
 * Publishes a HISTORY_RECORDED or HISTORY_FAILED event to saga.events
 * only if the trade is associated with a saga (sagaId is present).
 */
async function publishSagaHistoryEvent(trade, success, errorMessage) {
  if (!trade.sagaId) {
    return; // Regular trade (not saga-originated) — no event needed
  }

  const event = {
    type:          success ? 'HISTORY_RECORDED' : 'HISTORY_FAILED',
    sagaId:        trade.sagaId,
    transactionId: trade.tradeId,
    detail: success
      ? { tradeId: trade.tradeId, persistedAt: new Date().toISOString() }
      : { tradeId: trade.tradeId, error: errorMessage },
    occurredAt: new Date().toISOString()
  };

  try {
    await sagaEventsProducer.send({
      topic: 'saga.events',
      messages: [{ key: trade.sagaId, value: JSON.stringify(event) }]
    });
    console.log(`📤 Saga event [${event.type}] published for saga ${trade.sagaId}`);
  } catch (err) {
    console.error(`❌ Failed to publish saga event for trade ${trade.tradeId}:`, err.message);
  }
}

async function publishToDLQ(originalTrade, errorMessage, retryCount) {
  const dlqMessage = {
    originalTopic: 'transactions-topic',
    tradeId:       originalTrade?.tradeId || 'unknown',
    originalEvent: originalTrade,
    errorMessage,
    retryCount,
    failedAt:      new Date().toISOString()
  };

  try {
    await dlqProducer.send({
      topic: 'transactions-topic.dlq',
      messages: [{ key: dlqMessage.tradeId, value: JSON.stringify(dlqMessage) }]
    });
    console.log(`📬 Event for trade '${dlqMessage.tradeId}' sent to DLQ (retries: ${retryCount})`);
  } catch (dlqErr) {
    console.error(`❌ CRITICAL: Failed to write to DLQ for trade '${dlqMessage.tradeId}':`, dlqErr);
  }
}

/**
 * Attempts to persist a trade in Cassandra with exponential-backoff retries.
 * On success: publishes HISTORY_RECORDED to saga.events (if saga-originated).
 * On exhaustion: publishes HISTORY_FAILED + sends to DLQ.
 */
async function persistTradeWithRetry(trade, rawValue) {
  const query = `
    INSERT INTO ${keyspace}.trades (trade_id, buyer_account_id, seller_account_id, price, quantity, timestamp, saga_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    trade.tradeId,
    trade.buyerAccountId,
    trade.sellerAccountId,
    Number(trade.price),
    Number(trade.quantity),
    new Date(trade.timestamp),
    trade.sagaId || null
  ];

  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const waitMs = BASE_RETRY_WAIT_MS * Math.pow(2, attempt - 1);
      console.log(`⏳ Retry ${attempt}/${MAX_RETRIES - 1} for trade ${trade.tradeId} — waiting ${waitMs}ms`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    try {
      await cassandraClient.execute(query, params, { prepare: true });
      console.log(`💾 Trade ${trade.tradeId} persisted in Cassandra (attempt ${attempt + 1})`);

      // Notify Saga Orchestrator that this trade has been durably recorded
      await publishSagaHistoryEvent(trade, true, null);
      return;
    } catch (err) {
      lastError = err;
      console.warn(`⚠️  Cassandra write failed for trade ${trade.tradeId} (attempt ${attempt + 1}/${MAX_RETRIES}):`, err.message);
    }
  }

  // All retries exhausted
  console.error(`🚨 All ${MAX_RETRIES} retries exhausted for trade ${trade.tradeId} — sending to DLQ`);
  await publishToDLQ(trade, `Cassandra write failed after ${MAX_RETRIES} retries: ${lastError?.message}`, MAX_RETRIES);

  // Notify Saga Orchestrator so it can compensate
  await publishSagaHistoryEvent(trade, false, lastError?.message);
}

async function startKafkaConsumer() {
  try {
    await dlqProducer.connect();
    console.log('🔌 DLQ producer connected to Kafka');

    await sagaEventsProducer.connect();
    console.log('🔌 Saga events producer connected to Kafka');

    await consumer.connect();
    console.log('🔌 Consumer connected to Kafka Broker');
    
    await consumer.subscribe({ topic: 'transactions-topic', fromBeginning: true });
    console.log('👂 Subscribed to transactions-topic');

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const rawValue = message.value.toString();
        let trade;

        try {
          trade = JSON.parse(rawValue);
        } catch (parseErr) {
          console.error(`❌ Malformed JSON in topic ${topic}[${partition}] — sending to DLQ:`, parseErr.message);
          await publishToDLQ({ raw: rawValue }, `JSON parse error: ${parseErr.message}`, 0);
          return;
        }

        console.log(`📥 Received trade from Kafka:`, { tradeId: trade.tradeId, sagaId: trade.sagaId || 'none' });
        await persistTradeWithRetry(trade, rawValue);
      }
    });
  } catch (err) {
    console.error('❌ Kafka Consumer startup failed:', err);
    process.exit(1);
  }
}

const http = require('http');
let httpServer;

async function startHttpServer() {
  httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    // Add CORS headers for easy local development testing
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/history/')) {
      const accountId = url.pathname.split('/')[2];
      if (!accountId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'accountId is required' }));
        return;
      }

      try {
        console.log(`🔍 Querying Cassandra trades for account ${accountId}...`);
        const query = `
          SELECT trade_id, buyer_account_id, seller_account_id, price, quantity, timestamp, saga_id
          FROM ${keyspace}.trades
        `;
        const result = await cassandraClient.execute(query);
        
        // Filter rows in JS to avoid creating complex secondary indexes in Cassandra (demo speed & simplicity)
        const filteredRows = result.rows
          .filter(row => row.buyer_account_id === accountId || row.seller_account_id === accountId)
          .map(row => ({
            tradeId: row.trade_id,
            buyerAccountId: row.buyer_account_id,
            sellerAccountId: row.seller_account_id,
            price: row.price,
            quantity: row.quantity,
            timestamp: row.timestamp,
            sagaId: row.saga_id || undefined
          }));

        // Sort by timestamp descending (newest first)
        filteredRows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items: filteredRows }));
      } catch (err) {
        console.error(`❌ Cassandra query failed for account ${accountId}:`, err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cassandra query failed', detail: err.message }));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  httpServer.listen(8085, '0.0.0.0', () => {
    console.log('🔌 Transaction History HTTP Server listening on port 8085');
  });
}

async function main() {
  await setupCassandra();
  await startKafkaConsumer();
  await startHttpServer();
}

process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received — shutting down gracefully');
  if (httpServer) {
    httpServer.close();
  }
  await consumer.disconnect();
  await dlqProducer.disconnect();
  await sagaEventsProducer.disconnect();
  await cassandraClient.shutdown();
  process.exit(0);
});

main().catch(console.error);
