/**
 * Embedding service — uses OpenAI-compatible API.
 */
import OpenAI from 'openai';

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

export class EmbeddingError extends Error {
  constructor(message: string) { super(message); this.name = 'EmbeddingError'; }
}

export class EmbeddingService {
  private client: OpenAI;
  private model: string;

  constructor() {
    const apiKey = process.env.AI_API_KEY || '';
    const baseURL = process.env.AI_BASE_URL || undefined;
    this.client = new OpenAI({ apiKey, baseURL });
    this.model = EMBEDDING_MODEL;
  }

  async embed(text: string): Promise<number[]> {
    const cleaned = (text || '').trim().slice(0, 8000);
    if (!cleaned) throw new EmbeddingError('Empty text');
    try {
      const resp = await this.client.embeddings.create({ model: this.model, input: cleaned });
      return resp.data[0].embedding;
    } catch (e: unknown) {
      throw new EmbeddingError(`Embedding failed: ${(e as Error).message}`);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const cleaned = texts.map(t => (t || '').trim().slice(0, 8000)).filter(t => t.length > 0);
    if (cleaned.length === 0) return [];
    try {
      const resp = await this.client.embeddings.create({ model: this.model, input: cleaned });
      return resp.data.map(d => d.embedding);
    } catch (e: unknown) {
      throw new EmbeddingError(`Batch embedding failed: ${(e as Error).message}`);
    }
  }
}

let _service: EmbeddingService | null = null;
export function getEmbeddingService(): EmbeddingService {
  if (!_service) _service = new EmbeddingService();
  return _service;
}
