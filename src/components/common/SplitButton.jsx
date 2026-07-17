import React, { useState, useRef, useEffect } from 'react';
import './SplitButton.css';

export default function SplitButton({ 
  icon, 
  label, 
  isActive, 
  onMainClick, 
  options, 
  selectedOption, 
  onOptionSelect 
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const selectedOpt = options.find(o => o.value === selectedOption);

  return (
    <div className={`split-btn-group ${isActive ? 'active' : ''}`} ref={dropdownRef}>
      <button 
        className="split-btn-main" 
        onClick={() => onMainClick()}
        title={label}
      >
        {icon}
        <span className="btn-label">{label}</span>
      </button>
      
      <div className="split-btn-divider" />
      
      <button 
        className="split-btn-trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedOpt ? selectedOpt.label : "▼"}
      </button>

      {isOpen && (
        <div className="split-btn-menu">
          {options.map((opt) => (
            <button
              key={opt.value}
              className={`split-btn-item ${opt.value === selectedOption ? 'selected' : ''}`}
              onClick={() => {
                onOptionSelect(opt.value);
                setIsOpen(false);
              }}
            >
              <span className="split-btn-item-icon">{opt.icon}</span>
              {opt.label.replace(' ▼', '')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
