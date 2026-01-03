import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SystemSetting, EmergencyKeyword } from '@prisma/client';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  // System Settings
  async getAllSettings(): Promise<SystemSetting[]> {
    return this.prisma.systemSetting.findMany();
  }

  async getSetting(key: string): Promise<string | null> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
    return setting?.value || null;
  }

  // Alias for getSetting for convenience
  async get(key: string): Promise<string | null> {
    return this.getSetting(key);
  }

  async updateSetting(
    key: string,
    value: string,
    userId: string,
  ): Promise<SystemSetting> {
    return this.prisma.systemSetting.upsert({
      where: { key },
      update: { value, updatedById: userId },
      create: { key, value, updatedById: userId },
    });
  }

  async getEmergencyThreshold(): Promise<number> {
    const value = await this.getSetting('emergency_score_threshold');
    return parseFloat(value || '0.6');
  }

  async getAckTimeout(): Promise<number> {
    const value = await this.getSetting('acknowledgment_timeout_seconds');
    return parseInt(value || '120', 10);
  }

  // Emergency Keywords
  async getAllKeywords(): Promise<EmergencyKeyword[]> {
    return this.prisma.emergencyKeyword.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { weight: 'desc' }],
    });
  }

  async createKeyword(data: {
    keyword: string;
    weight: number;
    category?: string;
    isNegative?: boolean;
  }): Promise<EmergencyKeyword> {
    return this.prisma.emergencyKeyword.create({
      data: {
        keyword: data.keyword.toLowerCase(),
        weight: data.weight,
        category: data.category,
        isNegative: data.isNegative || false,
        isActive: true,
      },
    });
  }

  async updateKeyword(
    id: string,
    data: Partial<{
      keyword: string;
      weight: number;
      category: string;
      isNegative: boolean;
      isActive: boolean;
    }>,
  ): Promise<EmergencyKeyword> {
    return this.prisma.emergencyKeyword.update({
      where: { id },
      data,
    });
  }

  async deleteKeyword(id: string): Promise<void> {
    await this.prisma.emergencyKeyword.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
