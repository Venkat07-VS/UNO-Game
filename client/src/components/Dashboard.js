import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { quickJoin, createGame, joinGame, listGames, getLeaderboard, createBotGame, getOnlinePlayers } from '../utils/api';
import { getPlayer, setToken, setPlayer, getToken, removeToken } from '../utils/auth';
import { disconnectSocket } from '../utils/socket';
import './Dashboard.css';

function Dashboard() {
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [games, setGames] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [onlinePlayers, setOnlinePlayers] = useState([]);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('play');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [creatingBot, setCreatingBot] = useState(false);
  const navigate = useNavigate();
  const player = getPlayer();

  useEffect(() => {
    // Clear stale session on load so user always starts fresh
    disconnectSocket();
    removeToken();
  }, []);

  useEffect(() => {
    if (getToken()) {
      loadGames();
      loadLeaderboard();
      loadOnlinePlayers();
    }
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

  // Ensure player is registered (quick-join) before any action
  const ensurePlayer = async (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed || trimmed.length < 2) {
      setError('Please enter your name (at least 2 characters)');
      return false;
    }

    // Always get a fresh token to avoid stale playerId after server restart
    try {
      disconnectSocket();
      const res = await quickJoin(trimmed);
      setToken(res.data.token);
      setPlayer(res.data.player);
      setPlayerName(trimmed);
      return true;
    } catch (err) {
      if (!err.response) {
        setError('Cannot reach game server. Please check your connection or try again later.');
      } else {
        setError(err.response?.data?.error || 'Failed to join');
      }
      return false;
    }
  };

  const handleCreateGame = async () => {
    setError('');
    if (!(await ensurePlayer(playerName))) return;
    try {
      const res = await createGame(maxPlayers);
      navigate(`/lobby/${res.data.gameId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create game');
    }
  };

  const handlePlayVsBot = async () => {
    setError('');
    if (!(await ensurePlayer(playerName))) return;
    try {
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
    setError('');
    if (!(await ensurePlayer(playerName))) return;
    try {
      const res = await joinGame(roomCode);
      navigate(`/lobby/${res.data.gameId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join game');
    }
  };

  const handleJoinFromList = async (code) => {
    setError('');
    if (!(await ensurePlayer(playerName))) return;
    try {
      const res = await joinGame(code);
      navigate(`/lobby/${res.data.gameId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join game');
    }
  };

  const handleChangeName = () => {
    disconnectSocket();
    removeToken();
    setPlayerName('');
  };

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1>🎴 V-UNO Online</h1>
      </header>

      <div className="dashboard-content">
        <div className="dashboard-tabs">
          <button className={`tab ${activeTab === 'play' ? 'active' : ''}`} onClick={() => setActiveTab('play')}>
            Play
          </button>
          <button className={`tab ${activeTab === 'games' ? 'active' : ''}`} onClick={() => { setActiveTab('games'); loadGames(); }}>
            Open Games
          </button>
          <button className={`tab ${activeTab === 'leaderboard' ? 'active' : ''}`} onClick={() => { setActiveTab('leaderboard'); loadLeaderboard(); }}>
            Leaderboard
          </button>
        </div>

        {error && <div className="dashboard-error">{error}</div>}

        {activeTab === 'play' && (
          <div className="play-section">
            {/* Hero Name Card */}
            <div className="play-card hero-name-card" style={{ gridColumn: '1 / -1' }}>
              <div className="hero-name-inner">
                <div className="hero-icon">👤</div>
                <div className="hero-name-content">
                  <label className="hero-label">Your Player Name</label>
                  <div className="hero-input-wrap">
                    <input
                      type="text"
                      className="hero-name-input"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      placeholder="Enter your name to play..."
                      maxLength={30}
                      required
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Create Game */}
            <div className="play-card create-game">
              <div className="card-header-icon">🎮</div>
              <h3>Create New Game</h3>
              <div className="stylish-select-group">
                <label>Max Players</label>
                <div className="player-count-picker">
                  {[2, 3, 4, 6, 8].map(n => (
                    <button
                      key={n}
                      className={`count-btn ${maxPlayers === n ? 'active' : ''}`}
                      onClick={() => setMaxPlayers(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={handleCreateGame} className="action-btn create-btn">
                <span className="btn-icon">+</span> Create Game Room
              </button>
            </div>

            {/* Join Game */}
            <div className="play-card join-game">
              <div className="card-header-icon">🚪</div>
              <h3>Join Game</h3>
              <form onSubmit={handleJoinGame}>
                <div className="stylish-code-group">
                  <label>Room Code</label>
                  <div className="room-code-input-wrap">
                    <input
                      type="text"
                      className="room-code-input"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                      placeholder="ABC123"
                      maxLength={6}
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="action-btn join-btn">
                  <span className="btn-icon">→</span> Join Game
                </button>
              </form>
            </div>

            {/* Bot Game */}
            <div className="play-card bot-game">
              <div className="card-header-icon">🤖</div>
              <h3>Play vs Computer</h3>
              <p>Practice your skills against the AI!</p>
              <button onClick={handlePlayVsBot} className="action-btn bot-btn" disabled={creatingBot}>
                {creatingBot ? 'Creating...' : '⚡ Play vs Bot'}
              </button>
            </div>

            {/* Online Players */}
            <div className="play-card online-players-card">
              <div className="card-header-icon">🟢</div>
              <h3>Online Players <span className="online-count">{onlinePlayers.length}</span></h3>
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
              <button onClick={loadOnlinePlayers} className="refresh-btn small">↻ Refresh</button>
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
