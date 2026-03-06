# PSA Tool - Dockerfile
FROM node:22-slim

WORKDIR /app

# Install pnpm for workspace support
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-workspace.yaml ./
COPY src/package.json src/
COPY src/rag/package.json src/rag/
COPY src/templates/package.json src/templates/
COPY ui/package.json ui/
COPY cli/package.json cli/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY src/ src/
COPY ui/ ui/
COPY cli/ cli/

# Build
RUN pnpm build

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["pnpm", "start"]
