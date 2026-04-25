import { io } from 'socket.io-client';
import { getToken } from './auth';

// Connect to the same host:port the page is served from
const SOCKET_URL = window.location.origin;

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
