import { ReactNode, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon, LogOut, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface TechShellProps {
  children: ReactNode;
}

export default function TechShell({ children }: TechShellProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="sticky top-0 z-30 bg-gray-900 text-white border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-primary-600 rounded-lg flex items-center justify-center font-semibold flex-shrink-0">
              {user?.name?.charAt(0).toUpperCase() || 'T'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">
                {user?.name || 'Technician'}
              </p>
              <div className="flex items-center gap-1.5 text-xs">
                {online ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-green-400">Online</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-red-400">Offline</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <nav className="flex items-center gap-1">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `p-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800'
                }`
              }
              aria-label="Settings"
            >
              <SettingsIcon className="w-5 h-5" />
            </NavLink>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-gray-300 hover:bg-gray-800 transition-colors"
              aria-label="Sign out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </nav>
        </div>

        <div className="max-w-5xl mx-auto px-4 pb-2 flex gap-1 overflow-x-auto">
          <TabLink to="/" label="Home" />
          <TabLink to="/incidents" label="Incidents" />
          <TabLink to="/schedule" label="Schedule" />
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 py-6">{children}</div>
      </main>
    </div>
  );
}

function TabLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
          isActive
            ? 'bg-white/10 text-white'
            : 'text-gray-300 hover:text-white hover:bg-white/5'
        }`
      }
    >
      {label}
    </NavLink>
  );
}
