import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Standard `?page=&limit=` query DTO. Extend it in module-specific queries. */
export class PaginationQuery {
  /** 1-based page number */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  /** Page size (max 100) */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export interface PaginationMeta extends Record<string, unknown> {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function paginationMeta(query: PaginationQuery, total: number): PaginationMeta {
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}
