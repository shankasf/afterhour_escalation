/**
 * Escalation Ladder Builder Service
 * Responsible for building the escalation ladder from rotation and fixed contacts.
 * Single responsibility: Build escalation contact ladders.
 */

import { Injectable, Logger } from '@nestjs/common';
import { RotationService } from '../../rotation/rotation.service';
import { EscalationRepository } from '../repositories/escalation.repository';
import { EscalationLadderContact } from '../../common/types/event.types';

@Injectable()
export class LadderBuilderService {
  private readonly logger = new Logger(LadderBuilderService.name);

  constructor(
    private readonly rotationService: RotationService,
    private readonly escalationRepository: EscalationRepository,
  ) {}

  /**
   * Build the complete escalation ladder including rotation and fixed contacts.
   */
  async buildLadder(): Promise<EscalationLadderContact[]> {
    const ladder: EscalationLadderContact[] = [];

    // Add rotation contacts (primary and secondary)
    await this.addRotationContacts(ladder);

    // Add fixed contacts
    await this.addFixedContacts(ladder);

    this.logger.debug(`Built escalation ladder with ${ladder.length} contacts`);
    return ladder;
  }

  private async addRotationContacts(ladder: EscalationLadderContact[]): Promise<void> {
    const rotation = await this.rotationService.getCurrentRotation();

    if (!rotation) {
      this.logger.warn('No current rotation found');
      return;
    }

    // Add primary on-call
    const primaryContact = await this.escalationRepository.findContactByUserId(
      rotation.primaryUserId,
      'primary',
    );

    if (primaryContact && (primaryContact as any).user) {
      ladder.push({
        id: primaryContact.id,
        userId: primaryContact.userId,
        name: (primaryContact as any).user.name,
        phoneNumber: (primaryContact as any).user.phoneNumber || '',
        position: 1,
        contactType: 'primary',
      });
    }

    // Add secondary on-call
    const secondaryContact = await this.escalationRepository.findContactByUserId(
      rotation.secondaryUserId,
      'secondary',
    );

    if (secondaryContact && (secondaryContact as any).user) {
      ladder.push({
        id: secondaryContact.id,
        userId: secondaryContact.userId,
        name: (secondaryContact as any).user.name,
        phoneNumber: (secondaryContact as any).user.phoneNumber || '',
        position: 2,
        contactType: 'secondary',
      });
    }
  }

  private async addFixedContacts(ladder: EscalationLadderContact[]): Promise<void> {
    const fixedContacts = await this.escalationRepository.findFixedContacts();

    for (const contact of fixedContacts) {
      if ((contact as any).user) {
        ladder.push({
          id: contact.id,
          userId: contact.userId,
          name: (contact as any).user.name,
          phoneNumber: (contact as any).user.phoneNumber || '',
          position: contact.position,
          contactType: 'fixed',
        });
      }
    }
  }
}
