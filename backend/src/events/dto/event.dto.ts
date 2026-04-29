import { IsString, IsOptional, IsEnum, IsDateString, IsNumber, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventStatus } from '@prisma/client';

export class CreateEmailEventDto {
  @ApiProperty()
  @IsString()
  subject: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  body?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  rawContent?: string;

  @ApiProperty()
  @IsString()
  senderEmail: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  senderName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  senderDomain?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  receivedAt?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  emergencyScore?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  aiSummary?: string;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  extractedContext?: Record<string, any>;
}

export class UpdateEventStatusDto {
  @ApiProperty({ enum: EventStatus })
  @IsEnum(EventStatus)
  status: EventStatus;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  userId?: string;
}
