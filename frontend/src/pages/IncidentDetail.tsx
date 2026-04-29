import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  AlertTriangle,
  Send,
  CheckCircle,
  Mail,
  Phone,
  User as UserIcon,
} from 'lucide-react';
import api from '../lib/api';
import { Event } from '../types';
import { formatDateTime, formatRelative, getStatusColor } from '../lib/utils';

interface ChatMessage {
  id: string;
  role: 'customer' | 'employee' | 'system';
  content: string;
  createdAt: string;
}

interface ChatSession {
  sessionToken?: string;
  messages: ChatMessage[];
}

export default function IncidentDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [composer, setComposer] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const { data: event, isLoading } = useQuery<Event>({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const res = await api.get(`/events/${eventId}`);
      return res.data;
    },
    enabled: !!eventId,
  });

  const { data: chat } = useQuery<ChatSession>({
    queryKey: ['customer-chat', eventId],
    queryFn: async () => {
      try {
        const res = await api.get(`/customer-chat/by-event/${eventId}/messages`);
        const data = res.data;
        if (Array.isArray(data)) {
          return { messages: data, sessionToken: undefined };
        }
        return {
          sessionToken: data?.sessionToken,
          messages: data?.messages ?? [],
        };
      } catch {
        return { messages: [] };
      }
    },
    enabled: !!eventId,
    refetchInterval: 5000,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages.length]);

  const sendMessage = useMutation({
    mutationFn: async (content: string) => {
      const sessionToken = chat?.sessionToken;
      if (!sessionToken) throw new Error('No active chat session');
      await api.post(`/customer-chat/${sessionToken}/message`, {
        role: 'employee',
        content,
      });
    },
    onSuccess: () => {
      setComposer('');
      queryClient.invalidateQueries({ queryKey: ['customer-chat', eventId] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="card text-center py-12">
        <p className="text-gray-500">Incident not found</p>
        <button
          onClick={() => navigate(-1)}
          className="btn-primary mt-4"
        >
          Go back
        </button>
      </div>
    );
  }

  const messages = chat?.messages ?? [];

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card space-y-5">
          <header>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className={`badge ${getStatusColor(event.status)}`}>
                {event.status}
              </span>
              {event.isEmergency && (
                <span className="badge badge-emergency">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Emergency
                </span>
              )}
            </div>
            <h1 className="text-lg font-semibold text-gray-900 leading-tight">
              {event.subject || 'No subject'}
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              Created {formatDateTime(event.createdAt)}
            </p>
          </header>

          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs uppercase text-gray-500 font-medium">Source</dt>
              <dd className="flex items-center gap-1.5 mt-1 text-gray-900 font-medium">
                {event.source === 'EMAIL' ? (
                  <Mail className="w-4 h-4 text-blue-600" />
                ) : (
                  <Phone className="w-4 h-4 text-green-600" />
                )}
                {event.source}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-gray-500 font-medium">
                Severity score
              </dt>
              <dd className="mt-1 font-medium text-gray-900">
                {event.emergencyScore}/100
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs uppercase text-gray-500 font-medium">From</dt>
              <dd className="mt-1 text-gray-900 font-medium truncate">
                {event.senderEmail || event.senderPhone || 'Unknown'}
              </dd>
            </div>
            {event.acknowledgedBy && (
              <div className="col-span-2">
                <dt className="text-xs uppercase text-gray-500 font-medium">
                  Acknowledged by
                </dt>
                <dd className="mt-1 flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center">
                    <UserIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {event.acknowledgedBy.name}
                    </p>
                    {event.acknowledgedAt && (
                      <p className="text-xs text-gray-500">
                        {formatRelative(event.acknowledgedAt)}
                      </p>
                    )}
                  </div>
                </dd>
              </div>
            )}
          </dl>

          <div>
            <p className="text-xs uppercase text-gray-500 font-medium mb-2">Body</p>
            <div className="bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">
                {event.body}
              </pre>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase text-gray-500 font-medium mb-2">
              Escalation log
            </p>
            {event.escalationLogs.length === 0 ? (
              <p className="text-sm text-gray-400">No escalation attempts.</p>
            ) : (
              <ul className="space-y-2">
                {event.escalationLogs.map((log) => (
                  <li
                    key={log.id}
                    className={`flex items-center gap-3 p-2 rounded-lg border ${
                      log.acknowledgmentReceived
                        ? 'bg-green-50 border-green-100'
                        : 'bg-white border-gray-100'
                    }`}
                  >
                    {log.acknowledgmentReceived ? (
                      <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                    ) : (
                      <span className="w-4 h-4 rounded-full bg-gray-200 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        Attempt #{log.attemptNumber} ·{' '}
                        {log.contact?.user?.name || log.user?.name || 'Unknown'}
                      </p>
                      <p className="text-xs text-gray-500">
                        Call {log.callStatus} · SMS {log.smsStatus}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400">
                      {formatRelative(log.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="card flex flex-col h-[640px]">
          <header className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
              Customer chat
            </h2>
            {!chat?.sessionToken && messages.length === 0 && (
              <span className="text-xs text-gray-400">No active session</span>
            )}
          </header>

          <div className="flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">
                No messages yet.
              </p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${
                    m.role === 'employee' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      m.role === 'employee'
                        ? 'bg-primary-600 text-white rounded-br-sm'
                        : m.role === 'system'
                        ? 'bg-yellow-50 text-yellow-800 italic'
                        : 'bg-white text-gray-900 border border-gray-100 rounded-bl-sm'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    <p
                      className={`text-[10px] mt-1 ${
                        m.role === 'employee'
                          ? 'text-primary-100'
                          : 'text-gray-400'
                      }`}
                    >
                      {formatRelative(m.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = composer.trim();
              if (!trimmed || !chat?.sessionToken || sendMessage.isPending) return;
              sendMessage.mutate(trimmed);
            }}
            className="mt-3 flex items-end gap-2"
          >
            <textarea
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              rows={2}
              placeholder={
                chat?.sessionToken
                  ? 'Type a reply to the customer...'
                  : 'No active chat session — cannot send messages'
              }
              disabled={!chat?.sessionToken || sendMessage.isPending}
              className="input flex-1 resize-none disabled:bg-gray-50 disabled:text-gray-400"
            />
            <button
              type="submit"
              disabled={
                !composer.trim() || !chat?.sessionToken || sendMessage.isPending
              }
              className="btn-primary flex items-center gap-1.5 self-stretch"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
