import axios from 'axios';
import { getToken } from './auth';

// Use relative path - works with Netlify proxy and local Node.js serving
const API_URL = '/api';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' }
});

// Add auth token to all requests
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth
export const register = (username, password, displayName) =>
  api.post('/auth/register', { username, password, displayName });

export const login = (username, password) =>
  api.post('/auth/login', { username, password });

export const getProfile = () => api.get('/auth/profile');

export const getLeaderboard = () => api.get('/auth/leaderboard');

// Lobby
export const createGame = (maxPlayers = 4) =>
  api.post('/lobby/create', { maxPlayers });

export const joinGame = (roomCode) =>
  api.post('/lobby/join', { roomCode });

export const getLobbyInfo = (gameId) => api.get(`/lobby/${gameId}`);

export const listGames = () => api.get('/lobby');

export const createBotGame = () => api.post('/lobby/create-bot-game');

export const getOnlinePlayers = () => api.get('/lobby/online-players');

export default api;
