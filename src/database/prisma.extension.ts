import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Models that use soft delete. Add a model here (it must have a `deletedAt`
 * column) and every read automatically filters deleted rows, while `delete`
 * / `deleteMany` become updates that stamp `deletedAt`.
 *
 * Escape hatches:
 *  - `findUnique` is NOT intercepted (unique lookups keep their types);
 *    repositories should prefer `findFirst({ where: { id } })` for
 *    soft-deletable models.
 *  - To read deleted rows explicitly, pass `deletedAt: { not: null }` (or any
 *    explicit `deletedAt` condition) in `where` — the spread below lets an
 *    explicit condition win.
 */
const SOFT_DELETE_MODELS: ReadonlySet<Prisma.ModelName> = new Set(['User', 'Address']);

function isSoftDeletable(model: string): boolean {
  return SOFT_DELETE_MODELS.has(model as Prisma.ModelName);
}

type WhereArgs = { where?: Record<string, unknown> };

function withNotDeleted<T extends WhereArgs>(args: T): T {
  return { ...args, where: { deletedAt: null, ...args.where } };
}

/** Untyped-but-safe access to a model delegate for the delete→update rewrite. */
type ModelDelegate = {
  delete: (args: unknown) => Promise<unknown>;
  deleteMany: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  updateMany: (args: unknown) => Promise<unknown>;
};

function delegateFor(client: PrismaClient, model: string): ModelDelegate {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  return (client as unknown as Record<string, ModelDelegate>)[key]!;
}

/**
 * Creates the application Prisma client:
 *  - query/warn/error events routed through the Nest logger (→ pino)
 *  - soft-delete behaviour applied to the models listed above
 */
export function createPrismaClient(options: { logQueries: boolean }) {
  const logger = new Logger('Prisma');

  const base = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  if (options.logQueries) {
    base.$on('query', (e) => logger.debug(`${e.query} — ${e.duration}ms`));
  }
  base.$on('warn', (e) => logger.warn(e.message));
  base.$on('error', (e) => logger.error(e.message));

  return base.$extends({
    name: 'softDelete',
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          return query(isSoftDeletable(model) ? withNotDeleted(args) : args);
        },
        async findFirst({ model, args, query }) {
          return query(isSoftDeletable(model) ? withNotDeleted(args) : args);
        },
        async count({ model, args, query }) {
          return query(isSoftDeletable(model) ? withNotDeleted(args) : args);
        },
        delete({ model, args }) {
          const delegate = delegateFor(base, model);
          if (!isSoftDeletable(model)) {
            return delegate.delete(args);
          }
          return delegate.update({
            where: (args as WhereArgs).where,
            data: { deletedAt: new Date() },
          });
        },
        deleteMany({ model, args }) {
          const delegate = delegateFor(base, model);
          if (!isSoftDeletable(model)) {
            return delegate.deleteMany(args);
          }
          return delegate.updateMany({
            where: (args as WhereArgs).where,
            data: { deletedAt: new Date() },
          });
        },
      },
    },
  });
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;
