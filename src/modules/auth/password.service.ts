import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * argon2id with OWASP-recommended parameters (19 MiB memory, 2 iterations).
 * Not used by any flow yet — this is the hashing foundation the registration
 * feature will build on. Exported from AuthModule.
 */
@Injectable()
export class PasswordService {
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  };

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
