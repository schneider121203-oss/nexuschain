import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { initDb } from './db';
import { initProducer, initConsumer, disconnectKafka } from './kafka';
import { startSaga, handleSagaEvent, startWatchdog } from './orchestrator';
import { getSaga, getSagaSteps, listRecentSagas } from './sagaRepository';
import { StartSagaRequest, SagaEvent } from './types';

dotenv.config();

const PORT = parseInt(process.env.PORT || '8083');
const app  = express();
app.use(express.json());

// ──────────────────────────────────────────────────────────────────────────────
// REST API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /saga/start
 * Initiates a new saga for a fund transfer + order matching operation.
 *
 * Body: { fromAccountId, toAccountId, amount, referenceId }
 * Response: { sagaId, transactionId, currentState, message }
 */
app.post('/saga/start', async (req: Request, res: Response) => {
  const { fromAccountId, toAccountId, amount, referenceId } = req.body as StartSagaRequest;

  if (!fromAccountId || !toAccountId || !amount || !referenceId) {
    return res.status(400).json({
      error: 'Missing required fields: fromAccountId, toAccountId, amount, referenceId',
    });
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  if (fromAccountId === toAccountId) {
    return res.status(400).json({ error: 'fromAccountId and toAccountId must be different' });
  }

  try {
    const saga = await startSaga({ fromAccountId, toAccountId, amount, referenceId });
    return res.status(202).json({
      sagaId:        saga.sagaId,
      transactionId: saga.transactionId,
      currentState:  saga.currentState,
      message:       'Saga started. Poll GET /saga/:sagaId for the final status.',
    });
  } catch (err: any) {
    console.error('Error starting saga:', err);
    if (err.message?.includes('duplicate key')) {
      return res.status(409).json({
        error: `A saga for referenceId '${referenceId}' already exists.`,
      });
    }
    return res.status(500).json({ error: 'Internal error starting saga', detail: err.message });
  }
});

/**
 * GET /saga/:sagaId
 * Returns the current state and full payload of a saga.
 */
app.get('/saga/:sagaId', async (req: Request, res: Response) => {
  const { sagaId } = req.params;

  try {
    const saga = await getSaga(sagaId);
    if (!saga) {
      return res.status(404).json({ error: `Saga '${sagaId}' not found` });
    }
    return res.json(saga);
  } catch (err: any) {
    return res.status(500).json({ error: 'Error fetching saga', detail: err.message });
  }
});

/**
 * GET /saga/:sagaId/steps
 * Returns the full audit log of steps executed in a saga.
 * Useful for debugging and for the sustentation demo.
 */
app.get('/saga/:sagaId/steps', async (req: Request, res: Response) => {
  const { sagaId } = req.params;

  try {
    const saga = await getSaga(sagaId);
    if (!saga) {
      return res.status(404).json({ error: `Saga '${sagaId}' not found` });
    }
    const steps = await getSagaSteps(sagaId);
    return res.json({ sagaId, currentState: saga.currentState, steps });
  } catch (err: any) {
    return res.status(500).json({ error: 'Error fetching saga steps', detail: err.message });
  }
});

/**
 * GET /sagas?limit=50&offset=0
 * Lists recent sagas, most recent first.
 */
app.get('/sagas', async (req: Request, res: Response) => {
  const limit  = Math.min(parseInt(req.query.limit  as string || '50'), 200);
  const offset = parseInt(req.query.offset as string || '0');

  try {
    const sagas = await listRecentSagas(limit, offset);
    return res.json({ count: sagas.length, sagas });
  } catch (err: any) {
    return res.status(500).json({ error: 'Error listing sagas', detail: err.message });
  }
});

/** GET /health — used by Docker healthcheck and monitoring */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status:  'UP',
    service: 'saga-orchestrator',
    uptime:  Math.round(process.uptime()),
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ──────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Initialize database schema
  await initDb();

  // 2. Connect Kafka producer
  await initProducer();

  // 3. Start consuming saga.events from Kafka
  await initConsumer((event: SagaEvent) => handleSagaEvent(event));

  // 4. Start watchdog
  const watchdogTimer = startWatchdog();

  // 5. Start HTTP server
  app.listen(PORT, () => {
    console.log(`🎭 Saga Orchestrator running on port ${PORT}`);
    console.log(`   POST /saga/start         — initiate a new saga`);
    console.log(`   GET  /saga/:sagaId       — query saga state`);
    console.log(`   GET  /saga/:sagaId/steps — saga audit log`);
    console.log(`   GET  /sagas              — list recent sagas`);
    console.log(`   GET  /health             — health check`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Shutting down Saga Orchestrator...');
    clearInterval(watchdogTimer);
    await disconnectKafka();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}

main().catch(err => {
  console.error('❌ Fatal error during startup:', err);
  process.exit(1);
});
