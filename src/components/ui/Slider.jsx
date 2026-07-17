import React from 'react';
import './Slider.css';

export default function Slider({ 
  label, 
  value, 
  onChange, 
  min, 
  max, 
  step, 
  disabled = false,
  accentColor = "var(--accent-blue)",
  legendMin,
  legendMax 
}) {
  const percent = ((value - min) / (max - min)) * 100;
  const trackBackground = `linear-gradient(to right, ${accentColor} ${percent}%, var(--bg-app) ${percent}%)`;

  return (
    <div className="slider-container">
      <div className="slider-header">
        <span className="slider-label">{label}</span>
      </div>
      <div className="slider-track-row">
        <div className="slider-track-col">
          <input
            type="range"
            className="custom-slider"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            disabled={disabled}
            style={{ background: trackBackground }}
          />
          {(legendMin || legendMax) && (
            <div className="slider-legend-row">
              <span className="slider-key-badge" style={{ background: `${accentColor}20` }}>{legendMin}</span>
              <span className="slider-key-badge" style={{ background: `${accentColor}20` }}>{legendMax}</span>
            </div>
          )}
        </div>
        <span className="slider-val" style={{ color: accentColor }}>{Number(value).toFixed(2)}</span>
      </div>
    </div>
  );
}
