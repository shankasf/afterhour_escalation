import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, Plus, Edit2, Trash2, User, Save, X, ArrowUp, ArrowDown, ShieldCheck, KeyRound, AlertCircle } from 'lucide-react';
import api from '../lib/api';
import { User as UserType } from '../types';
import { formatDate } from '../lib/utils';

interface RotationCandidate {
    id: string;
    name: string;
    email: string;
    phoneNumber: string | null;
    role: 'admin' | 'on_call' | 'viewer';
    isActive: boolean;
    onDuty: boolean;
    onDutyPriority: number;
}

// API response types matching backend
interface RotationUser {
    id: string;
    name: string;
    phoneNumber: string;
    email: string;
}

interface Rotation {
    id: string;
    startDate: string;
    endDate: string;
    primaryUserId: string;
    secondaryUserId: string;
    primaryUser: RotationUser;
    secondaryUser: RotationUser;
    createdAt: string;
    updatedAt: string;
}

interface ContactUser {
    id: string;
    name: string;
    email: string;
    phoneNumber: string;
}

interface Contact {
    id: string;
    userId: string;
    position: number;
    contactType: 'primary' | 'secondary' | 'fixed';
    isActive: boolean;
    user: ContactUser;
    createdAt: string;
    updatedAt: string;
}

function isCurrentRotation(rotation: Rotation): boolean {
    const now = new Date();
    const start = new Date(rotation.startDate);
    const end = new Date(rotation.endDate);
    return now >= start && now <= end;
}

export default function Rotation() {
    const queryClient = useQueryClient();
    const [showAddRotation, setShowAddRotation] = useState(false);
    const [showAddContact, setShowAddContact] = useState(false);
    const [editingContact, setEditingContact] = useState<Contact | null>(null);

    // Queries
    const { data: rotations } = useQuery<Rotation[]>({
        queryKey: ['rotations'],
        queryFn: async () => {
            const res = await api.get('/rotation');
            return res.data;
        },
    });

    const { data: contacts } = useQuery<Contact[]>({
        queryKey: ['contacts'],
        queryFn: async () => {
            const res = await api.get('/escalation/contacts');
            return res.data;
        },
    });

    const { data: users } = useQuery<UserType[]>({
        queryKey: ['users'],
        queryFn: async () => {
            const res = await api.get('/users');
            return res.data;
        },
    });

    // Mutations
    const createRotationMutation = useMutation({
        mutationFn: async (data: { primaryUserId: string; secondaryUserId: string; startDate: string; endDate: string }) => {
            await api.post('/rotation', data);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rotations'] });
            setShowAddRotation(false);
        },
    });

    const deleteRotationMutation = useMutation({
        mutationFn: async (rotationId: string) => {
            await api.delete(`/rotation/${rotationId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rotations'] });
        },
    });

    const createContactMutation = useMutation({
        mutationFn: async (data: { userId: string; contactType: string; position: number }) => {
            await api.post('/escalation/contacts', data);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['contacts'] });
            setShowAddContact(false);
        },
    });

    const updateContactMutation = useMutation({
        mutationFn: async ({ id: contactId, ...data }: { id: string; position?: number; isActive?: boolean }) => {
            await api.patch(`/escalation/contacts/${contactId}`, data);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['contacts'] });
            setEditingContact(null);
        },
    });

    const deleteContactMutation = useMutation({
        mutationFn: async (contactId: string) => {
            await api.delete(`/escalation/contacts/${contactId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['contacts'] });
        },
    });

    const currentRotation = rotations?.find(r => isCurrentRotation(r));
    const upcomingRotations = rotations?.filter(r => !isCurrentRotation(r) && new Date(r.startDate) > new Date());

    return (
        <div>
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900">On-Call Rotation</h1>
                <p className="text-gray-500">Toggle staff on duty — calls route in order through the on-duty pool only.</p>
            </div>

            <OnDutyPoolCard />


            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Current On-Call */}
                <div className="card">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold">Current On-Call</h2>
                        <button
                            onClick={() => setShowAddRotation(true)}
                            className="btn-primary flex items-center gap-2 text-sm"
                        >
                            <Plus className="w-4 h-4" />
                            Add Rotation
                        </button>
                    </div>

                    {currentRotation ? (
                        <div className="space-y-3">
                            <div className="bg-primary-50 rounded-lg p-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                                        <User className="w-6 h-6 text-primary-600" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-primary-600 font-medium">PRIMARY</p>
                                        <p className="font-medium text-lg">{currentRotation.primaryUser?.name || 'Unknown'}</p>
                                        <p className="text-sm text-gray-600">{currentRotation.primaryUser?.phoneNumber}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center">
                                        <User className="w-6 h-6 text-gray-600" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 font-medium">SECONDARY</p>
                                        <p className="font-medium text-lg">{currentRotation.secondaryUser?.name || 'Unknown'}</p>
                                        <p className="text-sm text-gray-600">{currentRotation.secondaryUser?.phoneNumber}</p>
                                    </div>
                                </div>
                            </div>
                            <p className="text-xs text-gray-500 text-center">
                                {formatDate(currentRotation.startDate)} - {formatDate(currentRotation.endDate)}
                            </p>
                        </div>
                    ) : (
                        <p className="text-gray-500">No current on-call rotation</p>
                    )}

                    {/* Upcoming Rotations */}
                    <div className="mt-6">
                        <h3 className="font-medium mb-3">Upcoming Rotations</h3>
                        {upcomingRotations && upcomingRotations.length > 0 ? (
                            <div className="space-y-2">
                                {upcomingRotations.map(rotation => (
                                    <div key={rotation.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                        <div className="flex items-center gap-3">
                                            <Calendar className="w-4 h-4 text-gray-400" />
                                            <div>
                                                <p className="font-medium">{rotation.primaryUser?.name || 'Unknown'}</p>
                                                <p className="text-xs text-gray-500">
                                                    {formatDate(rotation.startDate)} - {formatDate(rotation.endDate)}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => deleteRotationMutation.mutate(rotation.id)}
                                            className="text-red-500 hover:text-red-700 p-1"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500">No upcoming rotations scheduled</p>
                        )}
                    </div>
                </div>

                {/* Escalation Contacts */}
                <div className="card">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold">Escalation Contacts</h2>
                        <button
                            onClick={() => setShowAddContact(true)}
                            className="btn-primary flex items-center gap-2 text-sm"
                        >
                            <Plus className="w-4 h-4" />
                            Add Contact
                        </button>
                    </div>

                    <p className="text-sm text-gray-500 mb-4">
                        Contacts are called in order after on-call staff don't respond.
                    </p>

                    {contacts && contacts.length > 0 ? (
                        <div className="space-y-2">
                            {contacts.sort((a, b) => a.position - b.position).map(contact => (
                                <div key={contact.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-sm font-medium">
                                            {contact.position}
                                        </div>
                                        <div>
                                            <p className="font-medium">{contact.user?.name || 'Unknown'}</p>
                                            <p className="text-sm text-gray-500">{contact.user?.phoneNumber}</p>
                                            <p className="text-xs text-gray-400">{contact.contactType}</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => setEditingContact(contact)}
                                            className="text-gray-500 hover:text-gray-700 p-1"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => deleteContactMutation.mutate(contact.id)}
                                            className="text-red-500 hover:text-red-700 p-1"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-500">No escalation contacts configured</p>
                    )}
                </div>
            </div>

            {/* Add Rotation Modal */}
            {showAddRotation && (
                <Modal title="Add Rotation" onClose={() => setShowAddRotation(false)}>
                    <RotationForm
                        users={users || []}
                        onSubmit={(data) => createRotationMutation.mutate(data)}
                        onCancel={() => setShowAddRotation(false)}
                        isLoading={createRotationMutation.isPending}
                    />
                </Modal>
            )}

            {/* Add/Edit Contact Modal */}
            {(showAddContact || editingContact) && (
                <Modal
                    title={editingContact ? 'Edit Contact' : 'Add Contact'}
                    onClose={() => {
                        setShowAddContact(false);
                        setEditingContact(null);
                    }}
                >
                    <ContactForm
                        contact={editingContact}
                        users={users || []}
                        onSubmit={(data) => {
                            if (editingContact) {
                                updateContactMutation.mutate({ id: editingContact.id, ...data });
                            } else {
                                createContactMutation.mutate(data as any);
                            }
                        }}
                        onCancel={() => {
                            setShowAddContact(false);
                            setEditingContact(null);
                        }}
                        isLoading={createContactMutation.isPending || updateContactMutation.isPending}
                    />
                </Modal>
            )}
        </div>
    );
}

// Modal Component
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
                <div className="flex items-center justify-between p-4 border-b">
                    <h3 className="font-semibold text-lg">{title}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-4">{children}</div>
            </div>
        </div>
    );
}

// Rotation Form
function RotationForm({
    users,
    onSubmit,
    onCancel,
    isLoading,
}: {
    users: UserType[];
    onSubmit: (data: { primaryUserId: string; secondaryUserId: string; startDate: string; endDate: string }) => void;
    onCancel: () => void;
    isLoading: boolean;
}) {
    const [primaryUserId, setPrimaryUserId] = useState('');
    const [secondaryUserId, setSecondaryUserId] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit({ primaryUserId, secondaryUserId, startDate, endDate });
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="space-y-4">
                <div>
                    <label className="label">Primary On-Call</label>
                    <select value={primaryUserId} onChange={(e) => setPrimaryUserId(e.target.value)} className="input" required>
                        <option value="">Select user...</option>
                        {users.map(user => (
                            <option key={user.id} value={user.id}>{user.name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="label">Secondary On-Call</label>
                    <select value={secondaryUserId} onChange={(e) => setSecondaryUserId(e.target.value)} className="input" required>
                        <option value="">Select user...</option>
                        {users.map(user => (
                            <option key={user.id} value={user.id}>{user.name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="label">Start Date</label>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" required />
                </div>
                <div>
                    <label className="label">End Date</label>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input" required />
                </div>
            </div>
            <div className="flex gap-2 mt-6">
                <button type="button" onClick={onCancel} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={isLoading} className="btn-primary flex-1 flex items-center justify-center gap-2">
                    <Save className="w-4 h-4" />
                    {isLoading ? 'Saving...' : 'Save'}
                </button>
            </div>
        </form>
    );
}

// Contact Form
function ContactForm({
    contact,
    users,
    onSubmit,
    onCancel,
    isLoading,
}: {
    contact: Contact | null;
    users: UserType[];
    onSubmit: (data: { userId?: string; contactType?: string; position?: number; isActive?: boolean }) => void;
    onCancel: () => void;
    isLoading: boolean;
}) {
    const [userId, setUserId] = useState(contact?.userId || '');
    const [contactType, setContactType] = useState(contact?.contactType || 'fixed');
    const [position, setPosition] = useState(contact?.position || 1);
    const [isActive, setIsActive] = useState(contact?.isActive ?? true);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (contact) {
            onSubmit({ position, isActive });
        } else {
            onSubmit({ userId, contactType, position });
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="space-y-4">
                {!contact && (
                    <>
                        <div>
                            <label className="label">User</label>
                            <select value={userId} onChange={(e) => setUserId(e.target.value)} className="input" required>
                                <option value="">Select user...</option>
                                {users.map(user => (
                                    <option key={user.id} value={user.id}>{user.name} ({(user as any).phoneNumber || user.email})</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="label">Contact Type</label>
                            <select value={contactType} onChange={(e) => setContactType(e.target.value as 'primary' | 'secondary' | 'fixed')} className="input" required>
                                <option value="primary">Primary</option>
                                <option value="secondary">Secondary</option>
                                <option value="fixed">Fixed</option>
                            </select>
                        </div>
                    </>
                )}
                <div>
                    <label className="label">Position</label>
                    <input type="number" min="1" value={position} onChange={(e) => setPosition(Number(e.target.value))} className="input" required />
                </div>
                {contact && (
                    <div className="flex items-center gap-2">
                        <input type="checkbox" id="isActive" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                        <label htmlFor="isActive" className="text-sm">Active</label>
                    </div>
                )}
            </div>
            <div className="flex gap-2 mt-6">
                <button type="button" onClick={onCancel} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={isLoading} className="btn-primary flex-1 flex items-center justify-center gap-2">
                    <Save className="w-4 h-4" />
                    {isLoading ? 'Saving...' : 'Save'}
                </button>
            </div>
        </form>
    );
}

// =============================================================================
// On-Duty Pool — the new active-pool model. Admin toggles staff on/off duty
// here; escalation calls route only through the on-duty subset, in order of
// `onDutyPriority`.
// =============================================================================

function OnDutyPoolCard() {
    const qc = useQueryClient();
    const { data, isLoading } = useQuery<RotationCandidate[]>({
        queryKey: ['rotation-candidates'],
        queryFn: async () => (await api.get('/users/rotation-candidates')).data,
        refetchInterval: 15_000,
    });

    const toggleDuty = useMutation({
        mutationFn: async ({ id, onDuty }: { id: string; onDuty: boolean }) => {
            await api.patch(`/users/${id}/duty`, { onDuty });
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['rotation-candidates'] }),
    });

    const setPriority = useMutation({
        mutationFn: async ({ id, priority }: { id: string; priority: number }) => {
            await api.patch(`/users/${id}/duty-priority`, { priority });
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['rotation-candidates'] }),
    });

    const candidates = data ?? [];
    const onDuty = candidates.filter((c) => c.onDuty);

    const move = (idx: number, dir: 'up' | 'down') => {
        if (idx < 0) return;
        const arr = [...candidates];
        const j = dir === 'up' ? idx - 1 : idx + 1;
        if (j < 0 || j >= arr.length) return;
        // Swap onDutyPriority of the two rows.
        const a = arr[idx];
        const b = arr[j];
        setPriority.mutate({ id: a.id, priority: b.onDutyPriority });
        setPriority.mutate({ id: b.id, priority: a.onDutyPriority });
    };

    return (
        <div className="card mb-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    <h2 className="text-lg font-semibold">On-Duty Pool</h2>
                    <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-700">
                        {onDuty.length} on duty / {candidates.length} total
                    </span>
                </div>
                <span className="text-xs text-gray-500">Refreshes every 15s</span>
            </div>

            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 flex gap-2">
                <KeyRound className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-amber-800">
                    Staff log in at <span className="font-mono">https://technician.amsterdamhostel.cloud</span> using
                    their email above plus the shared password set in <span className="font-mono">STAFF_DEFAULT_PASSWORD</span>.
                    Hand it to them out-of-band; rotate by updating the env var and re-seeding.
                </div>
            </div>

            {isLoading ? (
                <p className="text-sm text-gray-500">Loading…</p>
            ) : candidates.length === 0 ? (
                <p className="text-sm text-gray-500">No on-call staff exist yet. Seed the DB to create them.</p>
            ) : onDuty.length === 0 ? (
                <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 flex gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
                    <div className="text-xs text-red-800">
                        <strong>No one is on duty.</strong> Escalations will be flagged for ops follow-up because the ladder is empty.
                        Toggle at least one staff member below.
                    </div>
                </div>
            ) : null}

            {candidates.length > 0 && (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-xs uppercase text-gray-500 border-b">
                            <th className="text-left font-medium py-2">#</th>
                            <th className="text-left font-medium py-2">Name</th>
                            <th className="text-left font-medium py-2">Email (login)</th>
                            <th className="text-left font-medium py-2">Phone</th>
                            <th className="text-center font-medium py-2">On duty</th>
                            <th className="text-center font-medium py-2">Order</th>
                        </tr>
                    </thead>
                    <tbody>
                        {candidates.map((c, idx) => (
                            <tr key={c.id} className={`border-b ${c.onDuty ? '' : 'opacity-60'}`}>
                                <td className="py-2 text-gray-500 font-mono text-xs">{c.onDutyPriority}</td>
                                <td className="py-2 font-medium text-gray-900">{c.name}</td>
                                <td className="py-2 text-gray-700 font-mono text-xs">{c.email}</td>
                                <td className="py-2 text-gray-600">{c.phoneNumber || '—'}</td>
                                <td className="py-2 text-center">
                                    <button
                                        onClick={() => toggleDuty.mutate({ id: c.id, onDuty: !c.onDuty })}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                            c.onDuty ? 'bg-emerald-500' : 'bg-gray-300'
                                        }`}
                                        aria-label={c.onDuty ? 'Mark off duty' : 'Mark on duty'}
                                    >
                                        <span
                                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                                c.onDuty ? 'translate-x-6' : 'translate-x-1'
                                            }`}
                                        />
                                    </button>
                                </td>
                                <td className="py-2 text-center">
                                    <div className="inline-flex gap-1">
                                        <button
                                            onClick={() => move(idx, 'up')}
                                            disabled={idx === 0}
                                            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                                            aria-label="Move up"
                                        >
                                            <ArrowUp className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={() => move(idx, 'down')}
                                            disabled={idx === candidates.length - 1}
                                            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                                            aria-label="Move down"
                                        >
                                            <ArrowDown className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
