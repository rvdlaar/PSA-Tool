/**
 * PSA Tool API — Express server with RAG pipeline, auth, CORS.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { listTemplates } from './templates/index.js';
import { ragRouter } from './api/rag.js';
import { psaRouter } from './api/psa.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// =============================================================================
// CORS — strict origin validation
// =============================================================================

function validateOrigin(origin: string, allowedOrigins: string[]): boolean {
  try {
    const parsed = new URL(origin);
    const canonical = `${parsed.protocol}//${parsed.host}`;
    return allowedOrigins.some((allowed) => {
      try {
        const parsedAllowed = new URL(allowed.trim());
        return `${parsedAllowed.protocol}//${parsedAllowed.host}` === canonical;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean)
  || ['http://localhost:3000', 'http://localhost:3001'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (validateOrigin(origin, allowedOrigins)) return callback(null, true);
    return callback(new Error('CORS: origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

// =============================================================================
// Security middleware
// =============================================================================

app.use(helmet());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});
app.use('/api', limiter);

// =============================================================================
// API Key authentication
// =============================================================================

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string
    || req.headers['authorization']?.replace(/^Bearer\s+/i, '');

  const validKey = process.env.PSA_API_KEY;
  if (!validKey) {
    // No key configured = open access (dev mode)
    next();
    return;
  }

  if (!apiKey) {
    res.status(401).json({ error: 'Missing API key' });
    return;
  }

  const valid = apiKey.length === validKey.length
    && crypto.timingSafeEqual(Buffer.from(apiKey), Buffer.from(validKey));

  if (!valid) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  next();
}

// =============================================================================
// Routes
// =============================================================================

// Health — public
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString(), version: '1.1.0' });
});

// API routes — require auth
app.use('/api', requireApiKey);

app.get('/api', (_req: Request, res: Response) => {
  res.json({
    name: 'PSA Tool API',
    version: '1.1.0',
    endpoints: ['/api/templates', '/api/rag/search', '/api/rag/ingest', '/api/rag/docs', '/api/psa/generate', '/api/psa'],
  });
});

app.get('/api/templates', (_req: Request, res: Response) => {
  res.json({ templates: listTemplates() });
});

// Mount RAG and PSA routers
app.use('/api', ragRouter);
app.use('/api', psaRouter);

// =============================================================================
// Error handler
// =============================================================================

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(`[error] ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`PSA Tool API running on port ${PORT}`);
});

export default app;
