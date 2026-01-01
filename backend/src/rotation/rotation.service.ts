import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { OnCallRotation, ContactType } from '@prisma/client';

@Injectable()
export class RotationService {
  private readonly logger = new Logger(RotationService.name);

  constructor(private prisma: PrismaService) {}

  async getAllRotations(): Promise<OnCallRotation[]> {
    return this.prisma.onCallRotation.findMany({
      include: {
        primaryUser: { select: { id: true, name: true, phoneNumber: true, email: true } },
        secondaryUser: { select: { id: true, name: true, phoneNumber: true, email: true } },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  async getCurrentRotation(): Promise<OnCallRotation | null> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.onCallRotation.findFirst({
      where: {
        startDate: { lte: today },
        endDate: { gte: today },
      },
      include: {
        primaryUser: { select: { id: true, name: true, phoneNumber: true, email: true } },
        secondaryUser: { select: { id: true, name: true, phoneNumber: true, email: true } },
      },
    });
  }

  async getUpcomingRotations(weeks: number = 4): Promise<OnCallRotation[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + weeks * 7);

    return this.prisma.onCallRotation.findMany({
      where: {
        startDate: { gte: today },
        endDate: { lte: futureDate },
      },
      include: {
        primaryUser: { select: { id: true, name: true, phoneNumber: true } },
        secondaryUser: { select: { id: true, name: true, phoneNumber: true } },
      },
      orderBy: { startDate: 'asc' },
    });
  }

  async createRotation(data: {
    startDate: Date;
    endDate: Date;
    primaryUserId: string;
    secondaryUserId: string;
  }): Promise<OnCallRotation> {
    const rotation = await this.prisma.onCallRotation.create({
      data: {
        startDate: data.startDate,
        endDate: data.endDate,
        primaryUserId: data.primaryUserId,
        secondaryUserId: data.secondaryUserId,
      },
      include: {
        primaryUser: true,
        secondaryUser: true,
      },
    });

    // Update escalation contacts for this rotation period
    await this.updateEscalationContacts(
      data.primaryUserId,
      data.secondaryUserId,
    );

    return rotation;
  }

  async updateRotation(
    id: string,
    data: Partial<{
      startDate: Date;
      endDate: Date;
      primaryUserId: string;
      secondaryUserId: string;
    }>,
  ): Promise<OnCallRotation> {
    return this.prisma.onCallRotation.update({
      where: { id },
      data,
      include: {
        primaryUser: true,
        secondaryUser: true,
      },
    });
  }

  async deleteRotation(id: string): Promise<void> {
    await this.prisma.onCallRotation.delete({ where: { id } });
  }

  private async updateEscalationContacts(
    primaryUserId: string,
    secondaryUserId: string,
  ): Promise<void> {
    // Deactivate old primary/secondary contacts
    await this.prisma.escalationContact.updateMany({
      where: {
        contactType: { in: [ContactType.primary, ContactType.secondary] },
      },
      data: { isActive: false },
    });

    // Create or update primary contact
    await this.prisma.escalationContact.upsert({
      where: {
        userId_contactType: {
          userId: primaryUserId,
          contactType: ContactType.primary,
        },
      },
      update: { isActive: true, position: 1 },
      create: {
        userId: primaryUserId,
        contactType: ContactType.primary,
        position: 1,
        isActive: true,
      },
    });

    // Create or update secondary contact
    await this.prisma.escalationContact.upsert({
      where: {
        userId_contactType: {
          userId: secondaryUserId,
          contactType: ContactType.secondary,
        },
      },
      update: { isActive: true, position: 2 },
      create: {
        userId: secondaryUserId,
        contactType: ContactType.secondary,
        position: 2,
        isActive: true,
      },
    });
  }

  // Run every Sunday at midnight to generate next week's rotation
  @Cron(CronExpression.EVERY_WEEK)
  async generateWeeklyRotation(): Promise<void> {
    this.logger.log('Generating weekly rotation...');

    // Get the two rotating users (Jordan and Christina)
    const rotatingUsers = await this.prisma.user.findMany({
      where: {
        email: { in: ['jordan@company.com', 'christina@company.com'] },
        isActive: true,
      },
    });

    if (rotatingUsers.length !== 2) {
      this.logger.warn('Could not find both rotating users');
      return;
    }

    // Get last rotation to determine who was primary
    const lastRotation = await this.prisma.onCallRotation.findFirst({
      orderBy: { endDate: 'desc' },
    });

    // Calculate next week dates
    const today = new Date();
    const nextSunday = new Date(today);
    nextSunday.setDate(today.getDate() + (7 - today.getDay()));
    nextSunday.setHours(0, 0, 0, 0);

    const nextSaturday = new Date(nextSunday);
    nextSaturday.setDate(nextSunday.getDate() + 6);

    // Alternate primary/secondary
    let primaryId: string;
    let secondaryId: string;

    if (lastRotation) {
      // Swap from last rotation
      primaryId = lastRotation.secondaryUserId;
      secondaryId = lastRotation.primaryUserId;
    } else {
      // First rotation - Jordan primary, Christina secondary
      primaryId = rotatingUsers.find(u => u.email === 'jordan@company.com')?.id || rotatingUsers[0].id;
      secondaryId = rotatingUsers.find(u => u.email === 'christina@company.com')?.id || rotatingUsers[1].id;
    }

    // Create the rotation
    await this.createRotation({
      startDate: nextSunday,
      endDate: nextSaturday,
      primaryUserId: primaryId,
      secondaryUserId: secondaryId,
    });

    this.logger.log('Weekly rotation generated successfully');
  }
}
