const { Kafka } = require('kafkajs');
const cassandra = require('cassandra-driver');
require('dotenv').config();

const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');
const cassandraContactPoints = (process.env.CASSANDRA_CONTACT_POINTS || 'localhost').split(',');
const cassandraLocalDataCenter = process.env.CASSANDRA_LOCAL_DATA_CENTER || 'datacenter1';
const keyspace = process.env.CASSANDRA_KEYSPACE || 'nexuschain';

// 1. Initialize Cassandra Client
const cassandraClient = new cassandra.Client({
  contactPoints: cassandraContactPoints,
  localDataCenter: cassandraLocalDataCenter
});

async function setupCassandra() {
  try {
    await cassandraClient.connect();
    console.log('🔌 Connected to Cassandra cluster');

    // Create keyspace if not exists
    await cassandraClient.execute(`
      CREATE KEYSPACE IF NOT EXISTS ${keyspace} 
      WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
    `);
    console.log(`🗃️ Keyspace '${keyspace}' verified/created`);

    // Create table if not exists
    await cassandraClient.execute(`
      CREATE TABLE IF NOT EXISTS ${keyspace}.trades (
        trade_id text,
        buyer_account_id text,
        seller_account_id text,
        price double,
        quantity double,
        timestamp timestamp,
        PRIMARY KEY (trade_id)
      );
    `);
    console.log(`📋 Table '${keyspace}.trades' verified/created`);
  } catch (err) {
    console.error('❌ Cassandra initialization failed:', err);
    process.exit(1);
  }
}

// 2. Initialize Kafka Consumer
const kafka = new Kafka({
  clientId: 'transaction-history-recorder',
  brokers: kafkaBrokers
});

const consumer = kafka.consumer({ groupId: 'cassandra-recorder-group' });

async function startKafkaConsumer() {
  try {
    await consumer.connect();
    console.log('🔌 Connected to Kafka Broker');
    
    await consumer.subscribe({ topic: 'transactions-topic', fromBeginning: true });
    console.log('👂 Subscribed to transactions-topic');

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const valueString = message.value.toString();
          const trade = JSON.parse(valueString);
          console.log(`📥 Received trade from Kafka:`, trade);

          // Save to Cassandra
          const query = `
            INSERT INTO ${keyspace}.trades (trade_id, buyer_account_id, seller_account_id, price, quantity, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
          `;
          
          const params = [
            trade.tradeId,
            trade.buyerAccountId,
            trade.sellerAccountId,
            Number(trade.price),
            Number(trade.quantity),
            new Date(trade.timestamp)
          ];

          await cassandraClient.execute(query, params, { prepare: true });
          console.log(`💾 Trade ${trade.tradeId} successfully persisted in Cassandra`);
        } catch (err) {
          console.error('❌ Error processing message:', err);
        }
      }
    });
  } catch (err) {
    console.error('❌ Kafka Consumer startup failed:', err);
    process.exit(1);
  }
}

async function main() {
  await setupCassandra();
  await startKafkaConsumer();
}

main().catch(console.error);
