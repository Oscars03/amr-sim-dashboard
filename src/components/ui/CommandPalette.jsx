import { useState, useEffect, useRef, useMemo } from 'react';

export default function CommandPalette({
  isOpen,
  onClose,
  isDark,
  actions = [],
}) {
  const [query, setQuery] = useState('');
  const [rawIndex, setRawIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const filteredActions = useMemo(() => {
    if (!query.trim()) return actions;
    const q = query.toLowerCase();
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        (a.category && a.category.toLowerCase().includes(q)) ||
        (a.keywords && a.keywords.toLowerCase().includes(q))
    );
  }, [actions, query]);

  const selectedIndex = rawIndex >= filteredActions.length ? 0 : rawIndex;

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setRawIndex((i) => (i + 1) % (filteredActions.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setRawIndex((i) => (i - 1 + filteredActions.length) % (filteredActions.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredActions[selectedIndex]) {
        filteredActions[selectedIndex].run();
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(8px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
        paddingLeft: '16px',
        paddingRight: '16px',
        animation: 'fade-in 0.15s var(--ease-out)',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        style={{
          width: '560px',
          maxWidth: '100%',
          background: isDark ? 'var(--c-panel)' : '#ffffff',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-xl)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Input box */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '14px 18px',
            borderBottom: '1px solid var(--c-border)',
          }}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--c-text-3)" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or search action..."
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdpalette-list"
            aria-activedescendant={filteredActions[selectedIndex] ? `cmdpalette-opt-${selectedIndex}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setRawIndex(0);
            }}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: 'var(--font-ui)',
              fontSize: '14px',
              color: 'var(--c-text-1)',
            }}
          />
          <kbd
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: '4px',
              background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text-3)',
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div
          id="cmdpalette-list"
          role="listbox"
          aria-label="Commands"
          className="scrollable"
          style={{
            maxHeight: '320px',
            overflowY: 'auto',
            padding: '6px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          {filteredActions.length === 0 ? (
            <div
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                color: 'var(--c-text-3)',
                fontSize: '13px',
                fontFamily: 'var(--font-ui)',
              }}
            >
              No matching commands found
            </div>
          ) : (
            filteredActions.map((action, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={action.id || action.label}
                  id={`cmdpalette-opt-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    action.run();
                    onClose();
                  }}
                  onMouseEnter={() => setRawIndex(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 'var(--r-md)',
                    cursor: 'pointer',
                    background: isSelected
                      ? isDark
                        ? 'var(--c-accent-bg)'
                        : 'rgba(14, 165, 233, 0.08)'
                      : 'transparent',
                    border: isSelected
                      ? '1px solid var(--c-accent)'
                      : '1px solid transparent',
                    transition: 'background var(--dur-fast), border-color var(--dur-fast)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {action.icon && (
                      <span style={{ fontSize: '16px', display: 'flex', alignItems: 'center' }}>
                        {action.icon}
                      </span>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: isSelected ? 600 : 500,
                          color: isSelected ? 'var(--c-accent)' : 'var(--c-text-1)',
                          fontFamily: 'var(--font-ui)',
                        }}
                      >
                        {action.label}
                      </span>
                      {action.desc && (
                        <span style={{ fontSize: '11px', color: 'var(--c-text-3)' }}>
                          {action.desc}
                        </span>
                      )}
                    </div>
                  </div>

                  {action.shortcut && (
                    <kbd
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
                        border: '1px solid var(--c-border)',
                        color: 'var(--c-text-3)',
                      }}
                    >
                      {action.shortcut}
                    </kbd>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
