/**
 * RAG API routes — ingest documents, semantic search.
 */
import { Router, type Request, type Response } from 'express';
import { ragPipeline } from '../rag/index.js';
import { createIngestedDoc, listIngestedDocs, deleteIngestedDoc, getIngestedDoc } from '../db/store.js';
import { randomUUID } from 'crypto';

export const ragRouter = Router();

// POST /api/rag/ingest — ingest a document
ragRouter.post('/rag/ingest', async (req: Request, res: Response) => {
  try {
    const { title, content, source, docType } = req.body;
    if (!title || !content) {
      res.status(400).json({ error: 'title and content required' });
      return;
    }

    // Store in SQLite
    const doc = createIngestedDoc(title, content, source, docType);
    if (!doc) {
      res.status(500).json({ error: 'Failed to store document' });
      return;
    }

    // Index in ChromaDB (non-blocking)
    await ragPipeline.addDocument({
      id: doc.id as string,
      content: `${title}\n${content}`,
      metadata: { title, source: source || '', docType: docType || 'text' },
    });

    res.status(201).json({ ok: true, document: doc });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// GET /api/rag/search — semantic search
ragRouter.get('/rag/search', async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    const limit = Math.min(parseInt(req.query.limit as string || '5', 10), 20);

    if (!q || q.trim().length < 2) {
      res.json({ results: [], query: q });
      return;
    }

    const results = await ragPipeline.search(q, limit);
    res.json({ results, query: q, count: results.length });
  } catch (e) {
    res.json({ results: [], error: (e as Error).message });
  }
});

// GET /api/rag/docs — list ingested documents
ragRouter.get('/rag/docs', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string || '20', 10);
  const offset = parseInt(req.query.offset as string || '0', 10);
  const { items, total } = listIngestedDocs(limit, offset);
  res.json({ documents: items, total });
});

// DELETE /api/rag/docs/:id — delete document
ragRouter.delete('/rag/docs/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const doc = getIngestedDoc(id);
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  deleteIngestedDoc(id);

  // Remove from vector store
  try {
    const { getVectorStore, COLLECTION_DOCS } = await import('../rag/vector-store.js');
    const vs = getVectorStore();
    if (vs) await vs.delete(COLLECTION_DOCS, id);
  } catch { /* ignore */ }

  res.json({ ok: true });
});
