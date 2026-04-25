const { getPool, sql } = require('../config/database');
const { createDeck, shuffleDeck } = require('./deck');
const { isValidPlay, hasValidPlay, getNextPlayerIndex, calculateScore, getCardEffect } = require('./rules');

class GameManager {
  constructor() {
    // In-memory game states for active games (for speed)
    this.activeGames = new Map();
  }

  /**
   * Create a new game room
   */
  async createGame(hostPlayerId, maxPlayers = 4) {
    const pool = getPool();
    const roomCode = this.generateRoomCode();

    const result = await pool.request()
      .input('roomCode', sql.NVarChar, roomCode)
      .input('hostPlayerId', sql.Int, hostPlayerId)
      .input('maxPlayers', sql.Int, maxPlayers)
      .query(`
        INSERT INTO UNO_Games (room_code, host_player_id, max_players, status)
        OUTPUT INSERTED.game_id, INSERTED.room_code
        VALUES (@roomCode, @hostPlayerId, @maxPlayers, 'waiting')
      `);

    const game = result.recordset[0];

    // Host joins the game automatically
    await this.joinGame(game.game_id, hostPlayerId);

    return { gameId: game.game_id, roomCode: game.room_code };
  }

  /**
   * Join an existing game
   */
  async joinGame(gameId, playerId) {
    const pool = getPool();

    // Check game exists and has room
    const gameResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`SELECT * FROM UNO_Games WHERE game_id = @gameId AND status = 'waiting'`);

    if (gameResult.recordset.length === 0) {
      throw new Error('Game not found or already started');
    }

    const game = gameResult.recordset[0];

    // Count current players
    const countResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`SELECT COUNT(*) as count FROM UNO_GamePlayers WHERE game_id = @gameId`);

    const currentCount = countResult.recordset[0].count;
    if (currentCount >= game.max_players) {
      throw new Error('Game is full');
    }

    // Check if already joined
    const existingResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('playerId', sql.Int, playerId)
      .query(`SELECT * FROM UNO_GamePlayers WHERE game_id = @gameId AND player_id = @playerId`);

    if (existingResult.recordset.length > 0) {
      return { alreadyJoined: true };
    }

    // Add player to game
    await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('playerId', sql.Int, playerId)
      .input('seatPosition', sql.Int, currentCount)
      .query(`
        INSERT INTO UNO_GamePlayers (game_id, player_id, seat_position)
        VALUES (@gameId, @playerId, @seatPosition)
      `);

    return { seatPosition: currentCount, playerCount: currentCount + 1 };
  }

  /**
   * Start a game - deal cards, set up piles
   */
  async startGame(gameId, hostPlayerId) {
    const pool = getPool();

    // Verify host
    const gameResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`SELECT * FROM UNO_Games WHERE game_id = @gameId AND status = 'waiting'`);

    if (gameResult.recordset.length === 0) {
      throw new Error('Game not found or already started');
    }

    const game = gameResult.recordset[0];
    if (game.host_player_id !== hostPlayerId) {
      throw new Error('Only the host can start the game');
    }

    // Get players
    const playersResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`
        SELECT gp.*, p.display_name, p.username 
        FROM UNO_GamePlayers gp 
        JOIN UNO_Players p ON gp.player_id = p.player_id 
        WHERE gp.game_id = @gameId 
        ORDER BY gp.seat_position
      `);

    const players = playersResult.recordset;
    if (players.length < 2) {
      throw new Error('Need at least 2 players to start');
    }

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
      }
    }

    // Find a valid starting card (not a wild draw 4)
    let startCardIndex = deck.length - 1;
    while (deck[startCardIndex].value === 'wild_draw4') {
      startCardIndex--;
    }
    const startCard = deck.splice(startCardIndex, 1)[0];

    // If start card is wild, assign a random color
    let currentColor = startCard.color;
    if (startCard.color === 'wild') {
      const colors = ['red', 'blue', 'green', 'yellow'];
      currentColor = colors[Math.floor(Math.random() * 4)];
    }

    // Save hands to database
    for (const player of players) {
      const hand = playerHands[player.player_id];
      for (let i = 0; i < hand.length; i++) {
        await pool.request()
          .input('gameId', sql.Int, gameId)
          .input('playerId', sql.Int, player.player_id)
          .input('cardColor', sql.NVarChar, hand[i].color)
          .input('cardValue', sql.NVarChar, hand[i].value)
          .input('cardOrder', sql.Int, i)
          .query(`
            INSERT INTO UNO_PlayerHands (game_id, player_id, card_color, card_value, card_order)
            VALUES (@gameId, @playerId, @cardColor, @cardValue, @cardOrder)
          `);
      }

      // Update card count
      await pool.request()
        .input('gameId', sql.Int, gameId)
        .input('playerId', sql.Int, player.player_id)
        .input('count', sql.Int, CARDS_PER_PLAYER)
        .query(`
          UPDATE UNO_GamePlayers SET card_count = @count 
          WHERE game_id = @gameId AND player_id = @playerId
        `);
    }

    // Save draw pile
    for (let i = 0; i < deck.length; i++) {
      await pool.request()
        .input('gameId', sql.Int, gameId)
        .input('cardColor', sql.NVarChar, deck[i].color)
        .input('cardValue', sql.NVarChar, deck[i].value)
        .input('pileOrder', sql.Int, i)
        .query(`
          INSERT INTO UNO_DrawPile (game_id, card_color, card_value, pile_order)
          VALUES (@gameId, @cardColor, @cardValue, @pileOrder)
        `);
    }

    // Save starting discard card
    await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('cardColor', sql.NVarChar, startCard.color)
      .input('cardValue', sql.NVarChar, startCard.value)
      .input('pileOrder', sql.Int, 0)
      .query(`
        INSERT INTO UNO_DiscardPile (game_id, card_color, card_value, pile_order)
        VALUES (@gameId, @cardColor, @cardValue, @pileOrder)
      `);

    // Determine first player and handle start card effects
    let direction = 1;
    let firstPlayerIndex = 0;
    const effect = getCardEffect(startCard);

    if (effect.type === 'reverse' && players.length > 2) {
      direction = -1;
    } else if (effect.type === 'skip') {
      firstPlayerIndex = 1;
    }

    const firstPlayer = players[firstPlayerIndex];

    // Update game status
    await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('currentTurn', sql.Int, firstPlayer.player_id)
      .input('direction', sql.Int, direction)
      .input('currentColor', sql.NVarChar, currentColor)
      .input('currentValue', sql.NVarChar, startCard.value)
      .query(`
        UPDATE UNO_Games 
        SET status = 'playing', 
            current_turn_player_id = @currentTurn, 
            direction = @direction,
            current_color = @currentColor,
            current_value = @currentValue,
            started_at = GETDATE()
        WHERE game_id = @gameId
      `);

    // Build in-memory game state
    const gameState = {
      gameId,
      players: players.map(p => ({
        playerId: p.player_id,
        displayName: p.display_name,
        seatPosition: p.seat_position,
        cardCount: CARDS_PER_PLAYER,
        hasCalledUno: false
      })),
      currentTurnPlayerId: firstPlayer.player_id,
      direction,
      currentColor,
      currentValue: startCard.value,
      topCard: startCard,
      playerHands
    };

    this.activeGames.set(gameId, gameState);

    // Log game start
    await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('actionType', sql.NVarChar, 'game_start')
      .input('description', sql.NVarChar, 'Game started')
      .query(`
        INSERT INTO UNO_GameLog (game_id, action_type, description)
        VALUES (@gameId, @actionType, @description)
      `);

    // If start card is Draw 2, first player must draw
    let pendingDraw = 0;
    if (effect.type === 'draw') {
      pendingDraw = effect.count;
    }

    return {
      gameState: {
        gameId,
        players: gameState.players,
        currentTurnPlayerId: gameState.currentTurnPlayerId,
        direction: gameState.direction,
        currentColor: gameState.currentColor,
        currentValue: gameState.currentValue,
        topCard: startCard
      },
      playerHands,
      pendingDraw
    };
  }

  /**
   * Play a card
   */
  async playCard(gameId, playerId, cardColor, cardValue, chosenColor = null) {
    const pool = getPool();

    // Get current game state
    const gameResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`SELECT * FROM UNO_Games WHERE game_id = @gameId AND status = 'playing'`);

    if (gameResult.recordset.length === 0) {
      throw new Error('Game not found or not in progress');
    }

    const game = gameResult.recordset[0];

    // Verify it's this player's turn
    if (game.current_turn_player_id !== playerId) {
      throw new Error("It's not your turn");
    }

    const card = { color: cardColor, value: cardValue };
    const topCard = { color: game.current_color, value: game.current_value };

    // Validate the play
    if (!isValidPlay(card, topCard, game.current_color)) {
      throw new Error('Invalid card play');
    }

    // Verify player has this card
    const handResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('playerId', sql.Int, playerId)
      .input('cardColor', sql.NVarChar, cardColor)
      .input('cardValue', sql.NVarChar, cardValue)
      .query(`
        SELECT TOP 1 id FROM UNO_PlayerHands 
        WHERE game_id = @gameId AND player_id = @playerId 
        AND card_color = @cardColor AND card_value = @cardValue
      `);

    if (handResult.recordset.length === 0) {
      throw new Error("You don't have this card");
    }

    const cardId = handResult.recordset[0].id;

    // Remove card from hand
    await pool.request()
      .input('id', sql.Int, cardId)
      .query(`DELETE FROM UNO_PlayerHands WHERE id = @id`);

    // Add to discard pile
    const discardCountResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`SELECT ISNULL(MAX(pile_order), 0) + 1 as nextOrder FROM UNO_DiscardPile WHERE game_id = @gameId`);

    const nextOrder = discardCountResult.recordset[0].nextOrder;

    await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('cardColor', sql.NVarChar, cardColor)
      .input('cardValue', sql.NVarChar, cardValue)
      .input('playerId', sql.Int, playerId)
      .input('pileOrder', sql.Int, nextOrder)
      .query(`
        INSERT INTO UNO_DiscardPile (game_id, card_color, card_value, played_by_player_id, pile_order)
        VALUES (@gameId, @cardColor, @cardValue, @playerId, @pileOrder)
      `);

    // Update card count
    await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('playerId', sql.Int, playerId)
      .query(`
        UPDATE UNO_GamePlayers 
        SET card_count = card_count - 1 
        WHERE game_id = @gameId AND player_id = @playerId
      `);

    // Check remaining cards
    const remainingResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('playerId', sql.Int, playerId)
      .query(`SELECT COUNT(*) as count FROM UNO_PlayerHands WHERE game_id = @gameId AND player_id = @playerId`);

    const remainingCards = remainingResult.recordset[0].count;

    // Check for win
    if (remainingCards === 0) {
      return await this.handleWin(gameId, playerId, game);
    }

    // Process card effects
    const effect = getCardEffect(card);
    let newDirection = game.direction;
    let newColor = cardColor === 'wild' ? chosenColor : cardColor;
    let drawCount = 0;
    let skipNext = false;

    if (effect.type === 'reverse') {
      newDirection = game.direction * -1;
      if (await this.getPlayerCount(gameId) === 2) {
        skipNext = true; // In 2-player game, reverse acts like skip
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

    // Get players and determine next turn
    const playersResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`
        SELECT player_id, seat_position FROM UNO_GamePlayers 
        WHERE game_id = @gameId AND is_active = 1 
        ORDER BY seat_position
      `);

    const players = playersResult.recordset;
    const currentPlayerIndex = players.findIndex(p => p.player_id === playerId);
    const playerCount = players.length;

    let nextPlayerIndex = getNextPlayerIndex(currentPlayerIndex, playerCount, newDirection, skipNext);
    const nextPlayerId = players[nextPlayerIndex].player_id;

    // If next player needs to draw cards
    if (drawCount > 0) {
      const skippedPlayerIndex = getNextPlayerIndex(currentPlayerIndex, playerCount, newDirection, false);
      const drawPlayerId = players[skippedPlayerIndex].player_id;
      await this.drawCards(gameId, drawPlayerId, drawCount);
    }

    // Update game state
    await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('currentTurn', sql.Int, nextPlayerId)
      .input('direction', sql.Int, newDirection)
      .input('currentColor', sql.NVarChar, newColor)
      .input('currentValue', sql.NVarChar, cardValue)
      .query(`
        UPDATE UNO_Games 
        SET current_turn_player_id = @currentTurn,
            direction = @direction,
            current_color = @currentColor,
            current_value = @currentValue
        WHERE game_id = @gameId
      `);

    // Log the play
    await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('playerId', sql.Int, playerId)
      .input('actionType', sql.NVarChar, 'play_card')
      .input('cardColor', sql.NVarChar, cardColor)
      .input('cardValue', sql.NVarChar, cardValue)
      .input('description', sql.NVarChar, `Played ${cardColor} ${cardValue}`)
      .query(`
        INSERT INTO UNO_GameLog (game_id, player_id, action_type, card_color, card_value, description)
        VALUES (@gameId, @playerId, @actionType, @cardColor, @cardValue, @description)
      `);

    // Reset UNO call for this player (they played a card)
    await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('playerId', sql.Int, playerId)
      .query(`UPDATE UNO_GamePlayers SET has_called_uno = 0 WHERE game_id = @gameId AND player_id = @playerId`);

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
  async drawCard(gameId, playerId) {
    const pool = getPool();

    // Verify it's this player's turn
    const gameResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`SELECT * FROM UNO_Games WHERE game_id = @gameId AND status = 'playing'`);

    if (gameResult.recordset.length === 0) {
      throw new Error('Game not found');
    }

    const game = gameResult.recordset[0];
    if (game.current_turn_player_id !== playerId) {
      throw new Error("It's not your turn");
    }

    const drawnCards = await this.drawCards(gameId, playerId, 1);

    // Check if drawn card can be played
    const drawnCard = drawnCards[0];
    const topCard = { color: game.current_color, value: game.current_value };
    const canPlay = isValidPlay(drawnCard, topCard, game.current_color);

    // If can't play, move to next turn
    if (!canPlay) {
      const playersResult = await pool.request()
        .input('gameId', sql.Int, gameId)
        .query(`
          SELECT player_id, seat_position FROM UNO_GamePlayers 
          WHERE game_id = @gameId AND is_active = 1 
          ORDER BY seat_position
        `);

      const players = playersResult.recordset;
      const currentIndex = players.findIndex(p => p.player_id === playerId);
      const nextIndex = getNextPlayerIndex(currentIndex, players.length, game.direction);
      const nextPlayerId = players[nextIndex].player_id;

      await pool.request()
        .input('gameId', sql.Int, gameId)
        .input('nextPlayerId', sql.Int, nextPlayerId)
        .query(`UPDATE UNO_Games SET current_turn_player_id = @nextPlayerId WHERE game_id = @gameId`);

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
  async drawCards(gameId, playerId, count) {
    const pool = getPool();
    const drawnCards = [];

    for (let i = 0; i < count; i++) {
      // Get top card from draw pile
      const drawResult = await pool.request()
        .input('gameId', sql.Int, gameId)
        .query(`
          SELECT TOP 1 id, card_color, card_value 
          FROM UNO_DrawPile 
          WHERE game_id = @gameId 
          ORDER BY pile_order DESC
        `);

      if (drawResult.recordset.length === 0) {
        // Reshuffle discard pile into draw pile
        await this.reshuffleDiscardPile(gameId);
        const retryResult = await pool.request()
          .input('gameId', sql.Int, gameId)
          .query(`
            SELECT TOP 1 id, card_color, card_value 
            FROM UNO_DrawPile 
            WHERE game_id = @gameId 
            ORDER BY pile_order DESC
          `);
        if (retryResult.recordset.length === 0) {
          break; // No cards available
        }
        drawResult.recordset = retryResult.recordset;
      }

      const card = drawResult.recordset[0];

      // Remove from draw pile
      await pool.request()
        .input('id', sql.Int, card.id)
        .query(`DELETE FROM UNO_DrawPile WHERE id = @id`);

      // Add to player's hand
      await pool.request()
        .input('gameId', sql.Int, gameId)
        .input('playerId', sql.Int, playerId)
        .input('cardColor', sql.NVarChar, card.card_color)
        .input('cardValue', sql.NVarChar, card.card_value)
        .input('cardOrder', sql.Int, 0)
        .query(`
          INSERT INTO UNO_PlayerHands (game_id, player_id, card_color, card_value, card_order)
          VALUES (@gameId, @playerId, @cardColor, @cardValue, @cardOrder)
        `);

      drawnCards.push({ color: card.card_color, value: card.card_value });
    }

    // Update card count
    await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('playerId', sql.Int, playerId)
      .input('count', sql.Int, count)
      .query(`
        UPDATE UNO_GamePlayers 
        SET card_count = card_count + @count 
        WHERE game_id = @gameId AND player_id = @playerId
      `);

    return drawnCards;
  }

  /**
   * Call UNO
   */
  async callUno(gameId, playerId) {
    const pool = getPool();

    const countResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('playerId', sql.Int, playerId)
      .query(`SELECT COUNT(*) as count FROM UNO_PlayerHands WHERE game_id = @gameId AND player_id = @playerId`);

    if (countResult.recordset[0].count > 2) {
      throw new Error('You can only call UNO when you have 2 or fewer cards');
    }

    await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('playerId', sql.Int, playerId)
      .query(`UPDATE UNO_GamePlayers SET has_called_uno = 1 WHERE game_id = @gameId AND player_id = @playerId`);

    return { success: true };
  }

  /**
   * Challenge a player who didn't call UNO (they draw 2 penalty cards)
   */
  async challengeUno(gameId, challengedPlayerId) {
    const pool = getPool();

    const playerResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('playerId', sql.Int, challengedPlayerId)
      .query(`
        SELECT gp.*, 
          (SELECT COUNT(*) FROM UNO_PlayerHands WHERE game_id = @gameId AND player_id = @playerId) as hand_count
        FROM UNO_GamePlayers gp 
        WHERE gp.game_id = @gameId AND gp.player_id = @playerId
      `);

    const player = playerResult.recordset[0];

    if (player.hand_count !== 1 || player.has_called_uno === true) {
      throw new Error('Invalid UNO challenge');
    }

    // Penalty: draw 2 cards
    await this.drawCards(gameId, challengedPlayerId, 2);

    return { success: true, penaltyCards: 2 };
  }

  /**
   * Handle a win
   */
  async handleWin(gameId, winnerId, game) {
    const pool = getPool();

    // Calculate score from remaining players' cards
    const handsResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('winnerId', sql.Int, winnerId)
      .query(`
        SELECT card_color as color, card_value as value 
        FROM UNO_PlayerHands 
        WHERE game_id = @gameId AND player_id != @winnerId
      `);

    const score = calculateScore(handsResult.recordset);

    // Update game
    await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('winnerId', sql.Int, winnerId)
      .query(`
        UPDATE UNO_Games 
        SET status = 'finished', winner_player_id = @winnerId, ended_at = GETDATE()
        WHERE game_id = @gameId
      `);

    // Update player stats
    await pool.request()
      .input('winnerId', sql.Int, winnerId)
      .input('score', sql.Int, score)
      .query(`
        UPDATE UNO_Players 
        SET games_won = games_won + 1, games_played = games_played + 1, total_score = total_score + @score
        WHERE player_id = @winnerId
      `);

    // Update all other players' games_played
    const playersResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('winnerId', sql.Int, winnerId)
      .query(`SELECT player_id FROM UNO_GamePlayers WHERE game_id = @gameId AND player_id != @winnerId`);

    for (const p of playersResult.recordset) {
      await pool.request()
        .input('playerId', sql.Int, p.player_id)
        .query(`UPDATE UNO_Players SET games_played = games_played + 1 WHERE player_id = @playerId`);
    }

    // Remove from active games
    this.activeGames.delete(gameId);

    return {
      success: true,
      gameOver: true,
      winnerId,
      score
    };
  }

  /**
   * Reshuffle discard pile into draw pile
   */
  async reshuffleDiscardPile(gameId) {
    const pool = getPool();

    // Get all discard pile cards except the top one
    const discardResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`
        SELECT id, card_color, card_value FROM UNO_DiscardPile 
        WHERE game_id = @gameId 
        AND pile_order < (SELECT MAX(pile_order) FROM UNO_DiscardPile WHERE game_id = @gameId)
        ORDER BY pile_order
      `);

    const cards = discardResult.recordset;
    if (cards.length === 0) return;

    // Remove from discard pile
    const idsToRemove = cards.map(c => c.id);
    await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`
        DELETE FROM UNO_DiscardPile 
        WHERE game_id = @gameId 
        AND pile_order < (SELECT MAX(pile_order) FROM UNO_DiscardPile WHERE game_id = @gameId)
      `);

    // Shuffle and add to draw pile
    const shuffled = cards.sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length; i++) {
      await pool.request()
        .input('gameId', sql.Int, gameId)
        .input('cardColor', sql.NVarChar, shuffled[i].card_color)
        .input('cardValue', sql.NVarChar, shuffled[i].card_value)
        .input('pileOrder', sql.Int, i)
        .query(`
          INSERT INTO UNO_DrawPile (game_id, card_color, card_value, pile_order)
          VALUES (@gameId, @cardColor, @cardValue, @pileOrder)
        `);
    }
  }

  /**
   * Get player's hand
   */
  async getPlayerHand(gameId, playerId) {
    const pool = getPool();
    const result = await pool.request()
      .input('gameId', sql.Int, gameId)
      .input('playerId', sql.Int, playerId)
      .query(`
        SELECT card_color as color, card_value as value 
        FROM UNO_PlayerHands 
        WHERE game_id = @gameId AND player_id = @playerId
        ORDER BY card_color, card_value
      `);
    return result.recordset;
  }

  /**
   * Get full game state for a player
   */
  async getGameState(gameId, playerId) {
    const pool = getPool();

    const gameResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`SELECT * FROM UNO_Games WHERE game_id = @gameId`);

    if (gameResult.recordset.length === 0) {
      throw new Error('Game not found');
    }

    const game = gameResult.recordset[0];

    const playersResult = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`
        SELECT gp.player_id, gp.seat_position, gp.card_count, gp.has_called_uno, gp.is_active,
               p.display_name, p.username
        FROM UNO_GamePlayers gp
        JOIN UNO_Players p ON gp.player_id = p.player_id
        WHERE gp.game_id = @gameId
        ORDER BY gp.seat_position
      `);

    const hand = await this.getPlayerHand(gameId, playerId);

    const drawPileCount = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`SELECT COUNT(*) as count FROM UNO_DrawPile WHERE game_id = @gameId`);

    return {
      gameId: game.game_id,
      roomCode: game.room_code,
      status: game.status,
      currentTurnPlayerId: game.current_turn_player_id,
      direction: game.direction,
      currentColor: game.current_color,
      currentValue: game.current_value,
      topCard: { color: game.current_color, value: game.current_value },
      players: playersResult.recordset,
      myHand: hand,
      drawPileCount: drawPileCount.recordset[0].count,
      winnerId: game.winner_player_id
    };
  }

  /**
   * Get player count for a game
   */
  async getPlayerCount(gameId) {
    const pool = getPool();
    const result = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`SELECT COUNT(*) as count FROM UNO_GamePlayers WHERE game_id = @gameId AND is_active = 1`);
    return result.recordset[0].count;
  }

  /**
   * Get game by room code
   */
  async getGameByRoomCode(roomCode) {
    const pool = getPool();
    const result = await pool.request()
      .input('roomCode', sql.NVarChar, roomCode)
      .query(`SELECT * FROM UNO_Games WHERE room_code = @roomCode`);
    return result.recordset[0] || null;
  }

  /**
   * Get lobby players
   */
  async getLobbyPlayers(gameId) {
    const pool = getPool();
    const result = await pool.request()
      .input('gameId', sql.Int, gameId)
      .query(`
        SELECT gp.player_id, gp.seat_position, p.display_name, p.username
        FROM UNO_GamePlayers gp
        JOIN UNO_Players p ON gp.player_id = p.player_id
        WHERE gp.game_id = @gameId
        ORDER BY gp.seat_position
      `);
    return result.recordset;
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
