import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const groupRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event) => {
      const inGroup = groupRef.current?.contains(event.target);
      const inMenu = menuRef.current?.contains(event.target);
      if (!inGroup && !inMenu) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const openMenu = () => {
    if (groupRef.current) {
      const rect = groupRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setIsOpen((prev) => !prev);
  };

  const selectedOpt = options.find(o => o.value === selectedOption);

  return (
    <div className={`split-btn-group ${isActive ? 'active' : ''}`} ref={groupRef}>
      <button
        type="button"
        className="split-btn-main"
        onClick={onMainClick}
        title={label}
      >
        {icon}
        <span className="btn-label">{label}</span>
      </button>

      <div className="split-btn-divider" />

      <button
        type="button"
        className="split-btn-trigger"
        onClick={openMenu}
      >
        {selectedOpt ? selectedOpt.label : '▼'}
      </button>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          className="split-btn-menu"
          style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 9999 }}
        >
          {options.map((opt) => (
            <button
              type="button"
              key={opt.value}
              className={`split-btn-item ${opt.value === selectedOption ? 'selected' : ''}`}
              onClick={() => {
                onOptionSelect(opt.value);
                setIsOpen(false);
              }}
            >
              <span className="split-btn-item-icon">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
