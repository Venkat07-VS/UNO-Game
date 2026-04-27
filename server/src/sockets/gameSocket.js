const { socketAuthMiddleware } = require('../middleware/auth');
const gameManager = require('../game/gameManager');
const { getOrCreateBot, chooseBotCard, chooseBotColor, BOT_USERNAME } = require('../game/botPlayer');
const { getStore } = require('../config/database');

// Track bot player id (resolved once at startup)
let botPlayerId = null;
function resolveBotId() {
  try {
    const bot = getOrCreateBot();
    botPlayerId = bot.player_id;
  } catch (e) {
    // Will resolve lazily
  }
}

function setupSocketHandlers(io) {
  resolveBotId();

  // Authenticate all socket connections
  io.use(socketAuthMiddleware);

  // Track which socket is in which room
  const playerSockets = new Map(); // playerId -> socket
  const gameRooms = new Map(); // gameId -> Set of playerIds

  /**
   * If it's the bot's turn, auto-play after a short delay.
   */
  function checkBotTurn(gameId, roomName) {
    if (!botPlayerId) {
      try { const bot = getOrCreateBot(); botPlayerId = bot.player_id; } catch { return; }
    }

    const store = getStore();
    const game = store.games.find(g => g.game_id === gameId);
    if (!game || game.status !== 'playing' || game.current_turn_player_id !== botPlayerId) return;

    // It's the bot's turn – play after a brief delay for realism
    setTimeout(() => {
      try {
        executeBotTurn(gameId, roomName, io, playerSockets);
      } catch (err) {
        console.error('Bot turn error:', err.message);
      }
    }, 1500);
  }

  /**
   * Execute one bot turn: play a card or draw.
   */
  function executeBotTurn(gameId, roomName, io, playerSockets) {
    const store = getStore();

    // Re-check it's still bot's turn
    const game = store.games.find(g => g.game_id === gameId);
    if (!game || game.status !== 'playing' || game.current_turn_player_id !== botPlayerId) return;

    // Get bot's hand
    const hand = gameManager.getPlayerHand(gameId, botPlayerId);
    const card = chooseBotCard(hand, game.current_color, game.current_value);

    // Get human players in this game
    const humanPlayerIds = store.gamePlayers
      .filter(gp => gp.game_id === gameId && gp.player_id !== botPlayerId)
      .map(gp => gp.player_id);

    if (card) {
      // Bot plays a card
      const chosenColor = card.color === 'wild' ? chooseBotColor(hand) : null;
      const result = gameManager.playCard(gameId, botPlayerId, card.color, card.value, chosenColor);

      if (result.gameOver) {
        io.to(roomName).emit('game_over', {
          winnerId: result.winnerId,
          winnerName: result.winnerName,
          score: result.score
        });
      } else {
        io.to(roomName).emit('card_played', {
          playerId: botPlayerId,
          card: result.card,
          effect: result.effect,
          newColor: result.newColor,
          newDirection: result.newDirection,
          nextPlayerId: result.nextPlayerId,
          remainingCards: result.remainingCards,
          drawCount: result.drawCount,
          drawnByPlayerId: result.drawnByPlayerId
        });

        // Send updated hands to affected human players
        if (result.drawnByPlayerId && result.drawnByPlayerId !== botPlayerId) {
          const drawnPlayerSocket = playerSockets.get(result.drawnByPlayerId);
          if (drawnPlayerSocket) {
            const drawnHand = gameManager.getPlayerHand(gameId, result.drawnByPlayerId);
            drawnPlayerSocket.emit('hand_update', { hand: drawnHand });
          }
        }

        if (humanPlayerIds.length > 0) {
          const humanId = humanPlayerIds[0];
          const gameState = gameManager.getGameState(gameId, humanId);
          io.to(roomName).emit('game_state_update', {
            currentTurnPlayerId: result.nextPlayerId,
            direction: result.newDirection,
            currentColor: result.newColor,
            currentValue: result.card.value,
            topCard: { color: result.newColor, value: result.card.value },
            players: gameState.players,
            drawPileCount: gameState.drawPileCount
          });

          for (const hpId of humanPlayerIds) {
            const hSocket = playerSockets.get(hpId);
            if (hSocket) {
              const hHand = gameManager.getPlayerHand(gameId, hpId);
              hSocket.emit('hand_update', { hand: hHand });
            }
          }
        }

        // If bot has 1 card, auto-call UNO
        if (result.remainingCards === 1) {
          try {
            gameManager.callUno(gameId, botPlayerId);
            io.to(roomName).emit('uno_called', { playerId: botPlayerId, displayName: 'UNO Bot 🤖' });
          } catch { /* ignore */ }
        }

        // Check if it's the bot's turn again
        checkBotTurn(gameId, roomName);
      }
    } else {
      // Bot draws a card
      const result = gameManager.drawCard(gameId, botPlayerId);

      io.to(roomName).emit('player_drew_card', {
        playerId: botPlayerId,
        turnEnded: result.turnEnded,
        nextPlayerId: result.nextPlayerId
      });

      if (humanPlayerIds.length > 0) {
        const humanId = humanPlayerIds[0];
        const gameState = gameManager.getGameState(gameId, humanId);
        io.to(roomName).emit('game_state_update', {
          currentTurnPlayerId: result.turnEnded ? result.nextPlayerId : gameState.currentTurnPlayerId,
          direction: gameState.direction,
          currentColor: gameState.currentColor,
          currentValue: gameState.currentValue,
          topCard: gameState.topCard,
          players: gameState.players,
          drawPileCount: gameState.drawPileCount
        });
      }

      // If bot drew a playable card, play it
      if (result.canPlay && result.drawnCard) {
        setTimeout(() => {
          try {
            const chosenColor = result.drawnCard.color === 'wild' ? chooseBotColor(gameManager.getPlayerHand(gameId, botPlayerId)) : null;
            const playResult = gameManager.playCard(gameId, botPlayerId, result.drawnCard.color, result.drawnCard.value, chosenColor);

            if (playResult.gameOver) {
              io.to(roomName).emit('game_over', {
                winnerId: playResult.winnerId,
                winnerName: playResult.winnerName,
                score: playResult.score
              });
            } else {
              io.to(roomName).emit('card_played', {
                playerId: botPlayerId,
                card: playResult.card,
                effect: playResult.effect,
                newColor: playResult.newColor,
                newDirection: playResult.newDirection,
                nextPlayerId: playResult.nextPlayerId,
                remainingCards: playResult.remainingCards,
                drawCount: playResult.drawCount,
                drawnByPlayerId: playResult.drawnByPlayerId
              });

              if (humanPlayerIds.length > 0) {
                const humanId = humanPlayerIds[0];
                const gs = gameManager.getGameState(gameId, humanId);
                io.to(roomName).emit('game_state_update', {
                  currentTurnPlayerId: playResult.nextPlayerId,
                  direction: playResult.newDirection,
                  currentColor: playResult.newColor,
                  currentValue: playResult.card.value,
                  topCard: { color: playResult.newColor, value: playResult.card.value },
                  players: gs.players,
                  drawPileCount: gs.drawPileCount
                });

                for (const hpId of humanPlayerIds) {
                  const hSocket = playerSockets.get(hpId);
                  if (hSocket) {
                    const hHand = gameManager.getPlayerHand(gameId, hpId);
                    hSocket.emit('hand_update', { hand: hHand });
                  }
                }
              }

              if (playResult.remainingCards === 1) {
                try {
                  gameManager.callUno(gameId, botPlayerId);
                  io.to(roomName).emit('uno_called', { playerId: botPlayerId, displayName: 'UNO Bot 🤖' });
                } catch { /* ignore */ }
              }

              checkBotTurn(gameId, roomName);
            }
          } catch (err) {
            console.error('Bot play drawn card error:', err.message);
          }
        }, 1000);
      } else {
        if (result.turnEnded) {
          checkBotTurn(gameId, roomName);
        }
      }
    }
  }

  io.on('connection', (socket) => {
    const { playerId, displayName } = socket.user;
    playerSockets.set(playerId, socket);

    // Mark player online
    const store = getStore();
    const playerRecord = store.players.find(p => p.player_id === playerId);
    if (playerRecord) playerRecord.is_online = true;

    console.log(`Player connected: ${displayName} (${playerId})`);

    // Join game room
    socket.on('join_room', (data) => {
      try {
        const { gameId } = data;
        const roomName = `game_${gameId}`;
        socket.join(roomName);

        if (!gameRooms.has(gameId)) {
          gameRooms.set(gameId, new Set());
        }
        gameRooms.get(gameId).add(playerId);
        socket.gameId = gameId;

        const players = gameManager.getLobbyPlayers(gameId);
        io.to(roomName).emit('lobby_update', { players });
        socket.emit('room_joined', { gameId, players });
        console.log(`${displayName} joined room ${gameId}`);
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Start game
    socket.on('start_game', (data) => {
      try {
        const { gameId } = data;
        const result = gameManager.startGame(gameId, playerId);
        const roomName = `game_${gameId}`;

        // Send game_started to each player with their specific hand
        const players = result.gameState.players;
        for (const p of players) {
          // Use direct socket ref for current player (host), playerSockets for others
          const targetSocket = (p.player_id === playerId) ? socket : playerSockets.get(p.player_id);
          if (targetSocket) {
            targetSocket.emit('game_started', {
              gameState: result.gameState,
              myHand: result.playerHands[p.player_id]
            });
          }
        }

        // Also broadcast a generic notification so any socket in the room
        // that missed the direct emit can request the full state
        io.to(roomName).emit('game_started_notification', { gameId });

        console.log(`Game ${gameId} started by ${displayName}`);
        checkBotTurn(gameId, roomName);
      } catch (err) {
        console.error(`Start game error for game ${data?.gameId}:`, err.message);
        socket.emit('error', { message: err.message });
      }
    });

    // Play a card
    socket.on('play_card', (data) => {
      try {
        const { gameId, cardColor, cardValue, chosenColor } = data;
        const result = gameManager.playCard(gameId, playerId, cardColor, cardValue, chosenColor);
        const roomName = `game_${gameId}`;

        if (result.gameOver) {
          io.to(roomName).emit('game_over', {
            winnerId: result.winnerId,
            winnerName: result.winnerName,
            score: result.score
          });
        } else {
          io.to(roomName).emit('card_played', {
            playerId,
            card: result.card,
            effect: result.effect,
            newColor: result.newColor,
            newDirection: result.newDirection,
            nextPlayerId: result.nextPlayerId,
            remainingCards: result.remainingCards,
            drawCount: result.drawCount,
            drawnByPlayerId: result.drawnByPlayerId
          });

          const myHand = gameManager.getPlayerHand(gameId, playerId);
          socket.emit('hand_update', { hand: myHand });

          if (result.drawnByPlayerId) {
            const drawnPlayerSocket = playerSockets.get(result.drawnByPlayerId);
            if (drawnPlayerSocket) {
              const drawnHand = gameManager.getPlayerHand(gameId, result.drawnByPlayerId);
              drawnPlayerSocket.emit('hand_update', { hand: drawnHand });
            }
          }

          const gameState = gameManager.getGameState(gameId, playerId);
          io.to(roomName).emit('game_state_update', {
            currentTurnPlayerId: result.nextPlayerId,
            direction: result.newDirection,
            currentColor: result.newColor,
            currentValue: result.card.value,
            topCard: { color: result.newColor, value: result.card.value },
            players: gameState.players,
            drawPileCount: gameState.drawPileCount
          });

          checkBotTurn(gameId, roomName);
        }
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Draw a card
    socket.on('draw_card', (data) => {
      try {
        const { gameId } = data;
        const result = gameManager.drawCard(gameId, playerId);
        const roomName = `game_${gameId}`;

        socket.emit('card_drawn', {
          drawnCard: result.drawnCard,
          canPlay: result.canPlay,
          turnEnded: result.turnEnded
        });

        const myHand = gameManager.getPlayerHand(gameId, playerId);
        socket.emit('hand_update', { hand: myHand });

        const gameState = gameManager.getGameState(gameId, playerId);
        io.to(roomName).emit('game_state_update', {
          currentTurnPlayerId: result.turnEnded ? result.nextPlayerId : gameState.currentTurnPlayerId,
          direction: gameState.direction,
          currentColor: gameState.currentColor,
          currentValue: gameState.currentValue,
          topCard: gameState.topCard,
          players: gameState.players,
          drawPileCount: gameState.drawPileCount
        });

        io.to(roomName).emit('player_drew_card', {
          playerId,
          turnEnded: result.turnEnded,
          nextPlayerId: result.nextPlayerId
        });

        if (result.turnEnded) {
          checkBotTurn(gameId, roomName);
        }
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Call UNO
    socket.on('call_uno', (data) => {
      try {
        const { gameId } = data;
        gameManager.callUno(gameId, playerId);
        const roomName = `game_${gameId}`;

        io.to(roomName).emit('uno_called', {
          playerId,
          displayName
        });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Challenge UNO
    socket.on('challenge_uno', (data) => {
      try {
        const { gameId, challengedPlayerId } = data;
        const result = gameManager.challengeUno(gameId, challengedPlayerId);
        const roomName = `game_${gameId}`;

        const challengedSocket = playerSockets.get(challengedPlayerId);
        if (challengedSocket) {
          const hand = gameManager.getPlayerHand(gameId, challengedPlayerId);
          challengedSocket.emit('hand_update', { hand });
        }

        io.to(roomName).emit('uno_challenged', {
          challengerId: playerId,
          challengedPlayerId,
          penaltyCards: result.penaltyCards
        });

        const gameState = gameManager.getGameState(gameId, playerId);
        io.to(roomName).emit('game_state_update', {
          currentTurnPlayerId: gameState.currentTurnPlayerId,
          direction: gameState.direction,
          currentColor: gameState.currentColor,
          currentValue: gameState.currentValue,
          topCard: gameState.topCard,
          players: gameState.players,
          drawPileCount: gameState.drawPileCount
        });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Get game state (reconnect)
    socket.on('get_game_state', (data) => {
      try {
        const { gameId } = data;
        const gameState = gameManager.getGameState(gameId, playerId);
        socket.emit('full_game_state', gameState);
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Chat message
    socket.on('chat_message', (data) => {
      const { gameId, message } = data;
      if (message && message.trim().length > 0 && message.length <= 200) {
        const roomName = `game_${gameId}`;
        io.to(roomName).emit('chat_message', {
          playerId,
          displayName,
          message: message.trim(),
          timestamp: new Date().toISOString()
        });
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      // Only remove from playerSockets if this is still the active socket for this player
      // (prevents race condition when a new socket connects before the old one disconnects)
      if (playerSockets.get(playerId) === socket) {
        playerSockets.delete(playerId);
        // Mark player offline
        const storeRef = getStore();
        const pRecord = storeRef.players.find(p => p.player_id === playerId);
        if (pRecord) pRecord.is_online = false;
      }

      if (socket.gameId) {
        const roomName = `game_${socket.gameId}`;
        io.to(roomName).emit('player_disconnected', {
          playerId,
          displayName
        });

        const roomPlayers = gameRooms.get(socket.gameId);
        if (roomPlayers) {
          roomPlayers.delete(playerId);
          if (roomPlayers.size === 0) {
            gameRooms.delete(socket.gameId);
          }
        }
      }

      console.log(`Player disconnected: ${displayName} (${playerId})`);
    });
  });
}

module.exports = setupSocketHandlers;
