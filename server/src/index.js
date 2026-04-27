require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./routes/auth');
const lobbyRoutes = require('./routes/lobby');
const setupSocketHandlers = require('./sockets/gameSocket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Make io accessible to routes for broadcasting
app.set('io', io);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/lobby', lobbyRoutes);

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
