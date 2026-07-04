import { Module } from '@nestjs/common';
import { UsersRepository } from './users.repository';

/**
 * Foundation only: exposes the repository for other modules (auth).
 * User-facing endpoints/services arrive with the registration feature.
 */
@Module({
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
