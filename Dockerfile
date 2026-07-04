# syntax=docker/dockerfile:1

# ── base: node + pnpm (pinned via package.json packageManager) ───────────────
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ── deps: full install (dev deps needed to build) ────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ── build: prisma client + compiled dist, then drop dev deps ─────────────────
# pnpm's symlinked node_modules keeps the generated Prisma client inside the
# .pnpm store, so we prune this stage to prod deps and ship its node_modules
# (client included) instead of doing a separate prod-only install.
FROM deps AS build
COPY . .
RUN pnpm prisma generate && pnpm build && pnpm prune --prod

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

# migrations run as a deploy step (pnpm db:deploy), NOT at container start
CMD ["node", "-r", "tsconfig-paths/register", "dist/main.js"]
