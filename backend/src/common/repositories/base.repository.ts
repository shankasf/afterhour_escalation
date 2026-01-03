/**
 * Base Repository Pattern Implementation
 * Provides abstraction layer between services and database access.
 * Enables loose coupling and easier testing.
 */

export interface IRepository<T, CreateDto, UpdateDto> {
  findById(id: string): Promise<T | null>;
  findMany(options?: FindManyOptions): Promise<T[]>;
  create(data: CreateDto): Promise<T>;
  update(id: string, data: UpdateDto): Promise<T>;
  delete(id: string): Promise<void>;
  count(where?: Record<string, unknown>): Promise<number>;
}

export interface FindManyOptions {
  where?: Record<string, unknown>;
  orderBy?: Record<string, 'asc' | 'desc'>;
  take?: number;
  skip?: number;
  include?: Record<string, unknown>;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
