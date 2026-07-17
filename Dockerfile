# syntax=docker/dockerfile:1

# ── base: node ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
WORKDIR /app

# ── deps: full install (dev deps needed to build) ────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=npm,target=/root/.npm npm ci

# ── build: prisma client + compiled dist, then drop dev deps ─────────────────
FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

# ── runner: minimal, non-root ────────────────────────────────────────────────
FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV TS_NODE_PROJECT=tsconfig.paths-runtime.json
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json tsconfig.json tsconfig.paths-runtime.json ./
COPY --chown=node:node prisma ./prisma

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# migrations run as a deploy step (npm run db:deploy), NOT at container start
CMD ["node", "-r", "tsconfig-paths/register", "dist/main.js"]
