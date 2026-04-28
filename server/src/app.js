// Express app without Socket.IO — used by both Netlify Functions and local dev
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const lobbyRoutes = require('./routes/lobby');
const gameRoutes = require('./routes/game');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/lobby', lobbyRoutes);
app.use('/api/game', gameRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'UNO Game Server is running' });
});

module.exports = app;
