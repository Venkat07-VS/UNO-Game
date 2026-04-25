// UNO Card Deck Generator
const COLORS = ['red', 'blue', 'green', 'yellow'];
const NUMBER_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const ACTION_VALUES = ['skip', 'reverse', 'draw2'];
const WILD_VALUES = ['wild', 'wild_draw4'];

function createDeck() {
  const deck = [];

  // For each color: one 0, two of each 1-9, two of each action card
  for (const color of COLORS) {
    // One zero card per color
    deck.push({ color, value: '0' });

    // Two of each number 1-9
    for (let i = 0; i < 2; i++) {
      for (const val of NUMBER_VALUES.slice(1)) {
        deck.push({ color, value: val });
      }
      // Two of each action card
      for (const action of ACTION_VALUES) {
        deck.push({ color, value: action });
      }
    }
  }

  // 4 Wild cards and 4 Wild Draw 4 cards
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'wild', value: 'wild' });
    deck.push({ color: 'wild', value: 'wild_draw4' });
  }

  return deck; // 108 cards total
}

function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

module.exports = { createDeck, shuffleDeck, COLORS, NUMBER_VALUES, ACTION_VALUES, WILD_VALUES };
