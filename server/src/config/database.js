// In-memory data store (replaces MSSQL database)

const store = {
  players: [],
  games: [],
  gamePlayers: [],
  playerHands: [],
  drawPile: [],
  discardPile: [],
  chatMessages: [],
  _nextId: {
    player: 1,
    game: 1,
    gamePlayer: 1,
    playerHand: 1,
    drawPile: 1,
    discardPile: 1
  }
};

function getStore() {
  return store;
}

function nextId(type) {
  return store._nextId[type]++;
}

module.exports = { getStore, nextId };
