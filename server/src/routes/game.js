const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const gameManager = require('../game/gameManager');
const { getStore } = require('../config/database');
const { getOrCreateBot, chooseBotCard, chooseBotColor } = require('../game/botPlayer');

const router = express.Router();

/**
 * Execute all consecutive bot turns until it's a human's turn or game ends.
 * Returns an array of bot moves for client display.
 */
function processBotTurns(gameId) {
  const store = getStore();
  let botId;
  try {
    const bot = getOrCreateBot();
    botId = bot.player_id;
  } catch {
    return [];
  }

  const moves = [];
  let safety = 0;

  while (safety < 20) {
    safety++;
    const game = store.games.find(g => g.game_id === gameId);
    if (!game || game.status !== 'playing' || game.current_turn_player_id !== botId) break;

    const hand = gameManager.getPlayerHand(gameId, botId);
    const card = chooseBotCard(hand, game.current_color, game.current_value);

    if (card) {
      // Bot plays a card
      const chosenColor = card.color === 'wild' ? chooseBotColor(hand) : null;
      const result = gameManager.playCard(gameId, botId, card.color, card.value, chosenColor);
      moves.push({ type: 'play', card, chosenColor });

      if (result.remainingCards === 1) {
        try { gameManager.callUno(gameId, botId); } catch { /* ignore */ }
      }
      if (result.gameOver) break;
    } else {
      // Bot draws a card
      const drawResult = gameManager.drawCard(gameId, botId);
      moves.push({ type: 'draw' });

      if (drawResult.canPlay && drawResult.drawnCard) {
        const newHand = gameManager.getPlayerHand(gameId, botId);
        const chosenColor = drawResult.drawnCard.color === 'wild' ? chooseBotColor(newHand) : null;
        const playResult = gameManager.playCard(gameId, botId, drawResult.drawnCard.color, drawResult.drawnCard.value, chosenColor);
        moves.push({ type: 'play', card: drawResult.drawnCard, chosenColor });

        if (playResult.remainingCards === 1) {
          try { gameManager.callUno(gameId, botId); } catch { /* ignore */ }
        }
        if (playResult.gameOver) break;
      }
    }
  }

  return moves;
}

// Start game
router.post('/:gameId/start', authMiddleware, (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const result = gameManager.startGame(gameId, req.user.playerId);

    // Execute bot turns if bot goes first
    const botMoves = processBotTurns(gameId);

    const gameState = gameManager.getGameState(gameId, req.user.playerId);
    res.json({
      gameState,
      myHand: gameState.myHand,
      playerHands: result.playerHands,
      botMoves
    });
  } catch (err) {
    console.error('Start game error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Play a card
router.post('/:gameId/play-card', authMiddleware, (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const { cardColor, cardValue, chosenColor } = req.body;

    const result = gameManager.playCard(gameId, req.user.playerId, cardColor, cardValue, chosenColor);

    let botMoves = [];
    if (!result.gameOver) {
      botMoves = processBotTurns(gameId);
    }

    const gameState = gameManager.getGameState(gameId, req.user.playerId);
    res.json({ result, gameState, botMoves });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Draw a card
router.post('/:gameId/draw-card', authMiddleware, (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const result = gameManager.drawCard(gameId, req.user.playerId);

    let botMoves = [];
    if (result.turnEnded) {
      botMoves = processBotTurns(gameId);
    }

    const gameState = gameManager.getGameState(gameId, req.user.playerId);
    res.json({ ...result, gameState, botMoves });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Call UNO
router.post('/:gameId/call-uno', authMiddleware, (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    gameManager.callUno(gameId, req.user.playerId);
    const gameState = gameManager.getGameState(gameId, req.user.playerId);
    res.json({ success: true, gameState });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Challenge UNO
router.post('/:gameId/challenge-uno', authMiddleware, (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const { challengedPlayerId } = req.body;
    const result = gameManager.challengeUno(gameId, challengedPlayerId);

    const gameState = gameManager.getGameState(gameId, req.user.playerId);
    res.json({ ...result, gameState });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Send chat message
router.post('/:gameId/chat', authMiddleware, (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const { message } = req.body;

    if (!message || !message.trim() || message.length > 200) {
      return res.status(400).json({ error: 'Invalid message' });
    }

    const store = getStore();
    if (!store.chatMessages) store.chatMessages = [];

    const chatMsg = {
      gameId,
      playerId: req.user.playerId,
      displayName: req.user.displayName,
      message: message.trim(),
      timestamp: new Date().toISOString()
    };
    store.chatMessages.push(chatMsg);

    // Keep only last 100 messages per game
    const gameMessages = store.chatMessages.filter(m => m.gameId === gameId);
    if (gameMessages.length > 100) {
      store.chatMessages = store.chatMessages.filter(m => m.gameId !== gameId)
        .concat(gameMessages.slice(-100));
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get chat messages
router.get('/:gameId/messages', authMiddleware, (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const since = req.query.since || '';
    const store = getStore();

    let messages = (store.chatMessages || []).filter(m => m.gameId === gameId);
    if (since) {
      messages = messages.filter(m => m.timestamp > since);
    }

    res.json(messages.slice(-50));
  } catch (err) {
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

module.exports = router;
