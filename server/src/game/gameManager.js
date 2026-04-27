const { getStore, nextId } = require('../config/database');
const { createDeck, shuffleDeck } = require('./deck');
const { isValidPlay, hasValidPlay, getNextPlayerIndex, calculateScore, getCardEffect } = require('./rules');

class GameManager {
  constructor() {
    this.activeGames = new Map();
  }

  /**
   * Create a new game room
   */
  createGame(hostPlayerId, maxPlayers = 4) {
    const store = getStore();
    const roomCode = this.generateRoomCode();

    const game = {
      game_id: nextId('game'),
      room_code: roomCode,
      host_player_id: hostPlayerId,
      status: 'waiting',
      max_players: maxPlayers,
      current_turn_player_id: null,
      direction: 1,
      current_color: null,
      current_value: null,
      winner_player_id: null,
      created_at: new Date(),
      started_at: null,
      ended_at: null
    };
    store.games.push(game);

    // Host joins automatically
    this.joinGame(game.game_id, hostPlayerId);

    return { gameId: game.game_id, roomCode: game.room_code };
  }

  /**
   * Join an existing game
   */
  joinGame(gameId, playerId) {
    const store = getStore();
    const game = store.games.find(g => g.game_id === gameId && g.status === 'waiting');

    if (!game) {
      throw new Error('Game not found or already started');
    }

    const currentPlayers = store.gamePlayers.filter(gp => gp.game_id === gameId);
    if (currentPlayers.length >= game.max_players) {
      throw new Error('Game is full');
    }

    const existing = currentPlayers.find(gp => gp.player_id === playerId);
    if (existing) {
      return { alreadyJoined: true };
    }

    store.gamePlayers.push({
      id: nextId('gamePlayer'),
      game_id: gameId,
      player_id: playerId,
      seat_position: currentPlayers.length,
      card_count: 0,
      has_called_uno: false,
      is_active: true,
      joined_at: new Date()
    });

    return { seatPosition: currentPlayers.length, playerCount: currentPlayers.length + 1 };
  }

  /**
   * Start a game - deal cards, set up piles
   */
  startGame(gameId, hostPlayerId) {
    const store = getStore();
    const game = store.games.find(g => g.game_id === gameId && g.status === 'waiting');

    if (!game) {
      throw new Error('Game not found or already started');
    }

    if (game.host_player_id !== hostPlayerId) {
      throw new Error('Only the host can start the game');
    }

    const gamePlayers = store.gamePlayers
      .filter(gp => gp.game_id === gameId)
      .sort((a, b) => a.seat_position - b.seat_position);

    if (gamePlayers.length < 2) {
      throw new Error('Need at least 2 players to start');
    }

    const players = gamePlayers.map(gp => {
      const p = store.players.find(pl => pl.player_id === gp.player_id);
      return { ...gp, display_name: p.display_name, username: p.username };
    });

    // Create and shuffle deck
    let deck = shuffleDeck(createDeck());

    // Deal 7 cards to each player
    const CARDS_PER_PLAYER = 7;
    const playerHands = {};

    for (const player of players) {
      playerHands[player.player_id] = [];
      for (let i = 0; i < CARDS_PER_PLAYER; i++) {
        const card = deck.pop();
        playerHands[player.player_id].push(card);

        store.playerHands.push({
          id: nextId('playerHand'),
          game_id: gameId,
          player_id: player.player_id,
          card_color: card.color,
          card_value: card.value,
          card_order: i
        });
      }

      // Update card count
      const gp = store.gamePlayers.find(g => g.game_id === gameId && g.player_id === player.player_id);
      if (gp) gp.card_count = CARDS_PER_PLAYER;
    }

    // Find a valid starting card (not a wild draw 4)
    let startCardIndex = deck.length - 1;
    while (deck[startCardIndex].value === 'wild_draw4') {
      startCardIndex--;
    }
    const startCard = deck.splice(startCardIndex, 1)[0];

    let currentColor = startCard.color;
    if (startCard.color === 'wild') {
      const colors = ['red', 'blue', 'green', 'yellow'];
      currentColor = colors[Math.floor(Math.random() * 4)];
    }

    // Save draw pile
    for (let i = 0; i < deck.length; i++) {
      store.drawPile.push({
        id: nextId('drawPile'),
        game_id: gameId,
        card_color: deck[i].color,
        card_value: deck[i].value,
        pile_order: i
      });
    }

    // Save starting discard card
    store.discardPile.push({
      id: nextId('discardPile'),
      game_id: gameId,
      card_color: startCard.color,
      card_value: startCard.value,
      played_by_player_id: null,
      pile_order: 0,
      played_at: new Date()
    });

    // Determine first player and handle start card effects
    let direction = 1;
    let firstPlayerIndex = 0;
    const effect = getCardEffect(startCard);

    if (effect.type === 'reverse') {
      direction = -1;
      if (players.length === 2) {
        firstPlayerIndex = 1; // In 2-player, reverse acts like skip
      }
    } else if (effect.type === 'skip') {
      firstPlayerIndex = 1;
    } else if (effect.type === 'draw') {
      firstPlayerIndex = 1; // First player draws and turn is skipped
    }

    const firstPlayer = players[firstPlayerIndex];

    // Handle draw2 start card - player at index 0 draws cards
    if (effect.type === 'draw') {
      this.drawCards(gameId, players[0].player_id, effect.count);
      playerHands[players[0].player_id] = this.getPlayerHand(gameId, players[0].player_id);
    }

    // Update game
    game.status = 'playing';
    game.current_turn_player_id = firstPlayer.player_id;
    game.direction = direction;
    game.current_color = currentColor;
    game.current_value = startCard.value;
    game.started_at = new Date();

    const drawPileCount = store.drawPile.filter(d => d.game_id === gameId).length;

    const gameState = {
      gameId,
      roomCode: game.room_code,
      status: 'playing',
      players: players.map(p => {
        const gpEntry = store.gamePlayers.find(g => g.game_id === gameId && g.player_id === p.player_id);
        return {
          player_id: p.player_id,
          display_name: p.display_name,
          seat_position: p.seat_position,
          card_count: gpEntry ? gpEntry.card_count : CARDS_PER_PLAYER,
          has_called_uno: false,
          is_active: true
        };
      }),
      currentTurnPlayerId: firstPlayer.player_id,
      direction,
      currentColor,
      currentValue: startCard.value,
      topCard: startCard,
      drawPileCount
    };

    this.activeGames.set(gameId, gameState);

    return {
      gameState,
      playerHands
    };
  }

  /**
   * Play a card
   */
  playCard(gameId, playerId, cardColor, cardValue, chosenColor = null) {
    const store = getStore();
    const game = store.games.find(g => g.game_id === gameId && g.status === 'playing');

    if (!game) {
      throw new Error('Game not found or not in progress');
    }

    if (game.current_turn_player_id !== playerId) {
      throw new Error("It's not your turn");
    }

    const card = { color: cardColor, value: cardValue };
    const topCard = { color: game.current_color, value: game.current_value };

    if (!isValidPlay(card, topCard, game.current_color)) {
      throw new Error('Invalid card play');
    }

    // Verify player has this card
    const handIndex = store.playerHands.findIndex(
      h => h.game_id === gameId && h.player_id === playerId && h.card_color === cardColor && h.card_value === cardValue
    );

    if (handIndex === -1) {
      throw new Error("You don't have this card");
    }

    // Remove card from hand
    store.playerHands.splice(handIndex, 1);

    // Add to discard pile
    const maxOrder = store.discardPile
      .filter(d => d.game_id === gameId)
      .reduce((max, d) => Math.max(max, d.pile_order), 0);

    store.discardPile.push({
      id: nextId('discardPile'),
      game_id: gameId,
      card_color: cardColor,
      card_value: cardValue,
      played_by_player_id: playerId,
      pile_order: maxOrder + 1,
      played_at: new Date()
    });

    // Update card count
    const gp = store.gamePlayers.find(g => g.game_id === gameId && g.player_id === playerId);
    if (gp) gp.card_count--;

    const remainingCards = store.playerHands.filter(h => h.game_id === gameId && h.player_id === playerId).length;

    // Check for win
    if (remainingCards === 0) {
      return this.handleWin(gameId, playerId, game);
    }

    // Process card effects
    const effect = getCardEffect(card);
    let newDirection = game.direction;
    let newColor = cardColor === 'wild' ? chosenColor : cardColor;
    let drawCount = 0;
    let skipNext = false;

    if (effect.type === 'reverse') {
      newDirection = game.direction * -1;
      if (this.getPlayerCount(gameId) === 2) {
        skipNext = true;
      }
    } else if (effect.type === 'skip') {
      skipNext = true;
    } else if (effect.type === 'draw') {
      drawCount = effect.count;
      skipNext = true;
    } else if (effect.type === 'wild_draw4') {
      drawCount = 4;
      skipNext = true;
    }

    const players = store.gamePlayers
      .filter(gp2 => gp2.game_id === gameId && gp2.is_active)
      .sort((a, b) => a.seat_position - b.seat_position);

    const currentPlayerIndex = players.findIndex(p => p.player_id === playerId);
    const playerCount = players.length;

    let nextPlayerIndex = getNextPlayerIndex(currentPlayerIndex, playerCount, newDirection, skipNext);
    const nextPlayerId = players[nextPlayerIndex].player_id;

    if (drawCount > 0) {
      const skippedPlayerIndex = getNextPlayerIndex(currentPlayerIndex, playerCount, newDirection, false);
      const drawPlayerId = players[skippedPlayerIndex].player_id;
      this.drawCards(gameId, drawPlayerId, drawCount);
    }

    // Update game state
    game.current_turn_player_id = nextPlayerId;
    game.direction = newDirection;
    game.current_color = newColor;
    game.current_value = cardValue;

    // Reset UNO call
    if (gp) gp.has_called_uno = false;

    return {
      success: true,
      card: { color: cardColor, value: cardValue },
      effect,
      newColor,
      newDirection,
      nextPlayerId,
      remainingCards,
      drawCount,
      drawnByPlayerId: drawCount > 0 ? players[getNextPlayerIndex(currentPlayerIndex, playerCount, newDirection, false)].player_id : null,
      gameOver: false
    };
  }

  /**
   * Draw a card from the draw pile
   */
  drawCard(gameId, playerId) {
    const store = getStore();
    const game = store.games.find(g => g.game_id === gameId && g.status === 'playing');

    if (!game) {
      throw new Error('Game not found');
    }

    if (game.current_turn_player_id !== playerId) {
      throw new Error("It's not your turn");
    }

    const drawnCards = this.drawCards(gameId, playerId, 1);
    const drawnCard = drawnCards[0];
    const topCard = { color: game.current_color, value: game.current_value };
    const canPlay = isValidPlay(drawnCard, topCard, game.current_color);

    if (!canPlay) {
      const players = store.gamePlayers
        .filter(gp => gp.game_id === gameId && gp.is_active)
        .sort((a, b) => a.seat_position - b.seat_position);

      const currentIndex = players.findIndex(p => p.player_id === playerId);
      const nextIndex = getNextPlayerIndex(currentIndex, players.length, game.direction);
      const nextPlayerId = players[nextIndex].player_id;

      game.current_turn_player_id = nextPlayerId;

      return {
        drawnCard,
        canPlay: false,
        nextPlayerId,
        turnEnded: true
      };
    }

    return {
      drawnCard,
      canPlay: true,
      turnEnded: false
    };
  }

  /**
   * Draw multiple cards for a player
   */
  drawCards(gameId, playerId, count) {
    const store = getStore();
    const drawnCards = [];

    for (let i = 0; i < count; i++) {
      // Get top card from draw pile (highest pile_order)
      const drawPileCards = store.drawPile
        .filter(d => d.game_id === gameId)
        .sort((a, b) => b.pile_order - a.pile_order);

      if (drawPileCards.length === 0) {
        this.reshuffleDiscardPile(gameId);
        const retryCards = store.drawPile
          .filter(d => d.game_id === gameId)
          .sort((a, b) => b.pile_order - a.pile_order);
        if (retryCards.length === 0) break;
        drawPileCards.push(...retryCards);
      }

      const topCard = drawPileCards[0];

      // Remove from draw pile
      const idx = store.drawPile.findIndex(d => d.id === topCard.id);
      if (idx !== -1) store.drawPile.splice(idx, 1);

      // Add to player's hand
      store.playerHands.push({
        id: nextId('playerHand'),
        game_id: gameId,
        player_id: playerId,
        card_color: topCard.card_color,
        card_value: topCard.card_value,
        card_order: 0
      });

      drawnCards.push({ color: topCard.card_color, value: topCard.card_value });
    }

    // Update card count
    const gp = store.gamePlayers.find(g => g.game_id === gameId && g.player_id === playerId);
    if (gp) gp.card_count += drawnCards.length;

    return drawnCards;
  }

  /**
   * Call UNO
   */
  callUno(gameId, playerId) {
    const store = getStore();
    const handCount = store.playerHands.filter(h => h.game_id === gameId && h.player_id === playerId).length;

    if (handCount > 2) {
      throw new Error('You can only call UNO when you have 2 or fewer cards');
    }

    const gp = store.gamePlayers.find(g => g.game_id === gameId && g.player_id === playerId);
    if (gp) gp.has_called_uno = true;

    return { success: true };
  }

  /**
   * Challenge a player who didn't call UNO
   */
  challengeUno(gameId, challengedPlayerId) {
    const store = getStore();
    const gp = store.gamePlayers.find(g => g.game_id === gameId && g.player_id === challengedPlayerId);
    const handCount = store.playerHands.filter(h => h.game_id === gameId && h.player_id === challengedPlayerId).length;

    if (handCount !== 1 || (gp && gp.has_called_uno)) {
      throw new Error('Invalid UNO challenge');
    }

    this.drawCards(gameId, challengedPlayerId, 2);

    return { success: true, penaltyCards: 2 };
  }

  /**
   * Handle a win
   */
  handleWin(gameId, winnerId, game) {
    const store = getStore();

    // Calculate score from other players' remaining cards
    const otherHands = store.playerHands
      .filter(h => h.game_id === gameId && h.player_id !== winnerId)
      .map(h => ({ color: h.card_color, value: h.card_value }));

    const score = calculateScore(otherHands);

    const winner = store.players.find(p => p.player_id === winnerId);
    const winnerName = winner ? winner.display_name : 'Unknown';

    // Update game status
    game.status = 'finished';
    game.winner_player_id = winnerId;
    game.ended_at = new Date();

    // Update winner stats
    if (winner) {
      winner.games_won++;
      winner.games_played++;
      winner.total_score += score;
    }

    // Update other players' stats
    const otherPlayerIds = store.gamePlayers
      .filter(gp => gp.game_id === gameId && gp.player_id !== winnerId)
      .map(gp => gp.player_id);

    for (const pid of otherPlayerIds) {
      const p = store.players.find(pl => pl.player_id === pid);
      if (p) p.games_played++;
    }

    this.activeGames.delete(gameId);

    return {
      success: true,
      gameOver: true,
      winnerId,
      winnerName,
      score
    };
  }

  /**
   * Reshuffle discard pile into draw pile
   */
  reshuffleDiscardPile(gameId) {
    const store = getStore();
    const discardCards = store.discardPile.filter(d => d.game_id === gameId);

    if (discardCards.length <= 1) return;

    // Keep the top card (highest pile_order)
    const sorted = discardCards.sort((a, b) => b.pile_order - a.pile_order);
    const topCard = sorted[0];
    const cardsToShuffle = sorted.slice(1);

    // Remove shuffled cards from discard pile
    for (const card of cardsToShuffle) {
      const idx = store.discardPile.findIndex(d => d.id === card.id);
      if (idx !== -1) store.discardPile.splice(idx, 1);
    }

    // Shuffle and add to draw pile
    const shuffled = cardsToShuffle.sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length; i++) {
      store.drawPile.push({
        id: nextId('drawPile'),
        game_id: gameId,
        card_color: shuffled[i].card_color,
        card_value: shuffled[i].card_value,
        pile_order: i
      });
    }
  }

  /**
   * Get player's hand
   */
  getPlayerHand(gameId, playerId) {
    const store = getStore();
    return store.playerHands
      .filter(h => h.game_id === gameId && h.player_id === playerId)
      .sort((a, b) => a.card_color.localeCompare(b.card_color) || a.card_value.localeCompare(b.card_value))
      .map(h => ({ color: h.card_color, value: h.card_value }));
  }

  /**
   * Get full game state for a player
   */
  getGameState(gameId, playerId) {
    const store = getStore();
    const game = store.games.find(g => g.game_id === gameId);

    if (!game) {
      throw new Error('Game not found');
    }

    const gamePlayers = store.gamePlayers
      .filter(gp => gp.game_id === gameId)
      .sort((a, b) => a.seat_position - b.seat_position)
      .map(gp => {
        const p = store.players.find(pl => pl.player_id === gp.player_id);
        return {
          player_id: gp.player_id,
          seat_position: gp.seat_position,
          card_count: gp.card_count,
          has_called_uno: gp.has_called_uno,
          is_active: gp.is_active,
          display_name: p ? p.display_name : 'Unknown',
          username: p ? p.username : ''
        };
      });

    const hand = this.getPlayerHand(gameId, playerId);
    const drawPileCount = store.drawPile.filter(d => d.game_id === gameId).length;

    return {
      gameId: game.game_id,
      roomCode: game.room_code,
      status: game.status,
      currentTurnPlayerId: game.current_turn_player_id,
      direction: game.direction,
      currentColor: game.current_color,
      currentValue: game.current_value,
      topCard: { color: game.current_color, value: game.current_value },
      players: gamePlayers,
      myHand: hand,
      drawPileCount,
      winnerId: game.winner_player_id
    };
  }

  /**
   * Get player count for a game
   */
  getPlayerCount(gameId) {
    const store = getStore();
    return store.gamePlayers.filter(gp => gp.game_id === gameId && gp.is_active).length;
  }

  /**
   * Get game by room code
   */
  getGameByRoomCode(roomCode) {
    const store = getStore();
    return store.games.find(g => g.room_code === roomCode) || null;
  }

  /**
   * Get lobby players
   */
  getLobbyPlayers(gameId) {
    const store = getStore();
    return store.gamePlayers
      .filter(gp => gp.game_id === gameId)
      .sort((a, b) => a.seat_position - b.seat_position)
      .map(gp => {
        const p = store.players.find(pl => pl.player_id === gp.player_id);
        return {
          player_id: gp.player_id,
          seat_position: gp.seat_position,
          display_name: p ? p.display_name : 'Unknown',
          username: p ? p.username : ''
        };
      });
  }

  /**
   * Generate a random 6-character room code
   */
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}

module.exports = new GameManager();
