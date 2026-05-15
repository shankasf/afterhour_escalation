import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { SocketProvider } from './contexts/SocketContext'
import { CallProvider } from './contexts/CallContext'
import Layout from './components/Layout'
import TechShell from './components/TechShell'
import IncomingCallModal from './components/IncomingCallModal'
import Login from './pages/Login'
import Events from './pages/Events'
import EventDetail from './pages/EventDetail'
import Rotation from './pages/Rotation'
import Alerts from './pages/Alerts'
import Settings from './pages/Settings'
import Metrics from './pages/Metrics'
import AgentTrackingDashboard from './pages/AgentTrackingDashboard'
import Cost from './pages/Cost'
import Live from './pages/Live'
import TechHome from './pages/TechHome'
import Incidents from './pages/Incidents'
import IncidentDetail from './pages/IncidentDetail'
import TechSchedule from './pages/TechSchedule'
import { ensureServiceWorker } from './lib/push-registration'

type Shell = 'admin' | 'technician'

function detectShell(): Shell {
    if (typeof window === 'undefined') return 'admin'
    const host = window.location.hostname
    if (host.startsWith('technician.')) return 'technician'
    if (host.startsWith('admin.')) return 'admin'
    return 'admin'
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth()

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            </div>
        )
    }

    if (!user) {
        return <Navigate to="/login" replace />
    }

    return <>{children}</>
}

function ServiceWorkerNavigationBridge() {
    const navigate = useNavigate()

    useEffect(() => {
        if (!('serviceWorker' in navigator)) return
        const handler = (event: MessageEvent) => {
            if (event.data?.type === 'navigate' && typeof event.data.path === 'string') {
                navigate(event.data.path)
            }
        }
        navigator.serviceWorker.addEventListener('message', handler)
        return () => {
            navigator.serviceWorker.removeEventListener('message', handler)
        }
    }, [navigate])

    return null
}

function AdminApp() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route
                path="/*"
                element={
                    <ProtectedRoute>
                        <Layout>
                            <Routes>
                                <Route path="/" element={<Navigate to="/metrics" replace />} />
                                <Route path="/events" element={<Events />} />
                                <Route path="/events/:id" element={<EventDetail />} />
                                <Route path="/incidents/:eventId" element={<IncidentDetail />} />
                                <Route path="/rotation" element={<Rotation />} />
                                <Route path="/alerts" element={<Alerts />} />
                                <Route path="/metrics" element={<Metrics />} />
                                <Route path="/agent-tracking" element={<AgentTrackingDashboard />} />
                                <Route
                                    path="/agent-observability"
                                    element={<AgentTrackingDashboard defaultTab="observability" lockedTab="observability" />}
                                />
                                <Route
                                    path="/agent-evaluation"
                                    element={<AgentTrackingDashboard defaultTab="evaluation" lockedTab="evaluation" />}
                                />
                                <Route path="/live" element={<Live />} />
                                <Route path="/cost" element={<Cost />} />
                                <Route path="/settings" element={<Settings />} />
                            </Routes>
                        </Layout>
                    </ProtectedRoute>
                }
            />
        </Routes>
    )
}

function TechApp() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route
                path="/*"
                element={
                    <ProtectedRoute>
                        <TechShell>
                            <Routes>
                                <Route path="/" element={<TechHome />} />
                                <Route path="/incidents" element={<Incidents />} />
                                <Route path="/incidents/:eventId" element={<IncidentDetail />} />
                                <Route path="/schedule" element={<TechSchedule />} />
                                <Route path="/settings" element={<Settings />} />
                                <Route path="*" element={<Navigate to="/" replace />} />
                            </Routes>
                        </TechShell>
                    </ProtectedRoute>
                }
            />
        </Routes>
    )
}

function AuthedShell() {
    const { user } = useAuth()
    const shell = detectShell()

    return (
        <>
            <ServiceWorkerNavigationBridge />
            {shell === 'technician' ? <TechApp /> : <AdminApp />}
            {user && <IncomingCallModal />}
        </>
    )
}

function App() {
    useEffect(() => {
        ensureServiceWorker().catch(() => {})
    }, [])

    return (
        <BrowserRouter>
            <AuthProvider>
                <SocketProvider>
                    <CallProvider>
                        <AuthedShell />
                    </CallProvider>
                </SocketProvider>
            </AuthProvider>
        </BrowserRouter>
    )
}

export default App
