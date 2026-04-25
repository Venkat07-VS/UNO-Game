const TOKEN_KEY = 'uno_token';
const PLAYER_KEY = 'uno_player';

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PLAYER_KEY);
}

export function setPlayer(player) {
  localStorage.setItem(PLAYER_KEY, JSON.stringify(player));
}

export function getPlayer() {
  const data = localStorage.getItem(PLAYER_KEY);
  return data ? JSON.parse(data) : null;
}
