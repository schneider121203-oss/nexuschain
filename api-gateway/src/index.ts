import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import dotenv from 'dotenv';
import http from 'http';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'nexuschain_super_secret_key';
const BALANCE_SERVICE_URL = process.env.BALANCE_SERVICE_URL || 'localhost:50051';
const MATCHING_SERVICE_URL = process.env.MATCHING_SERVICE_URL || 'localhost:8082';

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

app.listen(PORT, () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
  console.log(`🔗 Proxying gRPC requests to Balance Service at ${BALANCE_SERVICE_URL}`);
  console.log(`🔗 Proxying Matching HTTP requests to ${MATCHING_SERVICE_URL}`);
});
