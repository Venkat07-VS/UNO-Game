import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGame, joinGame, listGames, getLeaderboard, createBotGame, getOnlinePlayers } from '../utils/api';
import { getPlayer } from '../utils/auth';
import './Dashboard.css';

function Dashboard({ onLogout }) {
  const [roomCode, setRoomCode] = useState('');
  const [games, setGames] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [onlinePlayers, setOnlinePlayers] = useState([]);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('play');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [creatingBot, setCreatingBot] = useState(false);
  const player = getPlayer();
  const navigate = useNavigate();

  useEffect(() => {
    loadGames();
    loadLeaderboard();
    loadOnlinePlayers();
  }, []);

  const loadGames = async () => {
    try {
      const res = await listGames();
      setGames(res.data);
    } catch (err) {
      console.error('Failed to load games:', err);
    }
  };

  const loadLeaderboard = async () => {
    try {
      const res = await getLeaderboard();
      setLeaderboard(res.data);
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    }
  };

  const loadOnlinePlayers = async () => {
    try {
      const res = await getOnlinePlayers();
      setOnlinePlayers(res.data);
    } catch (err) {
      console.error('Failed to load online players:', err);
    }
  };

  const handleCreateGame = async () => {
    try {
      setError('');
      const res = await createGame(maxPlayers);
      navigate(`/lobby/${res.data.gameId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create game');
    }
  };

  const handlePlayVsBot = async () => {
    try {
      setError('');
      setCreatingBot(true);
      const res = await createBotGame();
      navigate(`/lobby/${res.data.gameId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create bot game');
    } finally {
      setCreatingBot(false);
    }
  };

  const handleJoinGame = async (e) => {
    e.preventDefault();
    try {
      setError('');
      const res = await joinGame(roomCode);
      navigate(`/lobby/${res.data.gameId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join game');
    }
  };

  const handleJoinFromList = async (code) => {
    try {
      setError('');
      const res = await joinGame(code);
      navigate(`/lobby/${res.data.gameId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join game');
    }
  };

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1>🎴 UNO Online</h1>
        <div className="user-info">
          <span>Welcome, <strong>{player?.displayName}</strong></span>
          <button onClick={onLogout} className="logout-btn">Logout</button>
        </div>
      </header>

      <div className="dashboard-content">
        <div className="dashboard-tabs">
          <button
            className={`tab ${activeTab === 'play' ? 'active' : ''}`}
            onClick={() => setActiveTab('play')}
          >
            Play
          </button>
          <button
            className={`tab ${activeTab === 'games' ? 'active' : ''}`}
            onClick={() => { setActiveTab('games'); loadGames(); }}
          >
            Open Games
          </button>
          <button
            className={`tab ${activeTab === 'leaderboard' ? 'active' : ''}`}
            onClick={() => { setActiveTab('leaderboard'); loadLeaderboard(); }}
          >
            Leaderboard
          </button>
        </div>

        {error && <div className="dashboard-error">{error}</div>}

        {activeTab === 'play' && (
          <div className="play-section">
            <div className="play-card create-game">
              <h3>Create New Game</h3>
              <div className="form-group">
                <label>Max Players</label>
                <select value={maxPlayers} onChange={(e) => setMaxPlayers(parseInt(e.target.value))}>
                  <option value={2}>2 Players</option>
                  <option value={3}>3 Players</option>
                  <option value={4}>4 Players</option>
                  <option value={6}>6 Players</option>
                  <option value={8}>8 Players</option>
                </select>
              </div>
              <button onClick={handleCreateGame} className="action-btn create-btn">
                Create Game Room
              </button>
            </div>

            <div className="play-card join-game">
              <h3>Join Game</h3>
              <form onSubmit={handleJoinGame}>
                <div className="form-group">
                  <label>Room Code</label>
                  <input
                    type="text"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                    placeholder="Enter 6-digit code"
                    maxLength={6}
                    required
                  />
                </div>
                <button type="submit" className="action-btn join-btn">
                  Join Game
                </button>
              </form>
            </div>

            <div className="play-card bot-game">
              <h3>🤖 Play vs Computer</h3>
              <p>No online players? Play against the bot!</p>
              <button onClick={handlePlayVsBot} className="action-btn bot-btn" disabled={creatingBot}>
                {creatingBot ? 'Creating...' : 'Play vs Bot'}
              </button>
            </div>

            <div className="play-card online-players-card">
              <h3>🟢 Online Players ({onlinePlayers.length})</h3>
              {onlinePlayers.length === 0 ? (
                <p className="no-players">No other players online. Try playing vs Bot!</p>
              ) : (
                <ul className="online-players-list">
                  {onlinePlayers.map((p) => (
                    <li key={p.player_id} className="online-player-item">
                      <span className="online-dot">●</span>
                      <span className="player-name">{p.display_name}</span>
                      <span className="player-stats">🏆 {p.games_won} wins</span>
                    </li>
                  ))}
                </ul>
              )}
              <button onClick={loadOnlinePlayers} className="refresh-btn small">Refresh</button>
            </div>
          </div>
        )}

        {activeTab === 'games' && (
          <div className="games-list">
            <h3>Available Games</h3>
            {games.length === 0 ? (
              <p className="no-games">No open games available. Create one!</p>
            ) : (
              <table className="games-table">
                <thead>
                  <tr>
                    <th>Room Code</th>
                    <th>Host</th>
                    <th>Players</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {games.map((game) => (
                    <tr key={game.game_id}>
                      <td className="room-code">{game.room_code}</td>
                      <td>{game.host_name}</td>
                      <td>{game.player_count}/{game.max_players}</td>
                      <td>
                        <button
                          onClick={() => handleJoinFromList(game.room_code)}
                          className="action-btn join-btn small"
                          disabled={game.player_count >= game.max_players}
                        >
                          {game.player_count >= game.max_players ? 'Full' : 'Join'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button onClick={loadGames} className="refresh-btn">Refresh</button>
          </div>
        )}

        {activeTab === 'leaderboard' && (
          <div className="leaderboard">
            <h3>Top Players</h3>
            {leaderboard.length === 0 ? (
              <p className="no-games">No players on the leaderboard yet.</p>
            ) : (
              <table className="games-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th>Wins</th>
                    <th>Games</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((p, i) => (
                    <tr key={p.player_id}>
                      <td>{i + 1}</td>
                      <td>{p.display_name}</td>
                      <td>{p.games_won}</td>
                      <td>{p.games_played}</td>
                      <td>{p.total_score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
