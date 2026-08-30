import { useState, useEffect } from 'react';

export default function CoachTour({ isDark }) {
  const [step, setStep] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    try {
      const done = localStorage.getItem('amr-sim-tour-done');
      if (!done) {
        const timer = setTimeout(() => setIsOpen(true), 600);
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
      title: 'Welcome to AMR Simulator',
      desc: 'High-performance 2D mobile robot simulator. Take a quick interactive overview of the workspace.',
      pos: { bottom: '50px', left: '50%', transform: 'translateX(-50%)' },
      highlight: null,
    },
    {
      title: '2D Map & HUD Controls',
      desc: 'Top-left card shows active world name and instant Reset Pose. Top-right buttons control Camera Center, Rotate, and Zoom.',
      pos: { top: '170px', left: '20px' },
      highlight: { top: '64px', left: '12px', width: '220px', height: '95px', borderRadius: '12px' },
    },
    {
      title: 'Inspector & Control Tabs',
      desc: 'Telemetry, Robot Setup & Spawn Pose, Teleop Drive, and Topic Monitor console are all organized in this panel.',
      pos: { top: '80px', right: '360px' },
      highlight: { top: '52px', right: '0px', width: '340px', bottom: '28px', borderRadius: '0px' },
    },
    {
      title: 'Status & Telemetry Bar',
      desc: 'Real-time indicators for ROS 2 connection, Environment readiness, FPS limit toggle, and Real-Time Factor (RTF).',
      pos: { bottom: '48px', left: '20px' },
      highlight: { bottom: '0px', left: '0px', right: '0px', height: '28px', borderRadius: '0px' },
    },
    {
      title: 'Command Palette & Shortcuts',
      desc: 'Press "?" at any time for the full shortcut guide, or "Ctrl+K" (Cmd+K) to open the Command Palette.',
      pos: { bottom: '50px', left: '50%', transform: 'translateX(-50%)' },
      highlight: null,
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
        overflow: 'hidden',
      }}
    >
      {/* True spotlight cutout (clear focus inside, darkened outside) */}
      {cur.highlight ? (
        <div
          style={{
            position: 'absolute',
            ...cur.highlight,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.65), 0 0 0 2px var(--c-accent), 0 0 24px rgba(2, 132, 199, 0.45)',
            pointerEvents: 'none',
            zIndex: 99999,
            transition: 'all 0.3s var(--ease-out)',
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.60)',
            pointerEvents: 'none',
            zIndex: 99999,
          }}
        />
      )}

      {/* Tour Dialog Card */}
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
          zIndex: 100000,
          animation: 'fade-in 0.15s var(--ease-out)',
          transition: 'top 0.3s var(--ease-out), bottom 0.3s var(--ease-out), left 0.3s var(--ease-out), right 0.3s var(--ease-out)',
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
              {step < STEPS.length - 1 ? 'Next' : 'Finish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
