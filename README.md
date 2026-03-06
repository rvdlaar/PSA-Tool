# PSA Tool

Professional Services Automation Tool with RAG capabilities.

## Features

- REST API with health endpoint
- RAG pipeline for document retrieval
- PSA templates management
- Web UI (coming soon)
- CLI tool

## Quick Start

```bash
# Install dependencies
pnpm install

# Start with Docker
docker compose up -d

# Or run locally
pnpm dev
```

## Architecture

```
psa-tool/
├── src/           # API (Express)
│   ├── rag/       # RAG pipeline
│   └── templates/ # PSA templates
├── ui/            # Web frontend
└── cli/           # CLI tool
```

## API Endpoints

- `GET /health` - Health check
- `GET /api` - API info
- `GET /api/templates` - List templates
- `GET /api/rag` - RAG status

## Environment

Copy `.env.example` to `.env` and configure as needed.

## Docker

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

Data persists via Docker volumes.
