/**
 * RAG Pipeline — real implementation backed by ChromaDB.
 */
import { getEmbeddingService } from './embeddings.js';
import { getVectorStore, COLLECTION_PSAS, COLLECTION_DOCS } from './vector-store.js';

export interface Document {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface SearchResult {
  document: Document;
  score: number;
}

export class RAGPipeline {
  async addDocument(doc: Document, collection = COLLECTION_DOCS): Promise<void> {
    try {
      const embedding = await getEmbeddingService().embed(doc.content);
      const vs = getVectorStore();
      if (!vs) return;
      await vs.upsert(collection, doc.id, embedding, doc.content, doc.metadata as Record<string, string>);
    } catch (e) {
      console.warn('[RAG] Failed to index document:', (e as Error).message);
    }
  }

  async search(query: string, limit = 5, collection?: string): Promise<SearchResult[]> {
    try {
      const embedding = await getEmbeddingService().embed(query);
      const vs = getVectorStore();
      if (!vs) return [];

      const collections = collection ? [collection] : [COLLECTION_PSAS, COLLECTION_DOCS];
      const allHits: Array<{ id: string; document: string; metadata: Record<string, unknown>; score: number }> = [];

      for (const coll of collections) {
        try {
          const hits = await vs.search(coll, embedding, limit);
          allHits.push(...hits);
        } catch { /* skip */ }
      }

      allHits.sort((a, b) => (b.score || 0) - (a.score || 0));

      return allHits.slice(0, limit).map(h => ({
        document: { id: h.id, content: h.document || '', metadata: h.metadata || {} },
        score: h.score || 0,
      }));
    } catch {
      return [];
    }
  }

  async generateContext(query: string, limit = 5): Promise<string> {
    const results = await this.search(query, limit);
    if (results.length === 0) return '';
    return results.map(r => r.document.content).join('\n\n---\n\n');
  }
}

export const ragPipeline = new RAGPipeline();
export { COLLECTION_PSAS, COLLECTION_DOCS };
