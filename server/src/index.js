require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { connectDB } = require('./config/database');
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

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    await connectDB();
    console.log('Database connected successfully');
    server.listen(PORT, () => {
      console.log(`UNO Game Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
