const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool, sql } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, password, displayName } = req.body;

    if (!username || !password || !displayName) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (username.length < 3 || username.length > 50) {
      return res.status(400).json({ error: 'Username must be 3-50 characters' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const pool = getPool();

    // Check if username exists
    const existing = await pool.request()
      .input('username', sql.NVarChar, username)
      .query('SELECT player_id FROM UNO_Players WHERE username = @username');

    if (existing.recordset.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create player
    const result = await pool.request()
      .input('username', sql.NVarChar, username)
      .input('passwordHash', sql.NVarChar, passwordHash)
      .input('displayName', sql.NVarChar, displayName)
      .query(`
        INSERT INTO UNO_Players (username, password_hash, display_name)
        OUTPUT INSERTED.player_id, INSERTED.username, INSERTED.display_name
        VALUES (@username, @passwordHash, @displayName)
      `);

    const player = result.recordset[0];

    const token = jwt.sign(
      { playerId: player.player_id, username: player.username, displayName: player.display_name },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      token,
      player: {
        playerId: player.player_id,
        username: player.username,
        displayName: player.display_name
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const pool = getPool();

    const result = await pool.request()
      .input('username', sql.NVarChar, username)
      .query('SELECT * FROM UNO_Players WHERE username = @username');

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const player = result.recordset[0];

    const validPassword = await bcrypt.compare(password, player.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Update last login and online status
    await pool.request()
      .input('playerId', sql.Int, player.player_id)
      .query('UPDATE UNO_Players SET last_login = GETDATE(), is_online = 1 WHERE player_id = @playerId');

    const token = jwt.sign(
      { playerId: player.player_id, username: player.username, displayName: player.display_name },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      player: {
        playerId: player.player_id,
        username: player.username,
        displayName: player.display_name,
        gamesPlayed: player.games_played,
        gamesWon: player.games_won,
        totalScore: player.total_score
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .input('playerId', sql.Int, req.user.playerId)
      .query(`
        SELECT player_id, username, display_name, games_played, games_won, total_score, created_at
        FROM UNO_Players WHERE player_id = @playerId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .query(`
        SELECT TOP 20 player_id, username, display_name, games_played, games_won, total_score
        FROM UNO_Players
        WHERE games_played > 0
        ORDER BY games_won DESC, total_score DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
