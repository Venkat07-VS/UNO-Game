import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import Lobby from './components/Lobby';
import GameBoard from './components/GameBoard';
import { getToken, removeToken } from './utils/auth';
import './App.css';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!getToken());

  const handleLogin = () => setIsAuthenticated(true);

  const handleLogout = () => {
    removeToken();
    setIsAuthenticated(false);
  };

  return (
    <Router>
      <div className="app">
        <Routes>
          <Route
            path="/login"
            element={
              isAuthenticated ? <Navigate to="/dashboard" /> : <Login onLogin={handleLogin} />
            }
          />
          <Route
            path="/register"
            element={
              isAuthenticated ? <Navigate to="/dashboard" /> : <Register onRegister={handleLogin} />
            }
          />
          <Route
            path="/dashboard"
            element={
              isAuthenticated ? <Dashboard onLogout={handleLogout} /> : <Navigate to="/login" />
            }
          />
          <Route
            path="/lobby/:gameId"
            element={
              isAuthenticated ? <Lobby /> : <Navigate to="/login" />
            }
          />
          <Route
            path="/game/:gameId"
            element={
              isAuthenticated ? <GameBoard /> : <Navigate to="/login" />
            }
          />
          <Route path="*" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
