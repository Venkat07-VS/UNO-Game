const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const gameManager = require('../game/gameManager');
const { getStore } = require('../config/database');
const { getOrCreateBot } = require('../game/botPlayer');

const router = express.Router();

// Create a new game room
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { maxPlayers } = req.body;
    const result = gameManager.createGame(req.user.playerId, maxPlayers || 4);
    res.status(201).json(result);
  } catch (err) {
    console.error('Create game error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Join a game room
router.post('/join', authMiddleware, async (req, res) => {
  try {
    const { roomCode } = req.body;

    if (!roomCode) {
      return res.status(400).json({ error: 'Room code is required' });
    }

    const game = gameManager.getGameByRoomCode(roomCode.toUpperCase());
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const result = gameManager.joinGame(game.game_id, req.user.playerId);

    // Broadcast lobby_update to all players already in the room via socket
    const io = req.app.get('io');
    if (io) {
      const roomName = `game_${game.game_id}`;
      const players = gameManager.getLobbyPlayers(game.game_id);
      io.to(roomName).emit('lobby_update', { players });
    }

    res.json({ gameId: game.game_id, roomCode: game.room_code, ...result });
  } catch (err) {
    console.error('Join game error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Get online players (MUST be before /:gameId)
router.get('/online-players', (req, res) => {
  try {
    const store = getStore();
    const result = store.players
      .filter(p => p.is_online && p.username !== '__uno_bot__')
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
      .map(p => ({
        player_id: p.player_id,
        display_name: p.display_name,
        games_won: p.games_won,
        total_score: p.total_score
      }));
    res.json(result);
  } catch (err) {
    console.error('Online players error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get game state via HTTP (fallback for when socket doesn't work)
router.get('/:gameId/state', authMiddleware, (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const gameState = gameManager.getGameState(gameId, req.user.playerId);
    res.json(gameState);
  } catch (err) {
    console.error('Get game state error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get lobby info
router.get('/:gameId', authMiddleware, (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const store = getStore();

    const game = store.games.find(g => g.game_id === gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const players = gameManager.getLobbyPlayers(gameId);

    res.json({
      gameId: game.game_id,
      roomCode: game.room_code,
      status: game.status,
      hostPlayerId: game.host_player_id,
      maxPlayers: game.max_players,
      players
    });
  } catch (err) {
    console.error('Get lobby error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// List available games
router.get('/', (req, res) => {
  try {
    const store = getStore();
    const result = store.games
      .filter(g => g.status === 'waiting')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map(g => {
        const host = store.players.find(p => p.player_id === g.host_player_id);
        const playerCount = store.gamePlayers.filter(gp => gp.game_id === g.game_id).length;
        return {
          game_id: g.game_id,
          room_code: g.room_code,
          max_players: g.max_players,
          created_at: g.created_at,
          host_name: host ? host.display_name : 'Unknown',
          player_count: playerCount
        };
      });

    res.json(result);
  } catch (err) {
    console.error('List games error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a game against bot
router.post('/create-bot-game', authMiddleware, (req, res) => {
  try {
    const bot = getOrCreateBot();

    // Create a 2-player game
    const result = gameManager.createGame(req.user.playerId, 2);

    // Add bot to the game
    gameManager.joinGame(result.gameId, bot.player_id);

    res.status(201).json({ gameId: result.gameId, roomCode: result.roomCode, botId: bot.player_id });
  } catch (err) {
    console.error('Create bot game error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
