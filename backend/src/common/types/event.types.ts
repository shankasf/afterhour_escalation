/**
 * Type definitions for Event-related JSON fields.
 * Provides type safety for previously untyped JSON data.
 */

export interface ExtractedContext {
  callId?: string;
  callState?: string;
  senderName?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  triageReasoning?: string;
  location?: string;
  equipment?: string;
  isSafetyCritical?: boolean;
  downgradeReason?: string;
  downgradedBy?: string;
  downgradedAt?: string;
}

export interface EscalationLadderContact {
  id: string;
  userId: string;
  name: string;
  phoneNumber: string;
  position: number;
  contactType: 'primary' | 'secondary' | 'fixed';
}

export interface TriageResult {
  decision: 'escalate' | 'monitor' | 'ignore';
  priority: 'low' | 'medium' | 'high' | 'critical';
  emergencyScore: number;
  reasoning: string;
  issueSummary: string;
  location?: string;
  equipment?: string;
  isSafetyCritical?: boolean;
}

export interface EscalationContent {
  voiceScript: string;
  smsMessage: string;
  emailSubject?: string;
}

export interface ClassificationResult {
  emergencyScore: number;
  shouldEscalate: boolean;
  extractedContext: ExtractedContext;
  reasoning?: string;
}
