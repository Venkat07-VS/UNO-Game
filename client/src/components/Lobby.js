import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getLobbyInfo } from '../utils/api';
import { getPlayer } from '../utils/auth';
import { connectSocket, getSocket } from '../utils/socket';
import './Lobby.css';

function Lobby() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [lobby, setLobby] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState('');
  const player = getPlayer();

  useEffect(() => {
    loadLobby();
    const socket = connectSocket();

    socket.emit('join_room', { gameId: parseInt(gameId) });

    socket.on('lobby_update', (data) => {
      setPlayers(data.players);
    });

    socket.on('game_started', (data) => {
      navigate(`/game/${gameId}`, { state: data });
    });

    socket.on('error', (data) => {
      setError(data.message);
    });

    return () => {
      socket.off('lobby_update');
      socket.off('game_started');
      socket.off('error');
    };
  }, [gameId, navigate]);

  const loadLobby = async () => {
    try {
      const res = await getLobbyInfo(gameId);
      setLobby(res.data);
      setPlayers(res.data.players);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load lobby');
    }
  };

  const handleStartGame = () => {
    const socket = getSocket();
    socket.emit('start_game', { gameId: parseInt(gameId) });
  };

  const isHost = lobby?.hostPlayerId === player?.playerId;
  const canStart = isHost && players.length >= 2;

  if (!lobby) {
    return <div className="lobby-container"><div className="loading">Loading lobby...</div></div>;
  }

  return (
    <div className="lobby-container">
      <div className="lobby-card">
        <h2>🎴 Game Lobby</h2>

        <div className="room-info">
          <div className="room-code-display">
            <span className="label">Room Code:</span>
            <span className="code">{lobby.roomCode}</span>
          </div>
          <p className="share-text">Share this code with friends to join!</p>
        </div>

        {error && <div className="lobby-error">{error}</div>}

        <div className="players-list">
          <h3>Players ({players.length}/{lobby.maxPlayers})</h3>
          {players.map((p, index) => (
            <div key={p.player_id} className="player-item">
              <span className="player-seat">Seat {index + 1}</span>
              <span className="player-name">
                {p.display_name}
                {p.player_id === lobby.hostPlayerId && <span className="host-badge">HOST</span>}
                {p.player_id === player?.playerId && <span className="you-badge">YOU</span>}
              </span>
            </div>
          ))}
          {Array.from({ length: lobby.maxPlayers - players.length }).map((_, i) => (
            <div key={`empty-${i}`} className="player-item empty">
              <span className="player-seat">Seat {players.length + i + 1}</span>
              <span className="player-name">Waiting for player...</span>
            </div>
          ))}
        </div>

        <div className="lobby-actions">
          {canStart && (
            <button onClick={handleStartGame} className="start-btn">
              Start Game
            </button>
          )}
          {isHost && players.length < 2 && (
            <p className="waiting-text">Need at least 2 players to start</p>
          )}
          {!isHost && (
            <p className="waiting-text">Waiting for host to start the game...</p>
          )}
        </div>

        <button onClick={() => navigate('/dashboard')} className="back-btn">
          Leave Lobby
        </button>
      </div>
    </div>
  );
}

export default Lobby;
