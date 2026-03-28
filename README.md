# PSA Tool

AI-powered Project Start Architecture generator with RAG, quality validation, and structured output. Download, double-click, describe your project — AI runs locally, no setup required.

## What It Does

Describe a project and it generates a comprehensive architecture blueprint:
- **Executive Summary** — what, why, and how in 2-3 paragraphs
- **Project Scope** — in scope, out of scope, assumptions
- **Technical Architecture** — components, data flow, integration points
- **Key Decisions** — comparison table with rationale and rejected alternatives
- **Dependencies** — who/what, owner, risk if delayed, mitigation
- **Risks** — likelihood, impact, mitigation per risk
- **Timeline** — milestones with concrete deliverables
- **Success Criteria** — specific, measurable outcomes
- **Team Impact** — per-role involvement and responsibilities

Feed it your existing docs (point to a folder) and it generates context-aware PSAs consistent with prior project decisions.

## Quick Start

### Option A: Download & Run (Recommended)

No Docker, no terminal, no API keys needed.

1. **Download** the latest release from [Releases](https://github.com/rvdlaar/PSA-Tool/releases)
2. **Unzip** to any folder
3. **Double-click** `PSA-Tool.exe` (Windows) or `PSA-Tool` (macOS)
4. **Browser opens** — describe your project, get a complete architecture blueprint

Everything runs locally. A bundled language model handles generation and quality validation — no cloud services, no API keys, no data leaving your device.

> **Power users:** Want to use your own OpenRouter key, Azure OpenAI, or local Ollama? Configure via **Settings** or set `AI_API_KEY` in `.env`.

### Option B: Docker Compose (Power Users)

Full control over models and providers.

```bash
git clone https://github.com/rvdlaar/PSA-Tool.git
cd PSA-Tool
cp .env.example .env
# Optionally set AI_API_KEY in .env for your own provider
docker compose up -d
# Open http://localhost:3001
```

Two services: PSA API (port 3001) + ChromaDB for vector search (port 8003).

### Option C: IT Deployment (Intune/MDM)

Same bundle as Option A, wrapped in MSIX/MSI for managed devices. IT admins can pre-configure by placing a `config.json` in the `data/` folder (e.g., pointing AI at a corporate Azure OpenAI endpoint). Users open the app — no setup required.

## Using the Frontend

1. Open `http://localhost:3001`
2. Click **New** — enter project name and description
3. Optionally: paste folder path → **Scan** → **Ingest all** (indexes docs for RAG)
4. Optionally: expand requirements, constraints, team details
5. Click **Generate PSA**
6. Review — edit sections inline
7. **Accept** or **Start over**

Keyboard: `Cmd+N` (new), `Cmd+K` (search), `Esc` (back)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/psa/generate` | Generate PSA with RAG + validation |
| `GET` | `/api/psa` | List PSAs |
| `GET` | `/api/psa/:id` | Get single PSA with sections |
| `POST` | `/api/rag/ingest` | Ingest a document |
| `GET` | `/api/rag/search?q=...` | Semantic search |
| `POST` | `/api/rag/scan` | Scan folder for files |
| `POST` | `/api/rag/ingest-files` | Ingest files (SSE progress) |
| `GET` | `/api/rag/docs` | List ingested documents |
| `GET` | `/api/templates` | List PSA templates |
| `GET` | `/health` | Health check |

## Configuration

```bash
AI_API_KEY=                           # Required for generation
AI_MODEL=gpt-4o-mini                  # LLM model
AI_BASE_URL=                          # For alternative providers
EMBEDDING_MODEL=text-embedding-3-small
CHROMA_URL=http://chromadb:8000
PSA_API_KEY=                          # API key (empty = open access)
PORT=3000
```

## Architecture

```
PSA Tool
├── Express API (TypeScript)
├── SQLite (psas + ingested_docs, WAL mode)
├── ChromaDB (psas + project_docs collections)
└── OpenAI-compatible LLM (generation + embeddings)
```

## License

MIT
