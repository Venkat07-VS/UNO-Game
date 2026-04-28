import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getPlayer } from '../utils/auth';
import {
  getGameState as fetchGameState,
  playCard as apiPlayCard,
  drawCard as apiDrawCard,
  callUno as apiCallUno,
  challengeUno as apiChallengeUno,
  sendChat as apiSendChat,
  getMessages as apiGetMessages
} from '../utils/api';
import Card from './Card';
import ColorPicker from './ColorPicker';
import './GameBoard.css';

function GameBoard() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const player = getPlayer();

  const [gameState, setGameState] = useState(null);
  const [myHand, setMyHand] = useState([]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [pendingWildCard, setPendingWildCard] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [notification, setNotification] = useState('');
  const [gameOver, setGameOver] = useState(null);
  const [canPlayDrawnCard, setCanPlayDrawnCard] = useState(false);
  const [drawnCard, setDrawnCard] = useState(null);
  const [unoCallPopup, setUnoCallPopup] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const lastMessageTimestamp = useRef('');
  const skipNextPoll = useRef(false);

  const showNotification = useCallback((msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 3000);
  }, []);

  // Apply game state from API response
  const applyGameState = useCallback((data) => {
    if (!data) return;
    setGameState({
      gameId: data.gameId,
      roomCode: data.roomCode,
      status: data.status,
      currentTurnPlayerId: data.currentTurnPlayerId,
      direction: data.direction,
      currentColor: data.currentColor,
      currentValue: data.currentValue,
      topCard: data.topCard,
      players: data.players,
      drawPileCount: data.drawPileCount
    });
    if (data.myHand) {
      setMyHand(data.myHand);
    }
    if (data.winnerId) {
      const winner = data.players?.find(p => p.player_id === data.winnerId);
      setGameOver({
        winnerId: data.winnerId,
        winnerName: winner?.display_name || 'Unknown',
        isMe: data.winnerId === player?.playerId
      });
    }
  }, [player?.playerId]);

  // Poll game state via HTTP
  const pollGameState = useCallback(async () => {
    if (skipNextPoll.current) {
      skipNextPoll.current = false;
      return;
    }
    try {
      const res = await fetchGameState(parseInt(gameId));
      applyGameState(res.data);
    } catch (err) {
      console.error('Poll game state error:', err);
    }
  }, [gameId, applyGameState]);

  // Poll chat messages
  const pollMessages = useCallback(async () => {
    try {
      const res = await apiGetMessages(parseInt(gameId), lastMessageTimestamp.current);
      if (res.data.length > 0) {
        setMessages(prev => {
          const newMsgs = [...prev, ...res.data].slice(-50);
          return newMsgs;
        });
        lastMessageTimestamp.current = res.data[res.data.length - 1].timestamp;
        setUnreadCount(prev => prev + res.data.length);
      }
    } catch (err) {
      // Chat polling failure is non-critical
    }
  }, [gameId]);

  useEffect(() => {
    // Load initial state
    if (location.state?.gameState) {
      const { gameState: gs, myHand: hand } = location.state;
      applyGameState(gs);
      if (hand) setMyHand(hand);
    } else {
      pollGameState();
    }

    // Poll for game state updates every 1.5 seconds
    const stateInterval = setInterval(pollGameState, 1500);
    // Poll for chat messages every 3 seconds
    const chatInterval = setInterval(pollMessages, 3000);

    return () => {
      clearInterval(stateInterval);
      clearInterval(chatInterval);
    };
  }, [gameId, pollGameState, pollMessages, location.state, applyGameState]);

  const isMyTurn = gameState?.currentTurnPlayerId === player?.playerId;

  const canPlayCard = (card) => {
    if (!gameState) return false;

    // After drawing a card, only the drawn card is playable
    if (canPlayDrawnCard && drawnCard) {
      return card.color === drawnCard.color && card.value === drawnCard.value;
    }

    if (!isMyTurn) return false;
    if (card.color === 'wild') return true;
    if (card.color === gameState.currentColor) return true;
    if (card.value === gameState.currentValue) return true;
    return false;
  };

  const handlePlayCard = async (card) => {
    if (!isMyTurn && !canPlayDrawnCard) return;

    // If wild card, show color picker
    if (card.color === 'wild') {
      setPendingWildCard(card);
      setShowColorPicker(true);
      return;
    }

    try {
      skipNextPoll.current = true;
      const res = await apiPlayCard(parseInt(gameId), card.color, card.value);
      if (res.data.gameState) applyGameState(res.data.gameState);
      if (res.data.result?.gameOver) {
        setGameOver({
          winnerId: res.data.result.winnerId,
          winnerName: res.data.result.winnerName || 'Unknown',
          score: res.data.result.score,
          isMe: res.data.result.winnerId === player?.playerId
        });
      }
    } catch (err) {
      showNotification(err.response?.data?.error || 'Failed to play card');
    }
    setCanPlayDrawnCard(false);
    setDrawnCard(null);
  };

  const handleColorSelect = async (color) => {
    if (!pendingWildCard) return;

    try {
      skipNextPoll.current = true;
      const res = await apiPlayCard(parseInt(gameId), pendingWildCard.color, pendingWildCard.value, color);
      if (res.data.gameState) applyGameState(res.data.gameState);
      if (res.data.result?.gameOver) {
        setGameOver({
          winnerId: res.data.result.winnerId,
          winnerName: res.data.result.winnerName || 'Unknown',
          score: res.data.result.score,
          isMe: res.data.result.winnerId === player?.playerId
        });
      }
    } catch (err) {
      showNotification(err.response?.data?.error || 'Failed to play card');
    }
    setShowColorPicker(false);
    setPendingWildCard(null);
    setCanPlayDrawnCard(false);
    setDrawnCard(null);
  };

  const handleDrawCard = async () => {
    if (!isMyTurn) return;

    try {
      skipNextPoll.current = true;
      const res = await apiDrawCard(parseInt(gameId));
      const data = res.data;

      if (data.canPlay) {
        setCanPlayDrawnCard(true);
        setDrawnCard(data.drawnCard);
        showNotification('You drew a card! You can play it.');
      } else {
        setCanPlayDrawnCard(false);
        setDrawnCard(null);
        showNotification('You drew a card. Turn passed.');
      }

      if (data.gameState) applyGameState(data.gameState);
    } catch (err) {
      showNotification(err.response?.data?.error || 'Failed to draw card');
    }
  };

  const handleCallUno = async () => {
    try {
      await apiCallUno(parseInt(gameId));
      setUnoCallPopup(player?.displayName || 'You');
      setTimeout(() => setUnoCallPopup(null), 2500);
    } catch (err) {
      showNotification(err.response?.data?.error || 'Failed to call UNO');
    }
  };

  const handleChallengeUno = async (challengedPlayerId) => {
    try {
      const res = await apiChallengeUno(parseInt(gameId), challengedPlayerId);
      showNotification(`UNO challenge! Player draws ${res.data.penaltyCards} penalty cards`);
      if (res.data.gameState) applyGameState(res.data.gameState);
    } catch (err) {
      showNotification(err.response?.data?.error || 'Invalid challenge');
    }
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    try {
      await apiSendChat(parseInt(gameId), chatInput);
      setChatInput('');
    } catch (err) {
      showNotification('Failed to send message');
    }
  };

  if (!gameState) {
    return <div className="game-loading">Loading game...</div>;
  }

  const otherPlayers = gameState.players?.filter(p => p.player_id !== player.playerId) || [];
  const currentPlayer = gameState.players?.find(p => p.player_id === gameState.currentTurnPlayerId);

  const COLOR_HEX = { red: '#e74c3c', blue: '#3498db', green: '#2ecc71', yellow: '#f1c40f' };

  return (
    <div className="game-board">
      {/* Notification */}
      {notification && <div className="game-notification">{notification}</div>}

      {/* UNO Call Popup */}
      {unoCallPopup && (
        <div className="uno-call-overlay">
          <div className="uno-call-popup">
            <div className="uno-call-text">V-UNO!</div>
            <div className="uno-call-player">{unoCallPopup}</div>
          </div>
        </div>
      )}

      {/* Game Over Modal */}
      {gameOver && (
        <div className="game-over-overlay">
          <div className="game-over-modal">
            {gameOver.isMe && <div className="confetti-container">
              {Array.from({ length: 50 }).map((_, i) => (
                <div key={i} className="confetti" style={{
                  left: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 2}s`,
                  backgroundColor: ['#e74c3c','#3498db','#2ecc71','#f1c40f','#9b59b6','#f39c12'][i % 6]
                }} />
              ))}
            </div>}
            <h2>{gameOver.isMe ? '🎉 YOU WON!' : '😔 Game Over'}</h2>
            <div className="winner-trophy">{gameOver.isMe ? '🏆' : ''}</div>
            <p className="winner-name">{gameOver.winnerName} wins!</p>
            {gameOver.score > 0 && <p className="winner-score">Score: +{gameOver.score} points</p>}
            <button onClick={() => navigate('/dashboard')} className="back-to-dashboard">
              Back to Dashboard
            </button>
          </div>
        </div>
      )}

      {/* Color Picker */}
      {showColorPicker && <ColorPicker onColorSelect={handleColorSelect} />}

      {/* Header */}
      <div className="game-header">
        <div className="game-info">
          <span className="room-code">Room: {gameState.roomCode}</span>
          <span className="direction">
            Direction: {gameState.direction === 1 ? '→ Clockwise' : '← Counter-clockwise'}
          </span>
          <button onClick={() => navigate('/dashboard')} className="header-back-btn">
            ← Dashboard
          </button>
        </div>
        <div className="turn-info" style={{ borderColor: COLOR_HEX[gameState.currentColor] || '#fff' }}>
          <span>Current Color: </span>
          <span className="current-color" style={{ 
            backgroundColor: COLOR_HEX[gameState.currentColor],
            padding: '2px 12px',
            borderRadius: '4px',
            color: gameState.currentColor === 'yellow' ? '#000' : '#fff'
          }}>
            {gameState.currentColor?.toUpperCase()}
          </span>
          <span className="turn-indicator">
            {isMyTurn ? "🎯 YOUR TURN" : `${currentPlayer?.display_name}'s turn`}
          </span>
        </div>
      </div>

      {/* Other Players */}
      <div className="other-players">
        {otherPlayers.map((p) => (
          <div
            key={p.player_id}
            className={`other-player ${p.player_id === gameState.currentTurnPlayerId ? 'active-player' : ''}`}
          >
            <div className="player-avatar">{p.display_name?.charAt(0).toUpperCase()}</div>
            <span className="player-name">{p.display_name}</span>
            <span className="card-count">{p.card_count} cards</span>
            {p.card_count === 1 && !p.has_called_uno && (
              <button
                className="challenge-btn"
                onClick={() => handleChallengeUno(p.player_id)}
              >
                Challenge UNO!
              </button>
            )}
            {p.has_called_uno && <span className="uno-badge">UNO!</span>}
          </div>
        ))}
      </div>

      {/* Table Center - Discard & Draw Piles */}
      <div className="table-center">
        <div className="draw-pile" onClick={isMyTurn ? handleDrawCard : undefined}>
          <Card faceDown />
          <span className="pile-label">Draw ({gameState.drawPileCount || '?'})</span>
        </div>
        <div className="discard-pile">
          <Card
            color={gameState.currentColor || gameState.topCard?.color}
            value={gameState.currentValue || gameState.topCard?.value}
          />
          <span className="pile-label">Discard</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="action-buttons">
        {isMyTurn && (
          <button onClick={handleDrawCard} className="draw-btn">
            Draw Card
          </button>
        )}
        {myHand.length <= 2 && (
          <button onClick={handleCallUno} className="uno-btn">
            UNO!
          </button>
        )}
      </div>

      {/* My Hand */}
      <div className="my-hand">
        <h3>Your Cards ({myHand.length})</h3>
        <div className="hand-cards">
          {myHand.map((card, index) => (
            <Card
              key={`${card.color}-${card.value}-${index}`}
              color={card.color}
              value={card.value}
              onClick={handlePlayCard}
              disabled={!canPlayCard(card)}
            />
          ))}
        </div>
      </div>

      {/* Chat Toggle Icon */}
      <button className="chat-toggle-btn" onClick={() => { setChatOpen(prev => !prev); setUnreadCount(0); }}>
        💬
        {unreadCount > 0 && !chatOpen && <span className="chat-badge">{unreadCount}</span>}
      </button>

      {/* Chat Panel */}
      {chatOpen && (
        <div className="game-chat">
          <div className="chat-header">
            <span>Chat</span>
            <button className="chat-close-btn" onClick={() => setChatOpen(false)}>✕</button>
          </div>
          <div className="chat-messages">
            {messages.map((msg, i) => (
              <div key={i} className="chat-msg">
                <strong>{msg.displayName}:</strong> {msg.message}
              </div>
            ))}
          </div>
          <form onSubmit={handleSendChat} className="chat-input">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Type a message..."
              maxLength={200}
            />
            <button type="submit">Send</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default GameBoard;
