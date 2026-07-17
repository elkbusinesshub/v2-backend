import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { toRoles } from '@/common/utils/roles';
import { ProfileDto, UpdateProfileDto } from './users.dto';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  async getProfile(userId: string): Promise<ProfileDto> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new ResourceNotFoundException('User');
    }
    return toProfile(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<ProfileDto> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new ResourceNotFoundException('User');
    }
    // Nothing to change (all fields optional) — return the profile as-is.
    if (dto.name === undefined && dto.email === undefined && dto.language === undefined) {
      return toProfile(user);
    }
    // Duplicate email surfaces as Prisma P2002 → 409 via AllExceptionsFilter.
    const updated = await this.users.updateProfile(userId, dto);
    return toProfile(updated);
  }
}

function toProfile(user: User): ProfileDto {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    name: user.name,
    language: user.language,
    roles: toRoles(user.roles),
  };
}
