import { useState } from 'react';
import './EnvironmentCheckModal.css';

export default function EnvironmentCheckModal({
  isOpen,
  onClose,
  isDark = true,
  envData,
  onRecheck,
  onLaunchSim,
}) {
  const [copied, setCopied] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  if (!isOpen) return null;

  const checks = envData?.checks || {};
  const allReady = envData?.allReady ?? false;
  const recommendedCommand = envData?.recommendedCommand || '';

  const handleCopy = async () => {
    if (!recommendedCommand) return;
    try {
      await navigator.clipboard.writeText(recommendedCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const handleRecheckClick = async () => {
    if (rechecking || !onRecheck) return;
    setRechecking(true);
    try {
      await onRecheck();
    } finally {
      setTimeout(() => setRechecking(false), 500);
    }
  };

  return (
    <div className="ecm-overlay" onClick={onClose}>
      <div
        className={`ecm-modal ${isDark ? 'dark' : 'light'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="ecm-header">
          <div className="ecm-title-wrap">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <h3 className="ecm-title">Simulation Environment Check</h3>
          </div>
          <button type="button" className="ecm-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="ecm-body">
          {/* Checklist Items */}
          <div className="ecm-checklist">
            {Object.entries(checks).map(([key, item]) => (
              <div
                key={key}
                className={`ecm-item ${item.ready ? 'ready' : 'missing'}`}
              >
                <div className="ecm-item-info">
                  <div className="ecm-item-name">{item.name}</div>
                  <div className="ecm-item-detail">{item.detail}</div>
                </div>
                <span className={`ecm-item-badge ${item.ready ? 'ready' : 'missing'}`}>
                  {item.ready ? 'Ready ✓' : 'Missing ⚠️'}
                </span>
              </div>
            ))}
          </div>

          {/* Missing command box */}
          {!allReady && recommendedCommand && (
            <div className="ecm-command-box">
              <div className="ecm-command-header">
                <div className="ecm-command-title">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Install Required Dependencies
                </div>
                <button
                  type="button"
                  className={`ecm-btn ecm-btn-copy ${copied ? 'copied' : ''}`}
                  onClick={handleCopy}
                  title="Copy command to clipboard"
                >
                  {copied ? '✓ Copied!' : 'Copy Command'}
                </button>
              </div>
              <div className="ecm-code-block">{recommendedCommand}</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                Paste and run this command in your terminal, then click <strong>"Re-check"</strong> below.
              </div>
            </div>
          )}

          {/* All Green Status Banner */}
          {allReady && (
            <div className="ecm-success-banner">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>All simulation dependencies are installed and ready to run!</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="ecm-footer">
          <button
            type="button"
            className="ecm-btn ecm-btn-secondary"
            onClick={handleRecheckClick}
            disabled={rechecking}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              style={{
                animation: rechecking ? 'spin 1s linear infinite' : 'none',
              }}
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {rechecking ? 'Checking...' : 'Re-check'}
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="ecm-btn ecm-btn-secondary"
              onClick={onClose}
            >
              Close
            </button>
            {allReady && onLaunchSim && (
              <button
                type="button"
                className="ecm-btn ecm-btn-success"
                onClick={() => {
                  onClose();
                  onLaunchSim();
                }}
              >
                Start Simulation
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
