const { socketAuthMiddleware } = require('../middleware/auth');
const gameManager = require('../game/gameManager');

function setupSocketHandlers(io) {
  // Authenticate all socket connections
  io.use(socketAuthMiddleware);

  // Track which socket is in which room
  const playerSockets = new Map(); // playerId -> socket
  const gameRooms = new Map(); // gameId -> Set of playerIds

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
