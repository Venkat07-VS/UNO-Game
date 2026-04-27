import { io } from 'socket.io-client';
import { getToken } from './auth';

// If REACT_APP_BACKEND_URL is set (Netlify deploy), use it;
// otherwise use the current hostname with port 5000 (works for both localhost and LAN)
const SOCKET_URL = process.env.REACT_APP_BACKEND_URL || `http://${window.location.hostname}:5000`;

let socket = null;

export function connectSocket() {
  // Return existing socket (even if still connecting - socket.io buffers emits)
  if (socket) return socket;

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
