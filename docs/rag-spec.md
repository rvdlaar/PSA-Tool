# PSA-Tool — RAG Pipeline Specification

## Overview

The PSA-Tool generates Project Start Architecture documents from templates, but today those
templates are static stubs with hard-coded placeholder variables. A `RAGPipeline` class
already exists in `src/rag/index.ts` but all methods return empty results. ChromaDB is
already declared in `docker-compose.yml` but is never connected. This spec closes that gap:
wire ChromaDB, implement real embeddings, add document ingestion, and make PSA generation
context-aware by retrieving relevant project documents and past PSAs before each generation.
The outcome is PSAs that reflect actual project context rather than generic boilerplate.

---

## Architecture

```
INGESTION                     VECTOR STORE                GENERATION
---------                     ------------                ----------
POST /api/rag/ingest           ChromaDB                    POST /api/psa/generate
       |                    (already in compose)                  |
       v                           |                              v
EmbeddingService  --upsert-->  collection: project_docs    PSAGenerator
                                                                  |
ADR-style auto-index          collection: psas             1. embed request
of generated PSAs  --upsert-->                             2. retrieve top-k
                                                           3. inject into template
GET /api/rag/search                                        4. call LLM (optional)
       |                           |
       v                           v
 EmbeddingService  ---------->   VectorStore.search()
```

---

## Components

### EmbeddingService (`src/rag/embeddings.ts`)

**Purpose:** Generate embeddings using the same OpenAI-compatible API used for LLM generation.
Reuses `LLM_PROVIDER`, `AI_API_KEY`, and `AI_BASE_URL` env vars (or dedicated embedding vars
if the provider differs).

**Interface:**
```typescript
export class EmbeddingService {
  constructor();
  // reads EMBEDDING_MODEL (default: "text-embedding-3-small")
  // reads AI_API_KEY, AI_BASE_URL

  async embed(text: string): Promise<number[]>;
  // Embeds a single string. Returns 1536-dim vector.
  // Throws EmbeddingError on API failure.

  async embedBatch(texts: string[]): Promise<number[][]>;
  // Embeds up to 100 strings in one API call.
}

export class EmbeddingError extends Error {}

export function getEmbeddingService(): EmbeddingService;
// Returns a module-level singleton.
```

**Dependencies:** `openai` npm package (add to `package.json`).

**Notes:**
- Truncate input to 8000 characters before embedding.
- On failure, callers in ingestion must catch `EmbeddingError` and log a warning — the
  stored document is still returned successfully.

---

### VectorStore (`src/rag/vector-store.ts`)

**Purpose:** Thin typed wrapper around the ChromaDB REST API using the `chromadb` npm client.
Manages two named collections.

**Interface:**
```typescript
export const COLLECTION_PSAS = "psas";
export const COLLECTION_PROJECT_DOCS = "project_docs";

export interface VectorSearchResult {
  id: string;
  text: string;
  score: number;       // cosine distance, lower = more similar
  metadata: Record<string, unknown>;
  collection: string;
}

export class VectorStore {
  constructor();
  // reads CHROMA_URL env var (default: "http://chromadb:8000")

  async upsert(opts: {
    collection: string;
    id: string;
    embedding: number[];
    text: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;

  async search(
    collection: string,
    embedding: number[],
    limit?: number,
  ): Promise<VectorSearchResult[]>;

  async searchAll(
    embedding: number[],
    limit?: number,
  ): Promise<VectorSearchResult[]>;
  // Searches both collections, merges results, re-ranks by score, returns top limit.

  async delete(collection: string, id: string): Promise<void>;

  async getEmbedding(collection: string, id: string): Promise<number[] | null>;
  // Returns null if not found.
}

export class VectorStoreUnavailableError extends Error {}

export function getVectorStore(): VectorStore;
// Returns a module-level singleton.
```

**Dependencies:** `chromadb` npm package (add to `package.json`).

**Error handling:** All methods must throw `VectorStoreUnavailableError` when ChromaDB is
unreachable. Callers in ingestion and generation must catch this and degrade gracefully.

---

### RAGPipeline — real implementation (`src/rag/index.ts`)

**Purpose:** Replace the placeholder class with a real implementation that delegates to
`EmbeddingService` and `VectorStore`. This file is the public API surface for the rest of the
app — external callers import from `src/rag/index.ts`.

**Replace the current stub with:**
```typescript
export class RAGPipeline {
  private embeddingService: EmbeddingService;
  private vectorStore: VectorStore;

  constructor() {
    this.embeddingService = getEmbeddingService();
    this.vectorStore = getVectorStore();
  }

  async addDocument(doc: Document): Promise<void>;
  // Embeds doc.content, upserts into project_docs collection.
  // Throws on validation errors, swallows embedding/vector errors with warning.

  async search(query: string, limit = 5): Promise<SearchResult[]>;
  // Embeds query, searches both collections, returns merged ranked results.
  // Returns [] if vector store is unavailable.

  async generateContext(query: string): Promise<string>;
  // Calls search(), formats results as a markdown block.
  // Returns "" on any failure.

  async indexPSA(id: string, content: string, metadata: Record<string, unknown>): Promise<void>;
  // Embeds and upserts a generated PSA into the psas collection.
}
```

Keep the existing `Document`, `SearchResult` interfaces unchanged (they are the right shape).

---

### RAG Router (routes in `src/index.ts`)

**Purpose:** Add two RAG HTTP endpoints to the existing Express app.

Register after the existing `app.use('/api', requireApiKey)` block:

```typescript
import { ragPipeline } from './rag/index.js';

app.post('/api/rag/ingest', async (req, res) => { ... });
app.get('/api/rag/search', async (req, res) => { ... });
```

See API Endpoints section for full request/response contracts.

---

### PSA Generator integration

**Purpose:** Before generating a PSA, retrieve relevant project docs and past PSAs and inject
them into the template as a `ragContext` variable.

This spec does not dictate whether generation uses an LLM or pure template rendering — it
specifies only the retrieval contract. The template system already declares `variables` arrays
per template (e.g. `['clientName', 'projectName', 'budget', 'timeline']`). Add `ragContext`
as an optional variable to all templates, and populate it from RAG retrieval.

**Flow in the generation handler:**
```typescript
const query = `${req.body.projectName} ${req.body.description ?? ''}`;
const context = await ragPipeline.generateContext(query);
const variables = { ...req.body, ragContext: context };
// render template with variables
```

After the PSA is generated, call `ragPipeline.indexPSA(id, renderedContent, metadata)`.

---

## API Endpoints

### `POST /api/rag/ingest`

Ingest a document (text or markdown string) into the `project_docs` collection.

**Auth:** `X-API-Key` or `Authorization: Bearer` (existing `requireApiKey` middleware)

**Request body (`application/json`):**
```json
{
  "id": "optional-custom-id",
  "content": "Full document text...",
  "filename": "architecture-overview.md",
  "metadata": {
    "project": "Procurio",
    "type": "architecture"
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `content` | yes | Plain text or markdown content |
| `filename` | yes | Original filename (for display in search results) |
| `id` | no | Custom ID; auto-generated (UUID) if omitted |
| `metadata` | no | Arbitrary key-value pairs stored alongside the vector |

**Validation:**
- `content` must be non-empty string, max 500 KB.
- `filename` must match `[a-zA-Z0-9._\-]+\.[a-z]{1,10}` (no path components).

**Response `201`:**
```json
{
  "id": "d4e5f6a7",
  "filename": "architecture-overview.md",
  "indexed": true,
  "ingestedAt": "2026-03-15T10:00:00.000Z"
}
```

**Response `400`:** Validation error.
**Response `503`:** `{ "error": "Vector store unavailable — document not indexed" }` — return
`201` with `"indexed": false` so clients know the document was accepted but not searchable.

---

### `GET /api/rag/search`

Semantic search across both collections.

**Auth:** `requireApiKey`

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | required | Search query |
| `limit` | int | 5 | Max results (1–20) |
| `collection` | string | `"all"` | `"psas"`, `"project_docs"`, or `"all"` |

**Response `200`:**
```json
{
  "query": "microservices deployment kubernetes",
  "results": [
    {
      "id": "d4e5f6a7",
      "collection": "project_docs",
      "text": "...",
      "score": 0.09,
      "metadata": {
        "filename": "architecture-overview.md",
        "project": "Procurio"
      }
    }
  ]
}
```

**Response `400`:** `{ "error": "query parameter 'q' is required" }`
**Response `503`:** `{ "error": "Vector store unavailable" }` with empty `results: []`
(do not return 503 status — return 200 with degraded response so clients don't hard-fail).

---

## Data Flow

### Ingestion flow

1. Client calls `POST /api/rag/ingest` with `{ content, filename, metadata }`.
2. Request is validated (content non-empty, filename safe).
3. `id` is generated if not provided (`crypto.randomUUID()`, first 8 chars).
4. `EmbeddingService.embed(content)` calls `text-embedding-3-small`.
5. `VectorStore.upsert({ collection: "project_docs", id, embedding, text: content, metadata })`.
6. On step 4–5 failure: return `201` with `indexed: false`, log warning.
7. Return `201` with `{ id, filename, indexed: true, ingestedAt }`.

### Generation flow (RAG-augmented)

1. Client calls `POST /api/psa/generate` (or whichever PSA generation endpoint is added).
2. Handler builds query string from `projectName + description`.
3. `RAGPipeline.generateContext(query)` embeds query, searches both collections.
4. Top results formatted as:
   ```
   ### project_docs: architecture-overview.md
   <excerpt>

   ---
   ### psas: Procurio PSA v2
   <excerpt>
   ```
5. Template is rendered with `ragContext` variable populated.
6. Generated PSA text is passed to `ragPipeline.indexPSA(id, content, { projectName, ... })`.
7. Return rendered PSA to client.
8. On any RAG step failure: `ragContext` is `""`, generation proceeds with static template.

### Search flow

1. Client calls `GET /api/rag/search?q=kubernetes&limit=5`.
2. `EmbeddingService.embed(q)` called.
3. `VectorStore.searchAll(embedding, 5)` queries both collections in parallel, merges by score.
4. Returns `{ query, results }`.

---

## Configuration

New environment variables (add to `.env.example` and `docker-compose.yml` `psa-api` service):

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROMA_URL` | `http://chromadb:8000` | ChromaDB HTTP endpoint — already in `.env.example`, wire to app |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |
| `AI_API_KEY` | — | API key for embedding calls (add to `.env.example`) |
| `AI_BASE_URL` | — | Optional base URL for OpenAI-compatible provider |
| `RAG_ENABLED` | `true` | Set to `false` to skip RAG (generation still works) |
| `RAG_RETRIEVE_LIMIT` | `5` | Max documents injected into generation prompt |

Existing variables already in `.env.example`: `CHROMA_URL`, `LLM_PROVIDER`, `LLM_MODEL`,
`OLLAMA_BASE_URL`. Ensure `AI_API_KEY` / `AI_BASE_URL` are added for non-Ollama providers.

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/rag/embeddings.ts` | Create | `EmbeddingService` class + singleton |
| `src/rag/vector-store.ts` | Create | `VectorStore` class + singleton |
| `src/rag/index.ts` | Replace | Real `RAGPipeline` replacing the placeholder |
| `src/index.ts` | Modify | Add `POST /api/rag/ingest` and `GET /api/rag/search` routes |
| `src/templates/index.ts` | Modify | Add `ragContext` to all template `variables` arrays |
| `src/package.json` | Modify | Add `openai`, `chromadb` to `dependencies` |
| `docker-compose.yml` | Modify | Add `AI_API_KEY`, `AI_BASE_URL`, `EMBEDDING_MODEL`, `RAG_ENABLED`, `RAG_RETRIEVE_LIMIT` to `psa-api` environment; enable ChromaDB service (it is already declared, just uncomment/activate) |
| `.env.example` | Modify | Document `AI_API_KEY`, `AI_BASE_URL`, `EMBEDDING_MODEL`, `RAG_ENABLED`, `RAG_RETRIEVE_LIMIT` |

---

## docker-compose Changes

The ChromaDB service is already declared in `docker-compose.yml`. No new service needed.
Add the following to the `psa-api` environment block:

```yaml
      - CHROMA_URL=${CHROMA_URL:-http://chromadb:8000}
      - AI_API_KEY=${AI_API_KEY:-}
      - AI_BASE_URL=${AI_BASE_URL:-}
      - EMBEDDING_MODEL=${EMBEDDING_MODEL:-text-embedding-3-small}
      - RAG_ENABLED=${RAG_ENABLED:-true}
      - RAG_RETRIEVE_LIMIT=${RAG_RETRIEVE_LIMIT:-5}
```

Add `depends_on: [chromadb]` to the `psa-api` service (soft — app must tolerate ChromaDB
absence).

---

## Acceptance Criteria

- [ ] `POST /api/rag/ingest` with `{ content: "...", filename: "test.md" }` returns `201`
      with `indexed: true`.
- [ ] `GET /api/rag/search?q=<keyword_from_ingested_doc>` returns the ingested document in
      results with `score < 0.5`.
- [ ] `GET /api/rag/search?q=test&collection=project_docs` returns only `project_docs`
      results.
- [ ] `GET /api/rag/search?q=test&collection=psas` returns only `psas` results.
- [ ] PSA generation endpoint populates `ragContext` when matching documents exist.
- [ ] With ChromaDB stopped: `POST /api/rag/ingest` returns `201` with `indexed: false`;
      generation endpoint returns a PSA (with empty `ragContext`); no 500 errors.
- [ ] With `RAG_ENABLED=false`: search returns `[]`; `ragContext` is always `""`.
- [ ] `POST /api/rag/ingest` with `filename: "../../etc/passwd"` returns `400`.
- [ ] `POST /api/rag/ingest` with `content` exceeding 500 KB returns `400`.
- [ ] All new `/api/rag/*` endpoints reject requests without a valid `X-API-Key`.
- [ ] Generated PSA is indexed in the `psas` collection after generation.

---

## Out of Scope

- File upload (multipart) for ingestion — text/JSON body only in this phase.
- PDF or binary file parsing — plain text and markdown only.
- Chunking strategy for large documents — embed full content up to 8000-character limit.
- Re-indexing previously generated PSAs — only new PSAs are indexed going forward.
- Template UI or web interface changes.
- Hybrid search (BM25 + vector).
- Multi-tenancy or per-project collections.
- Authentication changes — existing `requireApiKey` covers all new endpoints.
