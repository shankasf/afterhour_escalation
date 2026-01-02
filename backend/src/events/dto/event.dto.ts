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

export class CreateDialpadEventDto {
  @ApiProperty()
  @IsString()
  senderPhone: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  senderName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  voicemailTranscription?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  voicemailUrl?: string;

  @ApiProperty()
  @IsDateString()
  receivedAt: string;

  @ApiPropertyOptional({ description: 'Dialpad call ID' })
  @IsString()
  @IsOptional()
  callId?: string;

  @ApiPropertyOptional({ description: 'Call state: missed, voicemail, transcription' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ description: 'Emergency score from triage (0.0-1.0)' })
  @IsNumber()
  @IsOptional()
  emergencyScore?: number;

  @ApiPropertyOptional({ description: 'Priority level: critical, high, medium, low' })
  @IsString()
  @IsOptional()
  priority?: string;

  @ApiPropertyOptional({ description: 'AI triage reasoning' })
  @IsString()
  @IsOptional()
  triageReasoning?: string;

  @ApiPropertyOptional({ description: 'Issue summary from AI analysis' })
  @IsString()
  @IsOptional()
  issueSummary?: string;
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
