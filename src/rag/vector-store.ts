/**
 * ChromaDB vector store wrapper.
 */
import { ChromaClient, type Collection } from 'chromadb';

const CHROMA_URL = process.env.CHROMA_URL || 'http://chromadb:8000';
export const COLLECTION_PSAS = 'psas';
export const COLLECTION_DOCS = 'project_docs';

export class VectorStore {
  private client: ChromaClient;
  private collections: Map<string, Collection> = new Map();

  constructor() {
    this.client = new ChromaClient({ path: CHROMA_URL });
  }

  private async getCollection(name: string): Promise<Collection> {
    if (!this.collections.has(name)) {
      const coll = await this.client.getOrCreateCollection({ name, metadata: { 'hnsw:space': 'cosine' } });
      this.collections.set(name, coll);
    }
    return this.collections.get(name)!;
  }

  async upsert(collectionName: string, docId: string, embedding: number[], text: string, metadata?: Record<string, string>) {
    const coll = await this.getCollection(collectionName);
    await coll.upsert({ ids: [docId], embeddings: [embedding], documents: [text.slice(0, 5000)], metadatas: [metadata || {}] });
  }

  async search(collectionName: string, queryEmbedding: number[], limit = 5) {
    const coll = await this.getCollection(collectionName);
    const results = await coll.query({
      queryEmbeddings: [queryEmbedding],
      nResults: Math.min(limit, 20),
      include: ['documents', 'metadatas', 'distances'] as any,
    });

    const hits: Array<{ id: string; document: string; metadata: Record<string, unknown>; distance: number; score: number }> = [];
    if (results.ids?.[0]) {
      for (let i = 0; i < results.ids[0].length; i++) {
        const dist = results.distances?.[0]?.[i] ?? 0;
        hits.push({
          id: results.ids[0][i],
          document: results.documents?.[0]?.[i] ?? '',
          metadata: (results.metadatas?.[0]?.[i] as Record<string, unknown>) ?? {},
          distance: dist,
          score: Math.round((1 - dist) * 10000) / 10000,
        });
      }
    }
    return hits;
  }

  async delete(collectionName: string, docId: string) {
    try {
      const coll = await this.getCollection(collectionName);
      await coll.delete({ ids: [docId] });
    } catch { /* ignore */ }
  }

  async count(collectionName: string): Promise<number> {
    try {
      const coll = await this.getCollection(collectionName);
      return await coll.count();
    } catch {
      return 0;
    }
  }
}

let _store: VectorStore | null = null;
export function getVectorStore(): VectorStore | null {
  if (!_store) {
    try {
      _store = new VectorStore();
    } catch {
      return null;
    }
  }
  return _store;
}
