import React, { useState, useEffect, useRef } from 'react';
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
  const navigatingRef = useRef(false);
  const player = getPlayer();

  const navigateToGame = (stateData) => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    if (stateData) {
      navigate(`/game/${gameId}`, { state: stateData });
    } else {
      navigate(`/game/${gameId}`);
    }
  };

  useEffect(() => {
    loadLobby();
    const socket = connectSocket();

    const joinRoom = () => {
      socket.emit('join_room', { gameId: parseInt(gameId) });
    };

    joinRoom();

    // Re-join room on reconnection so events keep working
    socket.on('connect', joinRoom);

    socket.on('lobby_update', (data) => {
      setPlayers(data.players);
    });

    socket.on('game_started', (data) => {
      navigateToGame(data);
    });

    // Fallback: if the direct game_started was missed, this room broadcast
    // navigates to the game page which will request full state from the server
    socket.on('game_started_notification', () => {
      navigateToGame(null);
    });

    socket.on('error', (data) => {
      setError(data.message);
    });

    // Poll lobby via HTTP every 2 seconds as a reliable fallback
    // If the game status changed to 'playing', navigate even if socket events were missed
    const pollInterval = setInterval(() => {
      loadLobby();
    }, 2000);

    return () => {
      clearInterval(pollInterval);
      socket.off('connect', joinRoom);
      socket.off('lobby_update');
      socket.off('game_started');
      socket.off('game_started_notification');
      socket.off('error');
    };
  }, [gameId, navigate]);

  const loadLobby = async () => {
    try {
      const res = await getLobbyInfo(gameId);
      // If game already started, navigate to game page immediately
      if (res.data.status === 'playing') {
        navigateToGame(null);
        return;
      }
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
