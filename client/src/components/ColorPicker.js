import React from 'react';
import './ColorPicker.css';

const COLORS = [
  { name: 'red', hex: '#e74c3c', label: 'Red' },
  { name: 'blue', hex: '#3498db', label: 'Blue' },
  { name: 'green', hex: '#2ecc71', label: 'Green' },
  { name: 'yellow', hex: '#f1c40f', label: 'Yellow' }
];

function ColorPicker({ onColorSelect }) {
  return (
    <div className="color-picker-overlay">
      <div className="color-picker">
        <h3>Choose a Color</h3>
        <div className="color-options">
          {COLORS.map((c) => (
            <button
              key={c.name}
              className="color-option"
              style={{ backgroundColor: c.hex }}
              onClick={() => onColorSelect(c.name)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ColorPicker;
