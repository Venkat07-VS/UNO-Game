const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const gameManager = require('../game/gameManager');
const { getPool, sql } = require('../config/database');
const { getOrCreateBot } = require('../game/botPlayer');

const router = express.Router();

// Create a new game room
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { maxPlayers } = req.body;
    const result = await gameManager.createGame(req.user.playerId, maxPlayers || 4);
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

    const game = await gameManager.getGameByRoomCode(roomCode.toUpperCase());
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const result = await gameManager.joinGame(game.game_id, req.user.playerId);
    res.json({ gameId: game.game_id, roomCode: game.room_code, ...result });
  } catch (err) {
    console.error('Join game error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Get online players (MUST be before /:gameId)
router.get('/online-players', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .input('playerId', sql.Int, req.user.playerId)
      .query(`
        SELECT player_id, display_name, games_won, total_score
        FROM UNO_Players
        WHERE is_online = 1 AND player_id != @playerId AND username != '__uno_bot__'
        ORDER BY display_name
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Online players error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get lobby info
router.get('/:gameId', authMiddleware, async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const pool = getPool();

    const gameResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query('SELECT * FROM UNO_Games WHERE game_id = @gameId');

    if (gameResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const game = gameResult.recordset[0];
    const players = await gameManager.getLobbyPlayers(gameId);

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
router.get('/', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .query(`
        SELECT g.game_id, g.room_code, g.max_players, g.created_at,
               p.display_name as host_name,
               (SELECT COUNT(*) FROM UNO_GamePlayers WHERE game_id = g.game_id) as player_count
        FROM UNO_Games g
        JOIN UNO_Players p ON g.host_player_id = p.player_id
        WHERE g.status = 'waiting'
        ORDER BY g.created_at DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('List games error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a game against bot
router.post('/create-bot-game', authMiddleware, async (req, res) => {
  try {
    const bot = await getOrCreateBot();

    // Create a 2-player game
    const result = await gameManager.createGame(req.user.playerId, 2);

    // Add bot to the game
    await gameManager.joinGame(result.gameId, bot.player_id);

    res.status(201).json({ gameId: result.gameId, roomCode: result.roomCode, botId: bot.player_id });
  } catch (err) {
    console.error('Create bot game error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
