/**
 * Escalation Ladder Builder Service
 *
 * Active-pool model: the ladder is the set of users with role IN
 * (on_call, admin), an active account, currently marked on duty, and
 * not flagged unavailable. Ordered by onDutyPriority ASC. Admin toggles
 * staff on/off duty from the Rotation page.
 *
 * Replaces the prior primary/secondary/fixed split — the contact_type
 * column is still in the schema for historical events but no longer
 * affects routing.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '@prisma/client';
import { EscalationLadderContact } from '../../common/types/event.types';

@Injectable()
export class LadderBuilderService {
  private readonly logger = new Logger(LadderBuilderService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the escalation ladder from the on-duty staff pool.
   */
  async buildLadder(): Promise<EscalationLadderContact[]> {
    const now = new Date();
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        onDuty: true,
        role: { in: [UserRole.on_call, UserRole.admin] },
        OR: [{ unavailableUntil: null }, { unavailableUntil: { lt: now } }],
      },
      orderBy: [
        { onDutyPriority: 'asc' },
        { name: 'asc' },
      ],
    });

    const ladder: EscalationLadderContact[] = users.map((user, idx) => ({
      id: user.id,
      userId: user.id,
      name: user.name,
      phoneNumber: user.phoneNumber || '',
      position: idx + 1,
      contactType: 'on_duty',
    }));

    this.logger.log({
      message: 'Escalation ladder built (active-pool)',
      contactCount: ladder.length,
      contacts: ladder.map((c) => ({
        userId: c.userId,
        position: c.position,
        name: c.name,
      })),
    });

    if (ladder.length === 0) {
      this.logger.warn(
        'Escalation ladder is empty — no staff are currently on duty. Toggle staff on the Rotation page.',
      );
    }

    return ladder;
  }
}
