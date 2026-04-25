const { socketAuthMiddleware } = require('../middleware/auth');
const gameManager = require('../game/gameManager');
const { getOrCreateBot, chooseBotCard, chooseBotColor, BOT_USERNAME } = require('../game/botPlayer');
const { getPool, sql } = require('../config/database');

// Track bot player id (resolved once at startup)
let botPlayerId = null;
async function resolveBotId() {
  try {
    const bot = await getOrCreateBot();
    botPlayerId = bot.player_id;
  } catch (e) {
    // Bot table may not exist yet; will resolve lazily
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
  async function checkBotTurn(gameId, roomName) {
    if (!botPlayerId) {
      try { const bot = await getOrCreateBot(); botPlayerId = bot.player_id; } catch { return; }
    }

    // Check if bot is in this game and if it's bot's turn
    const pool = getPool();
    const gameResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`SELECT current_turn_player_id, status FROM UNO_Games WHERE game_id = @gameId`);

    if (gameResult.recordset.length === 0) return;
    const game = gameResult.recordset[0];
    if (game.status !== 'playing' || game.current_turn_player_id !== botPlayerId) return;

    // It's the bot's turn – play after a brief delay for realism
    setTimeout(async () => {
      try {
        await executeBotTurn(gameId, roomName, io, playerSockets);
      } catch (err) {
        console.error('Bot turn error:', err.message);
      }
    }, 1500);
  }

  /**
   * Execute one bot turn: play a card or draw.
   */
  async function executeBotTurn(gameId, roomName, io, playerSockets) {
    const pool = getPool();

    // Re-check it's still bot's turn (game may have ended)
    const gameCheck = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`SELECT current_turn_player_id, status, current_color, current_value FROM UNO_Games WHERE game_id = @gameId`);
    if (gameCheck.recordset.length === 0) return;
    const game = gameCheck.recordset[0];
    if (game.status !== 'playing' || game.current_turn_player_id !== botPlayerId) return;

    // Get bot's hand
    const hand = await gameManager.getPlayerHand(gameId, botPlayerId);
    const card = chooseBotCard(hand, game.current_color, game.current_value);

    if (card) {
      // Bot plays a card
      const chosenColor = card.color === 'wild' ? chooseBotColor(hand) : null;
      const result = await gameManager.playCard(gameId, botPlayerId, card.color, card.value, chosenColor);

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
            const drawnHand = await gameManager.getPlayerHand(gameId, result.drawnByPlayerId);
            drawnPlayerSocket.emit('hand_update', { hand: drawnHand });
          }
        }

        // Update all players with new game state
        // Use any human player id to get state; bot doesn't need the socket emit
        const humanPlayers = await pool.request()
          .input('gameId', sql.Int, gameId)
          .input('botId', sql.Int, botPlayerId)
          .query(`SELECT player_id FROM UNO_GamePlayers WHERE game_id = @gameId AND player_id != @botId`);

        if (humanPlayers.recordset.length > 0) {
          const humanId = humanPlayers.recordset[0].player_id;
          const gameState = await gameManager.getGameState(gameId, humanId);
          io.to(roomName).emit('game_state_update', {
            currentTurnPlayerId: result.nextPlayerId,
            direction: result.newDirection,
            currentColor: result.newColor,
            currentValue: result.card.value,
            topCard: { color: result.newColor, value: result.card.value },
            players: gameState.players,
            drawPileCount: gameState.drawPileCount
          });

          // Send each human player their updated hand
          for (const hp of humanPlayers.recordset) {
            const hSocket = playerSockets.get(hp.player_id);
            if (hSocket) {
              const hHand = await gameManager.getPlayerHand(gameId, hp.player_id);
              hSocket.emit('hand_update', { hand: hHand });
            }
          }
        }

        // If bot has 1 card, auto-call UNO
        if (result.remainingCards === 1) {
          try {
            await gameManager.callUno(gameId, botPlayerId);
            io.to(roomName).emit('uno_called', { playerId: botPlayerId, displayName: 'UNO Bot 🤖' });
          } catch { /* ignore */ }
        }

        // Check if it's the bot's turn again (e.g. reverse in 2-player)
        await checkBotTurn(gameId, roomName);
      }
    } else {
      // Bot draws a card
      const result = await gameManager.drawCard(gameId, botPlayerId);

      io.to(roomName).emit('player_drew_card', {
        playerId: botPlayerId,
        turnEnded: result.turnEnded,
        nextPlayerId: result.nextPlayerId
      });

      // Update game state for all
      const humanPlayers = await pool.request()
        .input('gameId', sql.Int, gameId)
        .input('botId', sql.Int, botPlayerId)
        .query(`SELECT player_id FROM UNO_GamePlayers WHERE game_id = @gameId AND player_id != @botId`);

      if (humanPlayers.recordset.length > 0) {
        const humanId = humanPlayers.recordset[0].player_id;
        const gameState = await gameManager.getGameState(gameId, humanId);
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
        setTimeout(async () => {
          try {
            const chosenColor = result.drawnCard.color === 'wild' ? chooseBotColor(await gameManager.getPlayerHand(gameId, botPlayerId)) : null;
            const playResult = await gameManager.playCard(gameId, botPlayerId, result.drawnCard.color, result.drawnCard.value, chosenColor);

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

              if (humanPlayers.recordset.length > 0) {
                const humanId = humanPlayers.recordset[0].player_id;
                const gs = await gameManager.getGameState(gameId, humanId);
                io.to(roomName).emit('game_state_update', {
                  currentTurnPlayerId: playResult.nextPlayerId,
                  direction: playResult.newDirection,
                  currentColor: playResult.newColor,
                  currentValue: playResult.card.value,
                  topCard: { color: playResult.newColor, value: playResult.card.value },
                  players: gs.players,
                  drawPileCount: gs.drawPileCount
                });

                for (const hp of humanPlayers.recordset) {
                  const hSocket = playerSockets.get(hp.player_id);
                  if (hSocket) {
                    const hHand = await gameManager.getPlayerHand(gameId, hp.player_id);
                    hSocket.emit('hand_update', { hand: hHand });
                  }
                }
              }

              if (playResult.remainingCards === 1) {
                try {
                  await gameManager.callUno(gameId, botPlayerId);
                  io.to(roomName).emit('uno_called', { playerId: botPlayerId, displayName: 'UNO Bot 🤖' });
                } catch { /* ignore */ }
              }

              await checkBotTurn(gameId, roomName);
            }
          } catch (err) {
            console.error('Bot play drawn card error:', err.message);
          }
        }, 1000);
      } else {
        // Turn ended, check if next turn is still bot (shouldn't be, but just in case)
        if (result.turnEnded) {
          await checkBotTurn(gameId, roomName);
        }
      }
    }
  }

  io.on('connection', (socket) => {
    const { playerId, displayName } = socket.user;
    playerSockets.set(playerId, socket);
    console.log(`Player connected: ${displayName} (${playerId})`);

    // Join game room (socket.io room)
    socket.on('join_room', async (data) => {
      try {
        const { gameId } = data;
        const roomName = `game_${gameId}`;
        socket.join(roomName);

        // Track player in room
        if (!gameRooms.has(gameId)) {
          gameRooms.set(gameId, new Set());
        }
        gameRooms.get(gameId).add(playerId);
        socket.gameId = gameId;

        // Notify others
        const players = await gameManager.getLobbyPlayers(gameId);
        io.to(roomName).emit('lobby_update', { players });

        socket.emit('room_joined', { gameId, players });
        console.log(`${displayName} joined room ${gameId}`);
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Start game
    socket.on('start_game', async (data) => {
      try {
        const { gameId } = data;
        const result = await gameManager.startGame(gameId, playerId);
        const roomName = `game_${gameId}`;

        // Send each player their hand privately
        const players = result.gameState.players;
        for (const player of players) {
          const playerSocket = playerSockets.get(player.playerId);
          if (playerSocket) {
            playerSocket.emit('game_started', {
              gameState: result.gameState,
              myHand: result.playerHands[player.playerId],
              pendingDraw: result.pendingDraw
            });
          }
        }

        console.log(`Game ${gameId} started by ${displayName}`);

        // Check if bot goes first
        const roomName2 = `game_${gameId}`;
        await checkBotTurn(gameId, roomName2);
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Play a card
    socket.on('play_card', async (data) => {
      try {
        const { gameId, cardColor, cardValue, chosenColor } = data;
        const result = await gameManager.playCard(gameId, playerId, cardColor, cardValue, chosenColor);
        const roomName = `game_${gameId}`;

        if (result.gameOver) {
          io.to(roomName).emit('game_over', {
            winnerId: result.winnerId,
            winnerName: result.winnerName,
            score: result.score
          });
        } else {
          // Broadcast card played to all players
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

          // Send updated hands to affected players
          // The player who played
          const myHand = await gameManager.getPlayerHand(gameId, playerId);
          socket.emit('hand_update', { hand: myHand });

          // Player who had to draw (if any)
          if (result.drawnByPlayerId) {
            const drawnPlayerSocket = playerSockets.get(result.drawnByPlayerId);
            if (drawnPlayerSocket) {
              const drawnHand = await gameManager.getPlayerHand(gameId, result.drawnByPlayerId);
              drawnPlayerSocket.emit('hand_update', { hand: drawnHand });
            }
          }

          // Update all players with new card counts
          const gameState = await gameManager.getGameState(gameId, playerId);
          io.to(roomName).emit('game_state_update', {
            currentTurnPlayerId: result.nextPlayerId,
            direction: result.newDirection,
            currentColor: result.newColor,
            currentValue: result.card.value,
            topCard: { color: result.newColor, value: result.card.value },
            players: gameState.players,
            drawPileCount: gameState.drawPileCount
          });

          // Check if it's now the bot's turn
          await checkBotTurn(gameId, roomName);
        }
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Draw a card
    socket.on('draw_card', async (data) => {
      try {
        const { gameId } = data;
        const result = await gameManager.drawCard(gameId, playerId);
        const roomName = `game_${gameId}`;

        // Send the drawn card to the player
        socket.emit('card_drawn', {
          drawnCard: result.drawnCard,
          canPlay: result.canPlay,
          turnEnded: result.turnEnded
        });

        // Send updated hand
        const myHand = await gameManager.getPlayerHand(gameId, playerId);
        socket.emit('hand_update', { hand: myHand });

        // Notify all players
        const gameState = await gameManager.getGameState(gameId, playerId);
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

        // Check if it's now the bot's turn
        if (result.turnEnded) {
          await checkBotTurn(gameId, roomName);
        }
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Call UNO
    socket.on('call_uno', async (data) => {
      try {
        const { gameId } = data;
        await gameManager.callUno(gameId, playerId);
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
    socket.on('challenge_uno', async (data) => {
      try {
        const { gameId, challengedPlayerId } = data;
        const result = await gameManager.challengeUno(gameId, challengedPlayerId);
        const roomName = `game_${gameId}`;

        // Update challenged player's hand
        const challengedSocket = playerSockets.get(challengedPlayerId);
        if (challengedSocket) {
          const hand = await gameManager.getPlayerHand(gameId, challengedPlayerId);
          challengedSocket.emit('hand_update', { hand });
        }

        io.to(roomName).emit('uno_challenged', {
          challengerId: playerId,
          challengedPlayerId,
          penaltyCards: result.penaltyCards
        });

        // Update game state for all
        const gameState = await gameManager.getGameState(gameId, playerId);
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
    socket.on('get_game_state', async (data) => {
      try {
        const { gameId } = data;
        const gameState = await gameManager.getGameState(gameId, playerId);
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
      playerSockets.delete(playerId);

      // Notify rooms this player was in
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
