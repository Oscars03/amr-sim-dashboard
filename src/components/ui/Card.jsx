import React from 'react';
import './Card.css';

export default function Card({ title, children, style, className = '' }) {
  return (
    <div className={`card ${className}`} style={style}>
      {title && <div className="card-header">{title}</div>}
      {children}
    </div>
  );
}
