import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { logger } from '../utils/logger';

interface SocketContextType {
    socket: Socket | null;
    connected: boolean;
}

const SocketContext = createContext<SocketContextType>({ socket: null, connected: false });

export function SocketProvider({ children }: { children: ReactNode }) {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [connected, setConnected] = useState(false);
    const { user } = useAuth();

    useEffect(() => {
        if (!user) {
            if (socket) {
                socket.disconnect();
                setSocket(null);
                setConnected(false);
            }
            return;
        }

        const token = localStorage.getItem('token');
        const newSocket = io('/', {
            auth: { token },
            transports: ['websocket', 'polling'],
        });

        newSocket.on('connect', () => {
            logger.info('Socket connected', { socketId: newSocket.id });
            setConnected(true);
        });

        newSocket.on('disconnect', () => {
            logger.info('Socket disconnected');
            setConnected(false);
        });

        newSocket.on('connect_error', (error) => {
            logger.error('Socket connection error', { error: String(error?.message ?? error) });
        });

        setSocket(newSocket);

        return () => {
            newSocket.disconnect();
        };
    }, [user]);

    return (
        <SocketContext.Provider value={{ socket, connected }}>
            {children}
        </SocketContext.Provider>
    );
}

export function useSocket() {
    return useContext(SocketContext);
}
