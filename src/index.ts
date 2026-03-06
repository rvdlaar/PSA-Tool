import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']
}));
app.use(express.json());

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API routes placeholder
app.get('/api', (req, res) => {
  res.json({
    message: 'PSA Tool API',
    version: '1.0.0',
    endpoints: ['/health', '/api/templates', '/api/rag']
  });
});

// Templates endpoint
app.get('/api/templates', (req, res) => {
  res.json({
    templates: []
  });
});

// RAG endpoint
app.get('/api/rag', (req, res) => {
  res.json({
    status: 'ready'
  });
});

app.listen(PORT, () => {
  console.log(`PSA Tool API running on port ${PORT}`);
});

export default app;
