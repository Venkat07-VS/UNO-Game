const serverless = require('serverless-http');
const express = require('express');
const cors = require('cors');

// Import route handlers from server
const authRoutes = require('../../server/src/routes/auth');
const lobbyRoutes = require('../../server/src/routes/lobby');
const gameRoutes = require('../../server/src/routes/game');

const app = express();
app.use(cors());
app.use(express.json());

// Netlify rewrites /api/* → /.netlify/functions/api/*
// So routes must be mounted at /.netlify/functions/api
const router = express.Router();
router.use('/auth', authRoutes);
router.use('/lobby', lobbyRoutes);
router.use('/game', gameRoutes);
router.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/.netlify/functions/api', router);

module.exports.handler = serverless(app);
