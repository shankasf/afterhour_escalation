export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  phoneNumber?: string; // Backend uses phoneNumber
  role: 'ADMIN' | 'VIEWER';
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: string;
  source: 'EMAIL' | 'CHAT' | 'MANUAL' | 'DIALPAD';
  senderEmail?: string;
  senderPhone?: string;
  subject?: string;
  body: string;
  emergencyScore: number;
  classificationReason?: string;
  isEmergency: boolean;
  status: 'NEW' | 'ESCALATING' | 'ACKNOWLEDGED' | 'RESOLVED' | 'EXPIRED' | 'DOWNGRADED' | 'MISSED' | 'CLOSED';
  acknowledgedById?: string;
  acknowledgedBy?: User;
  acknowledgedAt?: string;
  receivedAt?: string;
  createdAt: string;
  updatedAt: string;
  escalationLogs: EscalationLog[];
}

export interface EscalationLog {
  id: string;
  eventId: string;
  contactId: string;
  userId: string;
  contact?: {
    id: string;
    userId: string;
    position: number;
    user?: User;
  };
  user?: User;
  attemptNumber: number;
  callSid?: string;
  callStatus: 'not_called' | 'initiated' | 'ringing' | 'in_progress' | 'answered' | 'completed' | 'no_answer' | 'busy' | 'failed' | 'cancelled';
  smsSid?: string;
  smsStatus: 'not_sent' | 'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed';
  acknowledgmentReceived: boolean;
  acknowledgedAt?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface EscalationContact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  escalationOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OnCallRotation {
  id: string;
  userId: string;
  user: User;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  createdAt: string;
}

export interface Acknowledgment {
  id: string;
  eventId: string;
  event: Event;
  userId?: string;
  user?: User;
  method: 'SMS' | 'VOICE' | 'WEB' | 'DTMF';
  phone?: string;
  notes?: string;
  createdAt: string;
}

export interface AdminAlert {
  id: string;
  type: 'ESCALATION_FAILURE' | 'SLA_BREACH' | 'SYSTEM_ERROR' | 'CONFIGURATION_ERROR';
  title: string;
  message: string;
  eventId?: string;
  event?: Event;
  acknowledged: boolean;
  acknowledgedById?: string;
  acknowledgedAt?: string;
  createdAt: string;
}

export interface SystemSetting {
  id: string;
  key: string;
  value: string;
  description?: string;
  updatedAt: string;
}

export interface EmergencyKeyword {
  id: string;
  keyword: string;
  weight: number;
  active: boolean;
  createdAt: string;
}

export interface DailyMetric {
  id: string;
  date: string;
  totalEvents: number;
  emergencyEvents: number;
  nonEmergencyEvents: number;
  acknowledgedCount: number;
  avgAckTimeSeconds?: number;
  slaBreaches: number;
  createdAt: string;
}

export type ServiceStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ServiceHealth {
  status: ServiceStatus;
  latency?: number;
  lastPoll?: string;
}

export interface HealthStatus {
  status: ServiceStatus;
  services: {
    database: ServiceHealth;
    aiService: ServiceHealth;
    emailPoller: ServiceHealth;
  };
  uptime: number;
  timestamp: string;
}

export interface DashboardStats {
  activeEvents: number;
  todayEvents: number;
  acknowledgedToday: number;
  avgAckTimeMinutes: number;
  slaBreaches: number;
  currentOnCall?: {
    name: string;
    phone: string;
    startDate: string;
    endDate: string;
  };
}

export interface AuthResponse {
  access_token: string;
  user: User;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Comprehensive AI and Business Metrics
export interface ComprehensiveMetrics {
  aiMetrics: {
    totalEventsProcessed: number;
    aiSummariesGenerated: number;
    emergencyDetectionRate: number;
    falsePositiveRate: number;
    avgEmergencyScore: number;
    highConfidenceClassifications: number;
  };
  escalationMetrics: {
    totalEscalations: number;
    successfulEscalations: number;
    escalationSuccessRate: number;
    avgEscalationDepth: number;
    firstContactResolutionRate: number;
    missedEscalations: number;
    escalationsInProgress: number;
  };
  communicationMetrics: {
    totalCallsMade: number;
    callsAnswered: number;
    callAnswerRate: number;
    totalSmsSent: number;
    smsDelivered: number;
    smsDeliveryRate: number;
    voicemailsReceived: number;
  };
  responseTimeMetrics: {
    avgResponseTimeMinutes: number;
    medianResponseTimeMinutes: number;
    p95ResponseTimeMinutes: number;
    fastestResponseMinutes: number;
    slowestResponseMinutes: number;
    slaComplianceRate: number;
    slaBreaches: number;
  };
  sourceMetrics: {
    emailEvents: number;
    chatEvents: number;
    emailPercentage: number;
    chatPercentage: number;
  };
  businessImpactMetrics: {
    afterHoursEventsHandled: number;
    eventsResolvedAutomatically: number;
    potentialSalesSaved: number;
    avgHandlingTimeMinutes: number;
    customerInquiriesCovered: number;
    downgradedNonEmergencies: number;
    timeSlotDistribution: Record<string, number>;
  };
  trendMetrics: {
    dailyEventTrend: Array<{ date: string; count: number }>;
    weekOverWeekChange: number;
    peakHour: number;
    peakDay: string;
  };
  contactPerformance: Array<{
    contactName: string;
    contactPhone?: string;
    totalAssigned: number;
    acknowledged: number;
    responseRate: number;
    avgResponseTimeMinutes: number;
  }>;
}
