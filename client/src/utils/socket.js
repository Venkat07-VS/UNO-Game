import { io } from 'socket.io-client';
import { getToken } from './auth';

// In production (same origin), connect to same host. In dev, use port 3001.
const isProduction = !window.location.port || window.location.port === '3000';
const SOCKET_URL = isProduction
  ? `http://${window.location.hostname}:3000`
  : `http://${window.location.hostname}:3000`;

let socket = null;

export function connectSocket() {
  if (socket && socket.connected) return socket;

  const token = getToken();
  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err.message);
  });

  return socket;
}

export function getSocket() {
  if (!socket) {
    return connectSocket();
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
