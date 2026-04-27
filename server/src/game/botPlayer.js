const { getStore, nextId } = require('../config/database');
const { isValidPlay } = require('./rules');

const BOT_DISPLAY_NAME = 'UNO Bot 🤖';
const BOT_USERNAME = '__uno_bot__';

/**
 * Get or create the bot player in memory
 */
function getOrCreateBot() {
  const store = getStore();

  const existing = store.players.find(p => p.username === BOT_USERNAME);
  if (existing) {
    return { player_id: existing.player_id, display_name: existing.display_name };
  }

  const bot = {
    player_id: nextId('player'),
    username: BOT_USERNAME,
    password_hash: 'BOT_NO_LOGIN',
    display_name: BOT_DISPLAY_NAME,
    games_played: 0,
    games_won: 0,
    total_score: 0,
    created_at: new Date(),
    last_login: new Date(),
    is_online: true
  };
  store.players.push(bot);

  return { player_id: bot.player_id, display_name: bot.display_name };
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
