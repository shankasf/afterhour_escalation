import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventStatus } from '@prisma/client';

export class CreateEmailEventDto {
  @ApiProperty()
  @IsString()
  subject: string;

  @ApiProperty()
  @IsString()
  body: string;

  @ApiProperty()
  @IsString()
  senderEmail: string;

  @ApiProperty()
  @IsString()
  senderDomain: string;

  @ApiProperty()
  @IsDateString()
  receivedAt: string;
}

export class CreateDialpadEventDto {
  @ApiProperty()
  @IsString()
  senderPhone: string;

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
