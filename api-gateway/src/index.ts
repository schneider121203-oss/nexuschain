// 🔭 OpenTelemetry MUST be imported first — before Express and gRPC — to enable auto-instrumentation
import './tracing';

import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import dotenv from 'dotenv';
import http from 'http';
import net from 'net';

// Load environment variables
dotenv.config();


const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'nexuschain_super_secret_key';
const BALANCE_SERVICE_URL = process.env.BALANCE_SERVICE_URL || 'localhost:50051';
const MATCHING_SERVICE_URL = process.env.MATCHING_SERVICE_URL || 'localhost:8082';
const SAGA_ORCHESTRATOR_URL = process.env.SAGA_ORCHESTRATOR_URL || 'localhost:8083';
const CONSENSUS_SERVICE_URL = process.env.CONSENSUS_SERVICE_URL || 'localhost:8084';
const TRANSACTION_HISTORY_URL = process.env.TRANSACTION_HISTORY_URL || 'localhost:8085';


app.use(express.json());

// Serve Static Frontend Dashboard
app.use(express.static(path.resolve(__dirname, '../public')));

// 🛡️ 1. Rate Limiting Middleware
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    error: 'Too many requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Helper to proxy HTTP requests to matching-service without external dependencies
const proxyHttpRequest = (targetUrl: string, method: string, body?: any): Promise<{ statusCode: number; body: any }> => {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(targetUrl);
      const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = data;
          try {
            parsed = JSON.parse(data);
          } catch (e) {}
          resolve({
            statusCode: res.statusCode || 500,
            body: parsed,
          });
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
};

// 🔑 2. JWT Verification Middleware
interface AuthenticatedRequest extends Request {
  user?: any;
}

const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token missing' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// 🔌 3. gRPC Client Setup
const PROTO_PATH = path.resolve(__dirname, '../../proto/balance.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const balanceProto: any = (grpc.loadPackageDefinition(packageDefinition) as any).nexuschain.balance;
const balanceClient = new balanceProto.BalanceService(
  BALANCE_SERVICE_URL,
  grpc.credentials.createInsecure() // Configured for local development
);

// 🎫 4. Auth Endpoint: Generate Test JWT Token
app.post('/api/auth/token', (req: Request, res: Response) => {
  const { username, userId } = req.body;
  if (!username || !userId) {
    return res.status(400).json({ error: 'username and userId are required' });
  }

  const user = { username, userId };
  const accessToken = jwt.sign(user, JWT_SECRET, { expiresIn: '1h' });
  res.json({ accessToken });
});

// ⚖️ 5. Gateway Routing: Get Account Balance (gRPC Proxy)
app.get('/api/balance/:accountId', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const accountId = req.params.accountId;

  balanceClient.GetBalance({ account_id: accountId }, (err: any, response: any) => {
    if (err) {
      console.error('gRPC Error:', err);
      return res.status(500).json({ error: 'Balance service unavailable or failed', details: err.message });
    }
    res.json(response);
  });
});

// 🤝 6. Gateway Routing: Process Transaction (gRPC Proxy)
app.post('/api/transaction', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const { fromAccountId, toAccountId, amount, referenceId } = req.body;

  if (!fromAccountId || !toAccountId || !amount || !referenceId) {
    return res.status(400).json({ error: 'fromAccountId, toAccountId, amount, and referenceId are required' });
  }

  const transactionPayload = {
    from_account_id: fromAccountId,
    to_account_id: toAccountId,
    amount: parseFloat(amount),
    reference_id: referenceId,
  };

  balanceClient.ProcessTransaction(transactionPayload, (err: any, response: any) => {
    if (err) {
      console.error('gRPC Error:', err);
      return res.status(500).json({ error: 'Transaction failed or service unavailable', details: err.message });
    }

    if (!response.success) {
      return res.status(400).json(response);
    }

    res.json(response);
  });
});

// 📈 7. Proxy Gateway to Matching Service Book
app.get('/api/matching/book', async (req: Request, res: Response) => {
  try {
    const target = `http://${MATCHING_SERVICE_URL}/book`;
    const result = await proxyHttpRequest(target, 'GET');
    res.status(result.statusCode).json(result.body);
  } catch (err: any) {
    console.error('Matching Book Proxy Error:', err);
    res.status(500).json({ error: 'Matching service unavailable', details: err.message });
  }
});

// 📈 8. Proxy Gateway to Matching Service Order Submission
app.post('/api/matching/orders', async (req: Request, res: Response) => {
  try {
    const target = `http://${MATCHING_SERVICE_URL}/orders`;
    const result = await proxyHttpRequest(target, 'POST', req.body);
    res.status(result.statusCode).json(result.body);
  } catch (err: any) {
    console.error('Matching Order Proxy Error:', err);
    res.status(500).json({ error: 'Matching service unavailable', details: err.message });
  }
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'UP', service: 'API-Gateway' });
});

// 🎭 9. Saga Orchestrator — Proxy Routes
// POST /api/saga/transfer → saga-orchestrator:8083/saga/start
// Initiates a new saga that: debits balance → submits order → waits for history
app.post('/api/saga/transfer', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const target = `http://${SAGA_ORCHESTRATOR_URL}/saga/start`;
    const result = await proxyHttpRequest(target, 'POST', req.body);
    res.status(result.statusCode).json(result.body);
  } catch (err: any) {
    console.error('Saga start proxy error:', err);
    res.status(500).json({ error: 'Saga Orchestrator unavailable', details: err.message });
  }
});

// GET /api/saga/:sagaId → saga-orchestrator:8083/saga/:sagaId
// Returns the current state of a saga (poll this after POST /api/saga/transfer)
app.get('/api/saga/:sagaId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const target = `http://${SAGA_ORCHESTRATOR_URL}/saga/${req.params.sagaId}`;
    const result = await proxyHttpRequest(target, 'GET');
    res.status(result.statusCode).json(result.body);
  } catch (err: any) {
    console.error('Saga status proxy error:', err);
    res.status(500).json({ error: 'Saga Orchestrator unavailable', details: err.message });
  }
});

// GET /api/saga/:sagaId/steps → saga-orchestrator:8083/saga/:sagaId/steps
// Returns the full audit log of steps for a saga (useful for debugging)
app.get('/api/saga/:sagaId/steps', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const target = `http://${SAGA_ORCHESTRATOR_URL}/saga/${req.params.sagaId}/steps`;
    const result = await proxyHttpRequest(target, 'GET');
    res.status(result.statusCode).json(result.body);
  } catch (err: any) {
    console.error('Saga steps proxy error:', err);
    res.status(500).json({ error: 'Saga Orchestrator unavailable', details: err.message });
  }
});

// GET /api/sagas → saga-orchestrator:8083/sagas
// Lists recent sagas (admin view)
app.get('/api/sagas', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset } = req.query;
    const qs = new URLSearchParams();
    if (limit)  qs.set('limit',  limit  as string);
    if (offset) qs.set('offset', offset as string);
    const target = `http://${SAGA_ORCHESTRATOR_URL}/sagas${qs.toString() ? '?' + qs.toString() : ''}`;
    const result = await proxyHttpRequest(target, 'GET');
    res.status(result.statusCode).json(result.body);
  } catch (err: any) {
    console.error('Sagas list proxy error:', err);
    res.status(500).json({ error: 'Saga Orchestrator unavailable', details: err.message });
  }
});

// GET /api/history/:accountId → transaction-history:8085/history/:accountId
app.get('/api/history/:accountId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const target = `http://${TRANSACTION_HISTORY_URL}/history/${req.params.accountId}`;
    const result = await proxyHttpRequest(target, 'GET');
    res.status(result.statusCode).json(result.body);
  } catch (err: any) {
    console.error('History proxy error:', err);
    res.status(500).json({ error: 'Transaction history service unavailable', details: err.message });
  }
});

// 🏛️ 10. System Status & Health Proxy Routes

// Helper utility to test TCP connectivity for healthchecks
const checkTcpPort = (host: string, port: number, timeout = 1500): Promise<boolean> => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.setTimeout(timeout);
    socket.once('connect', () => {
      resolved = true;
      socket.destroy();
      resolve(true);
    });

    socket.once('timeout', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    });

    socket.once('error', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    });

    socket.connect(port, host);
  });
};

// GET /api/system/consensus/status → consensus-service:8084/consensus/status
app.get('/api/system/consensus/status', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const target = `http://${CONSENSUS_SERVICE_URL}/consensus/status`;
    const result = await proxyHttpRequest(target, 'GET');
    res.status(result.statusCode).json(result.body);
  } catch (err: any) {
    console.error('Consensus status proxy error:', err);
    res.status(500).json({ error: 'Consensus service unavailable', details: err.message });
  }
});

// GET /api/system/health → aggregates status of all microservices and infrastructure
app.get('/api/system/health', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const services = [
      { name: 'api-gateway',          host: 'localhost',          port: Number(PORT) },
      { name: 'balance-service',      host: BALANCE_SERVICE_URL.split(':')[0], port: Number(BALANCE_SERVICE_URL.split(':')[1] || '50051') },
      { name: 'matching-service',     host: MATCHING_SERVICE_URL.split(':')[0], port: Number(MATCHING_SERVICE_URL.split(':')[1] || '8082') },
      { name: 'saga-orchestrator',    host: SAGA_ORCHESTRATOR_URL.split(':')[0], port: Number(SAGA_ORCHESTRATOR_URL.split(':')[1] || '8083') },
      { name: 'consensus-service',    host: CONSENSUS_SERVICE_URL.split(':')[0], port: Number(CONSENSUS_SERVICE_URL.split(':')[1] || '8084') },
      { name: 'postgres-db',          host: 'postgres',           port: 5432 },
      { name: 'cassandra-db',         host: 'cassandra',          port: 9042 },
      { name: 'kafka-broker',         host: 'kafka',              port: 9092 }
    ];

    const healthResults = await Promise.all(
      services.map(async (svc) => {
        const start = Date.now();
        const alive = await checkTcpPort(svc.host, svc.port);
        const latencyMs = Date.now() - start;
        return {
          name: svc.name,
          status: alive ? 'UP' : 'DOWN',
          latencyMs: alive ? latencyMs : 0
        };
      })
    );

    res.json({
      timestamp: new Date().toISOString(),
      services: healthResults
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to aggregate health status', details: err.message });
  }
});



app.listen(PORT, () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
  console.log(`🔗 Proxying gRPC requests to Balance Service at ${BALANCE_SERVICE_URL}`);
  console.log(`🔗 Proxying Matching HTTP requests to ${MATCHING_SERVICE_URL}`);
});
