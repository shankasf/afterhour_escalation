import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, Plus, Edit2, Trash2, User, Save, X } from 'lucide-react';
import api from '../lib/api';
import { User as UserType } from '../types';
import { formatDate } from '../lib/utils';

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
                <p className="text-gray-500">Manage on-call schedules and escalation contacts</p>
            </div>

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
