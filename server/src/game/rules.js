// UNO Game Rules Engine

/**
 * Check if a card can be played on top of the current discard pile card
 */
function isValidPlay(card, topCard, currentColor) {
  // Wild cards can always be played
  if (card.color === 'wild') {
    return true;
  }

  // Match by color (including chosen wild color)
  if (card.color === currentColor) {
    return true;
  }

  // Match by value/number
  if (card.value === topCard.value) {
    return true;
  }

  return false;
}

/**
 * Check if a player has any valid plays
 */
function hasValidPlay(hand, topCard, currentColor) {
  return hand.some(card => isValidPlay(card, topCard, currentColor));
}

/**
 * Get next player index based on direction
 */
function getNextPlayerIndex(currentIndex, playerCount, direction, skip = false) {
  let steps = skip ? 2 : 1;
  let nextIndex = currentIndex + (direction * steps);

  // Wrap around
  while (nextIndex < 0) nextIndex += playerCount;
  nextIndex = nextIndex % playerCount;

  return nextIndex;
}

/**
 * Calculate score for remaining cards in other players' hands
 * Number cards: face value
 * Skip/Reverse/Draw2: 20 points each
 * Wild/Wild Draw 4: 50 points each
 */
function calculateScore(cards) {
  let score = 0;
  for (const card of cards) {
    const numVal = parseInt(card.value);
    if (!isNaN(numVal)) {
      score += numVal;
    } else if (['skip', 'reverse', 'draw2'].includes(card.value)) {
      score += 20;
    } else if (['wild', 'wild_draw4'].includes(card.value)) {
      score += 50;
    }
  }
  return score;
}

/**
 * Determine the effect of an action card
 */
function getCardEffect(card) {
  switch (card.value) {
    case 'skip':
      return { type: 'skip', description: 'Next player is skipped' };
    case 'reverse':
      return { type: 'reverse', description: 'Play direction reversed' };
    case 'draw2':
      return { type: 'draw', count: 2, description: 'Next player draws 2 cards' };
    case 'wild':
      return { type: 'wild', description: 'Player chooses color' };
    case 'wild_draw4':
      return { type: 'wild_draw4', count: 4, description: 'Player chooses color, next player draws 4' };
    default:
      return { type: 'number', description: 'Regular number card' };
  }
}

module.exports = { isValidPlay, hasValidPlay, getNextPlayerIndex, calculateScore, getCardEffect };
