import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Plus, Trash2, Settings as SettingsIcon, AlertTriangle, Key } from 'lucide-react';
import api from '../lib/api';
import { SystemSetting, EmergencyKeyword } from '../types';

export default function Settings() {
    const queryClient = useQueryClient();
    const [newKeyword, setNewKeyword] = useState('');
    const [newKeywordWeight, setNewKeywordWeight] = useState(10);

    // Queries
    const { data: settings } = useQuery<SystemSetting[]>({
        queryKey: ['settings'],
        queryFn: async () => {
            const res = await api.get('/settings');
            return res.data;
        },
    });

    const { data: keywords } = useQuery<EmergencyKeyword[]>({
        queryKey: ['keywords'],
        queryFn: async () => {
            const res = await api.get('/settings/keywords');
            return res.data;
        },
    });

    // Mutations
    const updateSettingMutation = useMutation({
        mutationFn: async ({ key, value }: { key: string; value: string }) => {
            await api.patch(`/settings/${key}`, { value });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
        },
    });

    const createKeywordMutation = useMutation({
        mutationFn: async (data: { keyword: string; weight: number }) => {
            await api.post('/settings/keywords', data);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['keywords'] });
            setNewKeyword('');
            setNewKeywordWeight(10);
        },
    });

    const deleteKeywordMutation = useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`/settings/keywords/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['keywords'] });
        },
    });

    const getSetting = (key: string) => settings?.find(s => s.key === key)?.value || '';

    const handleSettingChange = (key: string, value: string) => {
        updateSettingMutation.mutate({ key, value });
    };

    return (
        <div>
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
                <p className="text-gray-500">Configure system behavior and escalation rules</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* General Settings */}
                <div className="card">
                    <div className="flex items-center gap-2 mb-6">
                        <SettingsIcon className="w-5 h-5 text-gray-400" />
                        <h2 className="text-lg font-semibold">General Settings</h2>
                    </div>

                    <div className="space-y-6">
                        <SettingField
                            label="Emergency Score Threshold"
                            description="Score above which events are marked as emergencies (0-100)"
                            value={getSetting('emergency_threshold')}
                            type="number"
                            onChange={(value) => handleSettingChange('emergency_threshold', value)}
                        />

                        <SettingField
                            label="Escalation Timeout (seconds)"
                            description="Time to wait before escalating to next contact"
                            value={getSetting('escalation_timeout_seconds')}
                            type="number"
                            onChange={(value) => handleSettingChange('escalation_timeout_seconds', value)}
                        />

                        <SettingField
                            label="Max Escalation Attempts"
                            description="Maximum number of escalation attempts before giving up"
                            value={getSetting('max_escalation_attempts')}
                            type="number"
                            onChange={(value) => handleSettingChange('max_escalation_attempts', value)}
                        />

                        <SettingField
                            label="ACK SLA (minutes)"
                            description="Target time to acknowledge emergencies"
                            value={getSetting('ack_sla_minutes')}
                            type="number"
                            onChange={(value) => handleSettingChange('ack_sla_minutes', value)}
                        />

                        <SettingField
                            label="Business Hours Start"
                            description="When business hours begin (24h format)"
                            value={getSetting('business_hours_start')}
                            type="text"
                            placeholder="09:00"
                            onChange={(value) => handleSettingChange('business_hours_start', value)}
                        />

                        <SettingField
                            label="Business Hours End"
                            description="When business hours end (24h format)"
                            value={getSetting('business_hours_end')}
                            type="text"
                            placeholder="17:00"
                            onChange={(value) => handleSettingChange('business_hours_end', value)}
                        />
                    </div>
                </div>

                {/* Emergency Keywords */}
                <div className="card">
                    <div className="flex items-center gap-2 mb-6">
                        <Key className="w-5 h-5 text-gray-400" />
                        <h2 className="text-lg font-semibold">Emergency Keywords</h2>
                    </div>

                    <p className="text-sm text-gray-500 mb-4">
                        Keywords that trigger emergency classification. Higher weight = stronger signal.
                    </p>

                    {/* Add Keyword Form */}
                    <div className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={newKeyword}
                            onChange={(e) => setNewKeyword(e.target.value)}
                            placeholder="New keyword..."
                            className="input flex-1"
                        />
                        <input
                            type="number"
                            value={newKeywordWeight}
                            onChange={(e) => setNewKeywordWeight(Number(e.target.value))}
                            min="1"
                            max="100"
                            className="input w-20"
                        />
                        <button
                            onClick={() => {
                                if (newKeyword.trim()) {
                                    createKeywordMutation.mutate({
                                        keyword: newKeyword.trim(),
                                        weight: newKeywordWeight,
                                    });
                                }
                            }}
                            disabled={!newKeyword.trim() || createKeywordMutation.isPending}
                            className="btn-primary"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Keywords List */}
                    {keywords && keywords.length > 0 ? (
                        <div className="space-y-2 max-h-[400px] overflow-y-auto">
                            {keywords.sort((a, b) => b.weight - a.weight).map(keyword => (
                                <div
                                    key={keyword.id}
                                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                                >
                                    <div className="flex items-center gap-3">
                                        <AlertTriangle className={`w-4 h-4 ${keyword.weight >= 15 ? 'text-red-500' :
                                                keyword.weight >= 10 ? 'text-yellow-500' : 'text-gray-400'
                                            }`} />
                                        <span className="font-medium">{keyword.keyword}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm text-gray-500">Weight: {keyword.weight}</span>
                                        <button
                                            onClick={() => deleteKeywordMutation.mutate(keyword.id)}
                                            className="text-red-500 hover:text-red-700 p-1"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-500 text-center py-4">No keywords configured</p>
                    )}
                </div>

                {/* Notification Settings */}
                <div className="card">
                    <div className="flex items-center gap-2 mb-6">
                        <AlertTriangle className="w-5 h-5 text-gray-400" />
                        <h2 className="text-lg font-semibold">Notification Settings</h2>
                    </div>

                    <div className="space-y-6">
                        <SettingField
                            label="Admin Email"
                            description="Email address for admin alerts"
                            value={getSetting('admin_email')}
                            type="email"
                            onChange={(value) => handleSettingChange('admin_email', value)}
                        />

                        <SettingField
                            label="Admin Phone"
                            description="Phone number for urgent admin alerts (SMS)"
                            value={getSetting('admin_phone')}
                            type="tel"
                            placeholder="+1234567890"
                            onChange={(value) => handleSettingChange('admin_phone', value)}
                        />
                    </div>
                </div>

                {/* Integration Status */}
                <div className="card">
                    <h2 className="text-lg font-semibold mb-6">Integration Status</h2>

                    <div className="space-y-4">
                        <IntegrationStatus
                            name="Twilio"
                            description="Voice calls and SMS"
                            configured={!!getSetting('twilio_configured')}
                        />
                        <IntegrationStatus
                            name="Dialpad (Optional)"
                            description="Dialpad call integration"
                            configured={!!getSetting('dialpad_configured')}
                            optional
                        />
                        <IntegrationStatus
                            name="Email (Microsoft 365)"
                            description="IMAP email monitoring"
                            configured={!!getSetting('email_configured')}
                        />
                        <IntegrationStatus
                            name="OpenAI"
                            description="AI classification"
                            configured={!!getSetting('openai_configured')}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

function SettingField({
    label,
    description,
    value,
    type,
    placeholder,
    onChange,
}: {
    label: string;
    description: string;
    value: string;
    type: string;
    placeholder?: string;
    onChange: (value: string) => void;
}) {
    const [localValue, setLocalValue] = useState(value);
    const [isDirty, setIsDirty] = useState(false);

    const handleSave = () => {
        onChange(localValue);
        setIsDirty(false);
    };

    return (
        <div>
            <label className="label">{label}</label>
            <p className="text-xs text-gray-500 mb-2">{description}</p>
            <div className="flex gap-2">
                <input
                    type={type}
                    value={localValue}
                    onChange={(e) => {
                        setLocalValue(e.target.value);
                        setIsDirty(e.target.value !== value);
                    }}
                    placeholder={placeholder}
                    className="input flex-1"
                />
                {isDirty && (
                    <button onClick={handleSave} className="btn-primary">
                        <Save className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    );
}

function IntegrationStatus({
    name,
    description,
    configured,
    optional,
}: {
    name: string;
    description: string;
    configured: boolean;
    optional?: boolean;
}) {
    return (
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
                <p className="font-medium">
                    {name}
                    {optional && <span className="text-xs text-gray-400 ml-2">(Optional)</span>}
                </p>
                <p className="text-sm text-gray-500">{description}</p>
            </div>
            <span className={`badge ${configured ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                {configured ? 'Configured' : 'Not Configured'}
            </span>
        </div>
    );
}
