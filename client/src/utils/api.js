import axios from 'axios';
import { getToken } from './auth';

// Always use relative paths — works with both:
// - Local dev: proxied to localhost:5000 via package.json "proxy"
// - Netlify: redirected to /.netlify/functions/api via netlify.toml
const API_URL = '/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
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
export const quickJoin = (displayName) =>
  api.post('/auth/quick-join', { displayName });

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

// Game state
export const getGameState = (gameId) => api.get(`/lobby/${gameId}/state`);

// Game actions (HTTP endpoints — replaces socket events)
export const startGame = (gameId) =>
  api.post(`/game/${gameId}/start`);

export const playCard = (gameId, cardColor, cardValue, chosenColor = null) =>
  api.post(`/game/${gameId}/play-card`, { cardColor, cardValue, chosenColor });

export const drawCard = (gameId) =>
  api.post(`/game/${gameId}/draw-card`);

export const callUno = (gameId) =>
  api.post(`/game/${gameId}/call-uno`);

export const challengeUno = (gameId, challengedPlayerId) =>
  api.post(`/game/${gameId}/challenge-uno`, { challengedPlayerId });

export const sendChat = (gameId, message) =>
  api.post(`/game/${gameId}/chat`, { message });

export const getMessages = (gameId, since = '') =>
  api.get(`/game/${gameId}/messages`, { params: { since } });

export default api;
