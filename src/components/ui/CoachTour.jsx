import { useState, useEffect } from 'react';

export default function CoachTour({ isDark }) {
  const [step, setStep] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    try {
      const done = localStorage.getItem('amr-sim-tour-done');
      if (!done) {
        const timer = setTimeout(() => setIsOpen(true), 800);
        return () => clearTimeout(timer);
      }
    } catch {
      /* ignore storage error */
    }
  }, []);

  const completeTour = () => {
    setIsOpen(false);
    try {
      localStorage.setItem('amr-sim-tour-done', 'true');
    } catch {
      /* ignore */
    }
  };

  if (!isOpen) return null;

  const STEPS = [
    {
      title: 'Welcome to AMR Simulator 🚀',
      desc: 'A modern, high-performance 2D autonomous mobile robot simulator. Let us take a quick 4-step tour of the interface.',
      pos: { bottom: '40px', left: '50%', transform: 'translateX(-50%)' },
    },
    {
      title: '2D Canvas & View HUD 🗺️',
      desc: 'Pan, rotate, and zoom the flat 2D viewport. The top-left HUD displays active world info and instant pose reset.',
      pos: { top: '70px', left: '24px' },
    },
    {
      title: 'Inspector & Control Tabs 🎛️',
      desc: 'Use the 4 tabs on the right to inspect Telemetry, configure Robot/Map Setup, Drive via teleop keys, and view Console topics.',
      pos: { top: '70px', right: '50px' },
    },
    {
      title: 'Quick Shortcuts & Palette ⌨️',
      desc: 'Press "?" at any time for the keyboard guide, or "Ctrl+K" to launch the Command Palette.',
      pos: { bottom: '40px', left: '50%', transform: 'translateX(-50%)' },
    },
  ];

  const cur = STEPS[step];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99998,
        pointerEvents: 'auto',
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(3px)',
        animation: 'fade-in 0.2s var(--ease-out)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          ...cur.pos,
          width: '380px',
          maxWidth: '90vw',
          background: isDark ? 'var(--c-panel)' : '#ffffff',
          border: '1.5px solid var(--c-accent)',
          borderRadius: 'var(--r-xl)',
          padding: '20px',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          color: 'var(--c-text-1)',
          animation: 'fade-in 0.15s var(--ease-out)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--c-accent)', fontFamily: 'var(--font-mono)' }}>
            STEP {step + 1} OF {STEPS.length}
          </span>
          <button
            onClick={completeTour}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--c-text-3)',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            Skip Tour
          </button>
        </div>

        <div>
          <h3 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 700, fontFamily: 'var(--font-ui)' }}>
            {cur.title}
          </h3>
          <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: 'var(--c-text-2)' }}>
            {cur.desc}
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
          <div style={{ display: 'flex', gap: '4px' }}>
            {STEPS.map((_, i) => (
              <div
                key={i}
                style={{
                  width: i === step ? '16px' : '6px',
                  height: '6px',
                  borderRadius: '3px',
                  background: i === step ? 'var(--c-accent)' : 'var(--c-border-2)',
                  transition: 'all 0.2s',
                }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--r-md)',
                  border: '1px solid var(--c-border)',
                  background: 'transparent',
                  color: 'var(--c-text-2)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
            )}
            <button
              onClick={() => {
                if (step < STEPS.length - 1) {
                  setStep((s) => s + 1);
                } else {
                  completeTour();
                }
              }}
              style={{
                padding: '6px 16px',
                borderRadius: 'var(--r-md)',
                border: 'none',
                background: 'var(--c-accent)',
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(14, 165, 233, 0.35)',
              }}
            >
              {step < STEPS.length - 1 ? 'Next →' : 'Get Started'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
