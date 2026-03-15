FROM node:22-slim
WORKDIR /app

RUN apt-get update && apt-get install -y curl python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY src/package.json src/
COPY src/rag/package.json src/rag/
COPY src/templates/package.json src/templates/
COPY ui/package.json ui/
COPY cli/package.json cli/

RUN pnpm install --frozen-lockfile || pnpm install

COPY . .

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["pnpm", "--filter", "@psa-tool/api", "dev"]
