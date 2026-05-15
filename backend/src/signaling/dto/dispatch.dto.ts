import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for `POST /api/signaling/dispatch` — called by the AI service to ring
 * an authenticated on-call user via Socket.IO (or fall back to Web Push).
 */
export class DispatchBodyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(128)
  user_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(128)
  event_id: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(4000)
  script?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(64)
  channel?: string;
}
