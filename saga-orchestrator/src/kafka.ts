import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
import { SagaCommand, SagaEvent } from './types';

const BROKERS = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');

export const TOPICS = {
  /** Orchestrator → services: commands directing what each service should do */
  SAGA_COMMANDS: 'saga.commands',
  /** Services → Orchestrator: results of each saga step */
  SAGA_EVENTS:   'saga.events',
} as const;

const kafka = new Kafka({
  clientId: 'saga-orchestrator',
  brokers: BROKERS,
  retry: {
    initialRetryTime: 300,
    retries: 8,
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// Producer
// ──────────────────────────────────────────────────────────────────────────────

let producer: Producer;

export async function initProducer(): Promise<void> {
  producer = kafka.producer({
    allowAutoTopicCreation: false,
    transactionTimeout: 30_000,
  });
  await producer.connect();
  console.log('📤 Saga Orchestrator Kafka producer connected');
}

/**
 * Publishes a command to the saga.commands topic.
 * Keyed by sagaId so all messages for a saga go to the same partition
 * (preserving order within a saga).
 */
export async function publishCommand(command: SagaCommand): Promise<void> {
  await producer.send({
    topic: TOPICS.SAGA_COMMANDS,
    messages: [{
      key:   command.sagaId,
      value: JSON.stringify(command),
    }],
  });
  console.log(`📤 Command sent [${command.type}] for saga ${command.sagaId}`);
}

/**
 * Publishes an internal saga event (e.g., compensation started) to saga.events.
 * Used when the orchestrator itself needs to signal state changes to other consumers.
 */
export async function publishEvent(event: SagaEvent): Promise<void> {
  await producer.send({
    topic: TOPICS.SAGA_EVENTS,
    messages: [{
      key:   event.sagaId,
      value: JSON.stringify(event),
    }],
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Consumer
// ──────────────────────────────────────────────────────────────────────────────

let consumer: Consumer;

export async function initConsumer(
  handler: (event: SagaEvent) => Promise<void>
): Promise<void> {
  consumer = kafka.consumer({
    groupId: 'saga-orchestrator-group',
    heartbeatInterval: 3_000,
    sessionTimeout: 30_000,
  });

  await consumer.connect();
  await consumer.subscribe({ topic: TOPICS.SAGA_EVENTS, fromBeginning: false });

  console.log(`👂 Saga Orchestrator consumer subscribed to ${TOPICS.SAGA_EVENTS}`);

  await consumer.run({
    eachMessage: async ({ message }: EachMessagePayload) => {
      if (!message.value) return;

      let event: SagaEvent;
      try {
        event = JSON.parse(message.value.toString()) as SagaEvent;
      } catch (err) {
        console.error('❌ Failed to parse saga event — skipping malformed message:', message.value.toString());
        return; // commit offset anyway to avoid blocking
      }

      try {
        await handler(event);
      } catch (err) {
        // Log but don't rethrow — Kafka consumer must not crash on handler errors.
        // The watchdog will catch stuck sagas caused by processing failures.
        console.error(`❌ Error handling saga event [${event.type}] for saga ${event.sagaId}:`, err);
      }
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ──────────────────────────────────────────────────────────────────────────────

export async function disconnectKafka(): Promise<void> {
  await Promise.allSettled([
    producer?.disconnect(),
    consumer?.disconnect(),
  ]);
  console.log('🔌 Kafka connections closed');
}
