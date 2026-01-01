export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: 'ADMIN' | 'VIEWER';
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: string;
  source: 'EMAIL' | 'DIALPAD' | 'MANUAL';
  senderEmail?: string;
  senderPhone?: string;
  subject?: string;
  body: string;
  emergencyScore: number;
  classificationReason?: string;
  isEmergency: boolean;
  status: 'NEW' | 'ESCALATING' | 'ACKNOWLEDGED' | 'RESOLVED' | 'EXPIRED' | 'DOWNGRADED';
  acknowledgedById?: string;
  acknowledgedBy?: User;
  acknowledgedAt?: string;
  createdAt: string;
  updatedAt: string;
  escalationLogs: EscalationLog[];
}

export interface EscalationLog {
  id: string;
  eventId: string;
  escalationContactId?: string;
  contact?: EscalationContact;
  onCallUserId?: string;
  onCallUser?: User;
  contactPhone: string;
  contactName: string;
  escalationStep: number;
  callSid?: string;
  callStatus: 'PENDING' | 'INITIATED' | 'RINGING' | 'ANSWERED' | 'COMPLETED' | 'FAILED' | 'NO_ANSWER' | 'BUSY';
  smsSid?: string;
  smsStatus: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'UNDELIVERED';
  startedAt: string;
  completedAt?: string;
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

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  services: {
    database: boolean;
    aiService: boolean;
    emailPoller: boolean;
    twilio?: boolean;
    dialpad?: boolean;
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
