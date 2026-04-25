const { getPool, sql } = require('../config/database');
const { isValidPlay } = require('./rules');

const BOT_DISPLAY_NAME = 'UNO Bot 🤖';
const BOT_USERNAME = '__uno_bot__';

/**
 * Get or create the bot player row in the database
 */
async function getOrCreateBot() {
  const pool = getPool();

  const existing = await pool.request()
    .input('username', sql.NVarChar, BOT_USERNAME)
    .query('SELECT player_id, display_name FROM UNO_Players WHERE username = @username');

  if (existing.recordset.length > 0) {
    return existing.recordset[0];
  }

  // Create bot player with a dummy password hash (bot never logs in)
  const result = await pool.request()
    .input('username', sql.NVarChar, BOT_USERNAME)
    .input('passwordHash', sql.NVarChar, 'BOT_NO_LOGIN')
    .input('displayName', sql.NVarChar, BOT_DISPLAY_NAME)
    .query(`
      INSERT INTO UNO_Players (username, password_hash, display_name)
      OUTPUT INSERTED.player_id, INSERTED.display_name
      VALUES (@username, @passwordHash, @displayName)
    `);

  return result.recordset[0];
}

/**
 * Choose a card for the bot to play.
 * Strategy: play action/wild cards last, prefer matching color, then matching value.
 */
function chooseBotCard(hand, currentColor, currentValue) {
  const topCard = { color: currentColor, value: currentValue };
  const playable = hand.filter(c => isValidPlay(c, topCard, currentColor));

  if (playable.length === 0) return null;

  // Prefer non-wild color matches first, then value matches, then wilds last
  const colorMatches = playable.filter(c => c.color === currentColor && c.color !== 'wild');
  const valueMatches = playable.filter(c => c.value === currentValue && c.color !== 'wild');
  const wilds = playable.filter(c => c.color === 'wild');

  const pick = colorMatches[0] || valueMatches[0] || wilds[0] || playable[0];
  return pick;
}

/**
 * Choose a color when bot plays a wild card (pick the color it has the most of)
 */
function chooseBotColor(hand) {
  const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
  for (const c of hand) {
    if (counts[c.color] !== undefined) {
      counts[c.color]++;
    }
  }
  let best = 'red';
  for (const color of ['blue', 'green', 'yellow']) {
    if (counts[color] > counts[best]) best = color;
  }
  return best;
}

module.exports = { getOrCreateBot, chooseBotCard, chooseBotColor, BOT_USERNAME };
