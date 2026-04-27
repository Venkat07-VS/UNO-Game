import React from 'react';
import './Card.css';

const COLOR_MAP = {
  red: '#e74c3c',
  blue: '#3498db',
  green: '#2ecc71',
  yellow: '#f1c40f',
  wild: '#2c3e50'
};

const VALUE_DISPLAY = {
  skip: '⊘',
  reverse: '⟲',
  draw2: '+2',
  wild: '★',
  wild_draw4: '+4'
};

function Card({ color, value, onClick, disabled, small, faceDown }) {
  if (faceDown) {
    return (
      <div className={`card card-back ${small ? 'card-small' : ''}`}>
        <div className="card-back-design">
          <span>V-UNO</span>
        </div>
      </div>
    );
  }

  const displayValue = VALUE_DISPLAY[value] || value;
  const bgColor = COLOR_MAP[color] || '#2c3e50';
  const isWild = color === 'wild';
  const isDark = color === 'blue' || color === 'wild';

  return (
    <div
      className={`card ${small ? 'card-small' : ''} ${disabled ? 'card-disabled' : 'card-playable'} ${isWild ? 'card-wild' : ''}`}
      style={{ backgroundColor: bgColor, color: isDark ? '#fff' : '#000' }}
      onClick={!disabled && onClick ? () => onClick({ color, value }) : undefined}
    >
      <span className="card-corner top-left">{displayValue}</span>
      <span className="card-center">{displayValue}</span>
      <span className="card-corner bottom-right">{displayValue}</span>
      {isWild && (
        <div className="wild-colors">
          <div className="wild-quarter" style={{ backgroundColor: '#e74c3c' }}></div>
          <div className="wild-quarter" style={{ backgroundColor: '#3498db' }}></div>
          <div className="wild-quarter" style={{ backgroundColor: '#2ecc71' }}></div>
          <div className="wild-quarter" style={{ backgroundColor: '#f1c40f' }}></div>
        </div>
      )}
    </div>
  );
}

export default Card;
