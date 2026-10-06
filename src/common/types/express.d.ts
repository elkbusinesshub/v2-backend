import type { AdminModule } from '@prisma/client';
import type { AuthUser } from './auth.types';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Set by AdminModulesGuard on routes marked @AdminModules. */
      adminModules?: AdminModule[];
    }
  }
}

export {};
