import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getPlayer } from '../utils/auth';
import { getSocket, connectSocket } from '../utils/socket';
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

  const showNotification = useCallback((msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 3000);
  }, []);

  useEffect(() => {
    const socket = connectSocket();
    const gid = parseInt(gameId);

    // If coming from lobby with initial state
    if (location.state) {
      const { gameState: gs, myHand: hand } = location.state;
      setGameState(gs);
      setMyHand(hand);
    } else {
      // Reconnect: request game state
      socket.emit('join_room', { gameId: gid });
      socket.emit('get_game_state', { gameId: gid });
    }

    socket.on('full_game_state', (data) => {
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
      setMyHand(data.myHand);
      if (data.winnerId) {
        const winner = data.players.find(p => p.player_id === data.winnerId);
        setGameOver({ winnerId: data.winnerId, winnerName: winner?.display_name });
      }
    });

    socket.on('game_state_update', (data) => {
      setGameState(prev => prev ? { ...prev, ...data } : null);
    });

    socket.on('hand_update', (data) => {
      setMyHand(data.hand);
    });

    socket.on('card_played', (data) => {
      const playerName = gameState?.players?.find(p => p.player_id === data.playerId)?.display_name || 'A player';
      showNotification(`${playerName} played ${data.card.color} ${data.card.value}`);
    });

    socket.on('card_drawn', (data) => {
      if (data.canPlay) {
        setCanPlayDrawnCard(true);
        setDrawnCard(data.drawnCard);
        showNotification('You drew a card! You can play it.');
      } else {
        setCanPlayDrawnCard(false);
        setDrawnCard(null);
        showNotification('You drew a card. Turn passed.');
      }
    });

    socket.on('player_drew_card', (data) => {
      if (data.playerId !== player.playerId) {
        const playerName = gameState?.players?.find(p => p.player_id === data.playerId)?.display_name || 'A player';
        showNotification(`${playerName} drew a card`);
      }
    });

    socket.on('uno_called', (data) => {
      setUnoCallPopup(data.displayName);
      setTimeout(() => setUnoCallPopup(null), 2500);
    });

    socket.on('uno_challenged', (data) => {
      showNotification(`UNO challenge! Player draws ${data.penaltyCards} penalty cards`);
    });

    socket.on('game_over', (data) => {
      const winner = gameState?.players?.find(p => p.player_id === data.winnerId);
      setGameOver({
        winnerId: data.winnerId,
        winnerName: winner?.display_name || 'Unknown',
        score: data.score,
        isMe: data.winnerId === player?.playerId
      });
    });

    socket.on('chat_message', (data) => {
      setMessages(prev => [...prev.slice(-49), data]);
    });

    socket.on('player_disconnected', (data) => {
      showNotification(`${data.displayName} disconnected`);
    });

    socket.on('error', (data) => {
      showNotification(`Error: ${data.message}`);
    });

    return () => {
      socket.off('full_game_state');
      socket.off('game_state_update');
      socket.off('hand_update');
      socket.off('card_played');
      socket.off('card_drawn');
      socket.off('player_drew_card');
      socket.off('uno_called');
      socket.off('uno_challenged');
      socket.off('game_over');
      socket.off('chat_message');
      socket.off('player_disconnected');
      socket.off('error');
    };
  }, [gameId]);

  const isMyTurn = gameState?.currentTurnPlayerId === player?.playerId;

  const canPlayCard = (card) => {
    if (!isMyTurn || !gameState) return false;
    if (card.color === 'wild') return true;
    if (card.color === gameState.currentColor) return true;
    if (card.value === gameState.currentValue) return true;
    return false;
  };

  const handlePlayCard = (card) => {
    if (!isMyTurn && !canPlayDrawnCard) return;

    // If wild card, show color picker
    if (card.color === 'wild') {
      setPendingWildCard(card);
      setShowColorPicker(true);
      return;
    }

    const socket = getSocket();
    socket.emit('play_card', {
      gameId: parseInt(gameId),
      cardColor: card.color,
      cardValue: card.value
    });
    setCanPlayDrawnCard(false);
    setDrawnCard(null);
  };

  const handleColorSelect = (color) => {
    if (!pendingWildCard) return;

    const socket = getSocket();
    socket.emit('play_card', {
      gameId: parseInt(gameId),
      cardColor: pendingWildCard.color,
      cardValue: pendingWildCard.value,
      chosenColor: color
    });

    setShowColorPicker(false);
    setPendingWildCard(null);
    setCanPlayDrawnCard(false);
    setDrawnCard(null);
  };

  const handleDrawCard = () => {
    if (!isMyTurn) return;
    const socket = getSocket();
    socket.emit('draw_card', { gameId: parseInt(gameId) });
  };

  const handleCallUno = () => {
    const socket = getSocket();
    socket.emit('call_uno', { gameId: parseInt(gameId) });
  };

  const handleChallengeUno = (challengedPlayerId) => {
    const socket = getSocket();
    socket.emit('challenge_uno', { gameId: parseInt(gameId), challengedPlayerId });
  };

  const handleSendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const socket = getSocket();
    socket.emit('chat_message', { gameId: parseInt(gameId), message: chatInput });
    setChatInput('');
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
            <div className="uno-call-text">UNO!</div>
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
              disabled={!canPlayCard(card) && !canPlayDrawnCard}
            />
          ))}
        </div>
      </div>

      {/* Chat */}
      <div className="game-chat">
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
    </div>
  );
}

export default GameBoard;
