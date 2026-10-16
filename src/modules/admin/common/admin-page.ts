import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// API.md 어드민 목록: ?page=&size= (기본 20), 응답 { items, total, page, size }.
// 페이지가 끝을 넘으면 마지막 페이지를 준다 (프론트 목과 같음)
export class AdminPageQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;
}

export function adminPage<T>(items: T[], query: AdminPageQueryDto) {
  const size = query.size ?? 20;
  const total = items.length;
  const last = Math.max(1, Math.ceil(total / size));
  const page = Math.min(query.page ?? 1, last);
  return {
    items: items.slice((page - 1) * size, page * size),
    total,
    page,
    size,
  };
}
