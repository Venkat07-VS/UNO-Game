const express = require('express');
const jwt = require('jsonwebtoken');
const { getStore, nextId } = require('../config/database');

const router = express.Router();

// Quick join - create or find player by display name (no login required)
router.post('/quick-join', (req, res) => {
  try {
    const { displayName } = req.body;

    if (!displayName || !displayName.trim()) {
      return res.status(400).json({ error: 'Player name is required' });
    }

    const name = displayName.trim();
    if (name.length < 2 || name.length > 30) {
      return res.status(400).json({ error: 'Name must be 2-30 characters' });
    }

    const store = getStore();

    // Create a new player each time (simple approach - no accounts)
    const player = {
      player_id: nextId('player'),
      username: `player_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      password_hash: '',
      display_name: name,
      games_played: 0,
      games_won: 0,
      total_score: 0,
      created_at: new Date(),
      last_login: new Date(),
      is_online: true
    };
    store.players.push(player);

    const token = jwt.sign(
      { playerId: player.player_id, displayName: player.display_name },
      process.env.JWT_SECRET || 'uno-game-secret',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      player: {
        playerId: player.player_id,
        displayName: player.display_name
      }
    });
  } catch (err) {
    console.error('Quick join error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Leaderboard
router.get('/leaderboard', (req, res) => {
  try {
    const store = getStore();
    const result = store.players
      .filter(p => p.username !== '__uno_bot__' && p.games_played > 0)
      .sort((a, b) => b.games_won - a.games_won || b.total_score - a.total_score)
      .slice(0, 20)
      .map(p => ({
        player_id: p.player_id,
        display_name: p.display_name,
        games_played: p.games_played,
        games_won: p.games_won,
        total_score: p.total_score
      }));
    res.json(result);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
