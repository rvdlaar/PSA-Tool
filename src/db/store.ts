/**
 * SQLite persistence for PSAs + ingested documents.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';

const DB_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DB_DIR, 'psa.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS psas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      template_id TEXT,
      content TEXT,
      context_used TEXT,
      ai_model TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ingested_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT,
      doc_type TEXT DEFAULT 'text',
      metadata TEXT DEFAULT '{}',
      ingested_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_psas_template ON psas(template_id);
    CREATE INDEX IF NOT EXISTS idx_docs_source ON ingested_docs(source);
  `);

  return db;
}

// --- PSA CRUD ---

export function createPSA(title: string, templateId: string, content: string, contextUsed?: string, aiModel?: string) {
  const d = getDb();
  const id = randomUUID();
  d.prepare(
    'INSERT INTO psas (id, title, template_id, content, context_used, ai_model) VALUES (?,?,?,?,?,?)'
  ).run(id, title, templateId, content, contextUsed || null, aiModel || null);
  return getPSA(id);
}

export function getPSA(id: string) {
  return getDb().prepare('SELECT * FROM psas WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

export function listPSAs(limit = 20, offset = 0) {
  const d = getDb();
  const total = (d.prepare('SELECT COUNT(*) as n FROM psas').get() as any).n;
  const items = d.prepare('SELECT * FROM psas ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  return { items, total };
}

// --- Document CRUD ---

export function createIngestedDoc(title: string, content: string, source?: string, docType?: string, metadata?: Record<string, unknown>) {
  const d = getDb();
  const id = randomUUID();
  d.prepare(
    'INSERT INTO ingested_docs (id, title, content, source, doc_type, metadata) VALUES (?,?,?,?,?,?)'
  ).run(id, title, content, source || null, docType || 'text', JSON.stringify(metadata || {}));
  return getIngestedDoc(id);
}

export function getIngestedDoc(id: string) {
  const row = getDb().prepare('SELECT * FROM ingested_docs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (row && typeof row.metadata === 'string') {
    try { row.metadata = JSON.parse(row.metadata as string); } catch { row.metadata = {}; }
  }
  return row;
}

export function listIngestedDocs(limit = 20, offset = 0) {
  const d = getDb();
  const total = (d.prepare('SELECT COUNT(*) as n FROM ingested_docs').get() as any).n;
  const items = d.prepare('SELECT * FROM ingested_docs ORDER BY ingested_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  return { items: items.map(parseDocMeta), total };
}

export function deleteIngestedDoc(id: string) {
  return getDb().prepare('DELETE FROM ingested_docs WHERE id = ?').run(id).changes > 0;
}

function parseDocMeta(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  if (typeof r.metadata === 'string') {
    try { r.metadata = JSON.parse(r.metadata as string); } catch { r.metadata = {}; }
  }
  return r;
}
