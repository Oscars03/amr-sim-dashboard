import { useEffect } from 'react';

export default function ShortcutModal({ isOpen, onClose, isDark }) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const SHORTCUT_GROUPS = [
    {
      title: 'Teleoperation (Drive)',
      items: [
        { keys: ['I'], desc: 'Drive forward' },
        { keys: [','], desc: 'Drive reverse' },
        { keys: ['J', 'L'], desc: 'Turn left / Turn right' },
        { keys: ['U', 'O'], desc: 'Forward-left / Forward-right' },
        { keys: ['M', '.'], desc: 'Reverse-left / Reverse-right' },
        { keys: ['K'], desc: 'Emergency stop (brake)' },
        { keys: ['Shift'], desc: 'Hold for Holonomic (omni) mode' },
      ],
    },
    {
      title: 'Speed & Calibration',
      items: [
        { keys: ['W', 'X'], desc: 'Increase / Decrease linear speed' },
        { keys: ['E', 'C'], desc: 'Increase / Decrease turn speed' },
      ],
    },
    {
      title: 'Navigation & Quick Actions',
      items: [
        { keys: ['Ctrl', 'K'], desc: 'Command Palette' },
        { keys: ['?'], desc: 'Show this keyboard shortcut guide' },
        { keys: ['Esc'], desc: 'Close open modal / popover' },
      ],
    },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(8px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fade-in 0.15s var(--ease-out)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '560px',
          maxWidth: '100%',
          background: isDark ? 'var(--c-panel)' : '#ffffff',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-xl)',
          padding: '24px',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          color: 'var(--c-text-1)',
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>⌨️</span>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-ui)' }}>
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--c-text-3)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: 'var(--r-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {SHORTCUT_GROUPS.map((grp) => (
            <div key={grp.title} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--c-text-3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  fontFamily: 'var(--font-ui)',
                }}
              >
                {grp.title}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                  borderRadius: 'var(--r-md)',
                  padding: '8px 12px',
                  border: '1px solid var(--c-border)',
                }}
              >
                {grp.items.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '13px',
                    }}
                  >
                    <span style={{ color: 'var(--c-text-2)' }}>{item.desc}</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {item.keys.map((k) => (
                        <kbd
                          key={k}
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: '4px',
                            background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                            border: '1px solid var(--c-border)',
                            color: 'var(--c-accent)',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                          }}
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
