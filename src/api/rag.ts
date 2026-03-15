/**
 * RAG API routes — ingest, search, folder scan with SSE progress.
 */
import { Router, type Request, type Response } from 'express';
import { ragPipeline } from '../rag/index.js';
import { createIngestedDoc, listIngestedDocs, deleteIngestedDoc, getIngestedDoc } from '../db/store.js';
import { getEmbeddingService } from '../rag/embeddings.js';
import { getVectorStore, COLLECTION_DOCS } from '../rag/vector-store.js';
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, extname, relative, resolve } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

export const ragRouter = Router();

const SCANNABLE = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.xml', '.csv']);
const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'dist', 'build', '.git', '.next', 'vendor']);
const MAX_FILE = 5 * 1024 * 1024;

// POST /api/rag/ingest
ragRouter.post('/rag/ingest', async (req: Request, res: Response) => {
  try {
    const { title, content, source, docType } = req.body;
    if (!title || !content) { res.status(400).json({ error: 'title and content required' }); return; }
    const doc = createIngestedDoc(title, content, source, docType);
    if (!doc) { res.status(500).json({ error: 'Failed to store' }); return; }
    await ragPipeline.addDocument({ id: doc.id as string, content: `${title}\n${content}`, metadata: { title, source: source || '' } });
    res.status(201).json({ ok: true, document: doc });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/rag/search
ragRouter.get('/rag/search', async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    const limit = Math.min(parseInt(req.query.limit as string || '5', 10), 20);
    if (!q || q.trim().length < 2) { res.json({ results: [], query: q }); return; }
    const results = await ragPipeline.search(q, limit);
    res.json({ results, query: q, count: results.length });
  } catch (e) { res.json({ results: [], error: (e as Error).message }); }
});

// GET /api/rag/docs
ragRouter.get('/rag/docs', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string || '20', 10);
  const offset = parseInt(req.query.offset as string || '0', 10);
  const { items, total } = listIngestedDocs(limit, offset);
  res.json({ documents: items, total });
});

// DELETE /api/rag/docs/:id
ragRouter.delete('/rag/docs/:id', async (req: Request, res: Response) => {
  const doc = getIngestedDoc(req.params.id);
  if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
  deleteIngestedDoc(req.params.id);
  try { const vs = getVectorStore(); if (vs) await vs.delete(COLLECTION_DOCS, req.params.id); } catch {}
  res.json({ ok: true });
});

// ================================================================
// POST /api/rag/scan — scan folder for ingestible files
// ================================================================
ragRouter.post('/rag/scan', (req: Request, res: Response) => {
  const rawPath = req.body.path as string;
  if (!rawPath) { res.status(400).json({ error: 'path required' }); return; }

  const folder = resolve(rawPath.replace(/^~/, homedir()));
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    res.json({ error: `Not a directory: ${rawPath}`, files: [] });
    return;
  }

  const files: Array<{ path: string; name: string; ext: string; size: number }> = [];
  const byExt: Record<string, number> = {};
  let totalSize = 0;

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const ext = extname(entry.name).toLowerCase();
      if (!SCANNABLE.has(ext)) continue;
      const size = statSync(full).size;
      if (size > MAX_FILE || size === 0) continue;
      const rel = relative(folder, full);
      files.push({ path: rel, name: entry.name, ext, size });
      byExt[ext] = (byExt[ext] || 0) + 1;
      totalSize += size;
    }
  }

  walk(folder);
  files.sort((a, b) => a.path.localeCompare(b.path));

  res.json({ folder, files, total: files.length, by_extension: byExt, total_size_kb: Math.round(totalSize / 1024 * 10) / 10 });
});

// ================================================================
// POST /api/rag/ingest-files — SSE streaming per-file ingestion
// ================================================================
ragRouter.post('/rag/ingest-files', async (req: Request, res: Response) => {
  const folderPath = req.body.path as string;
  const filePaths = req.body.files as string[];
  if (!folderPath || !filePaths?.length) { res.status(400).json({ error: 'path and files required' }); return; }

  const folder = resolve(folderPath.replace(/^~/, homedir()));
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    res.status(400).json({ error: 'Invalid folder' });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });

  let ingested = 0;
  const total = filePaths.length;

  for (let i = 0; i < total; i++) {
    const relPath = filePaths[i];
    const filePath = resolve(join(folder, relPath));

    // Security: must be inside folder
    if (!filePath.startsWith(folder)) {
      send(res, { file: relPath, index: i, total, status: 'error', error: 'Path traversal blocked' });
      continue;
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      send(res, { file: relPath, index: i, total, status: 'error', error: 'Not found' });
      continue;
    }

    send(res, { file: relPath, index: i, total, status: 'reading' });

    try {
      const content = readFileSync(filePath, 'utf-8');
      if (!content.trim()) {
        send(res, { file: relPath, index: i, total, status: 'skipped', error: 'Empty' });
        continue;
      }

      // Store in SQLite
      const doc = createIngestedDoc(
        extname(relPath).slice(1) + ': ' + relPath,
        content.slice(0, 10000),
        'folder_scan',
        'text',
        { path: relPath }
      );

      send(res, { file: relPath, index: i, total, status: 'embedding' });

      // Embed
      try {
        const vs = getVectorStore();
        if (vs && doc) {
          const emb = getEmbeddingService();
          const text = `${relPath}\n${content.slice(0, 5000)}`;
          const embedding = await emb.embed(text);
          await vs.upsert(COLLECTION_DOCS, doc.id as string, embedding, text, { filename: relPath, source: 'folder_scan' });
        }
      } catch { /* embedding failure doesn't block */ }

      ingested++;
      send(res, { file: relPath, index: i, total, status: 'done' });
    } catch (e) {
      send(res, { file: relPath, index: i, total, status: 'error', error: (e as Error).message });
    }
  }

  send(res, { status: 'complete', ingested, total });
  res.end();
});

function send(res: Response, data: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
