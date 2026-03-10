import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// =============================================================================
// CORS — strict origin validation
// =============================================================================

/**
 * Validate an origin string. Uses URL parsing to correctly handle
 * schemes, hostnames, and ports — fixes the old split-based approach
 * that incorrectly separated schemes from hostnames.
 */
function validateOrigin(origin: string, allowedOrigins: string[]): boolean {
  try {
    const parsed = new URL(origin);
    // Reconstruct canonical origin (scheme + host, no trailing slash/path)
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
  || ['http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) return callback(null, true);
    if (validateOrigin(origin, allowedOrigins)) {
      return callback(null, true);
    }
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

// Rate limiting — 60 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', limiter);

// =============================================================================
// API Key authentication middleware
// =============================================================================

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string
    || req.headers['authorization']?.replace(/^Bearer\s+/i, '');

  const validKey = process.env.PSA_API_KEY;
  if (!validKey) {
    // Fail closed — if no API key configured, reject all requests
    res.status(503).json({ error: 'API key not configured on server' });
    return;
  }

  if (!apiKey) {
    res.status(401).json({ error: 'Missing API key. Use X-API-Key header or Bearer token.' });
    return;
  }

  // Constant-time comparison to prevent timing attacks
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

// Health endpoint — public (no auth required)
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// All /api/* routes require API key authentication
app.use('/api', requireApiKey);

app.get('/api', (req: Request, res: Response) => {
  res.json({
    message: 'PSA Tool API',
    version: '1.0.0',
    endpoints: ['/health', '/api/templates', '/api/rag']
  });
});

app.get('/api/templates', (req: Request, res: Response) => {
  res.json({ templates: [] });
});

app.get('/api/rag', (req: Request, res: Response) => {
  res.json({ status: 'ready' });
});

// =============================================================================
// Error handler
// =============================================================================

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  // Don't leak internal error details
  console.error(`[error] ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`PSA Tool API running on port ${PORT}`);
});

export default app;
