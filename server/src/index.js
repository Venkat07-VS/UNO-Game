require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./routes/auth');
const lobbyRoutes = require('./routes/lobby');
const gameRoutes = require('./routes/game');
const setupSocketHandlers = require('./sockets/gameSocket');

const app = express();
const server = http.createServer(app);

const allowedOrigins = process.env.CLIENT_URL
  ? ['http://localhost:3000', process.env.CLIENT_URL]
  : '*';

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Make io accessible to routes for broadcasting
app.set('io', io);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/lobby', lobbyRoutes);
app.use('/api/game', gameRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'UNO Game Server is running' });
});

// Serve React build in production
const clientBuildPath = path.join(__dirname, '../../client/build');
app.use(express.static(clientBuildPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return next();
  }
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

// Socket.IO
setupSocketHandlers(io);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`UNO Game Server running on port ${PORT} (in-memory storage)`);
});
