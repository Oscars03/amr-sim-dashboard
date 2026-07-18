import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useIsCompact from '../../hooks/useIsCompact';
import useAppStore from '../../store/useAppStore';
import logoDark from '/irish-wbg.png?url';
import logoLight from '/imagermbg.png?url';
import './Header.css';

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isDark, setIsDark,
    rosStatus,
    showMonitor, setShowMonitor,
  } = useAppStore();

  const [appVersion, setAppVersion] = useState('0.0.0');
  const [isSpinningUpdate, setIsSpinningUpdate] = useState(false);
  const compact = useIsCompact(900);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getAppVersion?.().then((v) => {
        if (v) setAppVersion(v);
      });
    }
  }, []);

  const handleUpdate = () => {
    setIsSpinningUpdate(true);
    setTimeout(() => setIsSpinningUpdate(false), 1200);
    if (window.electronAPI) {
      window.electronAPI.checkForUpdates?.();
    }
  };

  const rosConnected = rosStatus === 'Connected to ROS2' || rosStatus === 'Connected';
  const onDashboard = location.pathname === '/';

  return (
    <header className={`app-header ${isDark ? 'dark' : 'light'} ${compact ? 'compact' : ''}`}>
      {/* ── Left Side ─────────────────────────────────── */}
      <div className="header-left">
        {/* Logo */}
        <img
          src={isDark ? logoDark : logoLight}
          alt="IRiSH Logo"
          className="header-logo"
          onClick={() => navigate('/')}
          style={{ cursor: 'pointer' }}
        />

        {/* Title */}
        <span className="header-title" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>AMR Simulator</span>

        {/* Version badge */}
        <span className="header-badge version-badge">
          v{appVersion}
        </span>

        {/* Update button */}
        {onDashboard && (
          <button className="header-btn tier3-btn" onClick={handleUpdate} title="Check for updates">
            <svg
              className={isSpinningUpdate ? 'spin' : ''}
              width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            <span className="btn-label">Update</span>
          </button>
        )}

        {/* Divider before status (only if onDashboard since Update is there, but wait, maybe we always want it if there's space? The prompt says "between the Update button and the ROS 2 status pill". So we can attach it to onDashboard.) */}
        {onDashboard && <div className="header-divider" />}

        {/* Connection status */}
        <div className={`header-status ${rosConnected ? 'connected' : 'disconnected'}`}>
          <span className="status-dot" />
          <span className="status-text">{rosStatus}</span>
        </div>
      </div>

      {/* ── Right Side ────────────────────────────────── */}
      <div className="header-right">
        {/* Dark / Light Mode toggle */}
        <button className="header-btn tier2-btn theme-toggle" onClick={() => setIsDark(!isDark)} title={isDark ? 'Dark Mode' : 'Light Mode'}>
          {isDark ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          )}
          <span className="btn-label">{isDark ? 'Dark Mode' : 'Light Mode'}</span>
        </button>

        {/* Monitor */}
        {onDashboard && (
          <button
            className={`header-btn tier2-btn monitor-toggle ${showMonitor ? 'active' : ''}`}
            onClick={() => setShowMonitor(!showMonitor)}
            title="Monitor"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span className="btn-label">Monitor</span>
          </button>
        )}

        <div className="header-divider" />

        {/* Create Robot */}
        <button
          className={`header-btn tier1-btn ${location.pathname === '/create-robot' ? 'active' : ''}`}
          disabled
          style={{ opacity: 0.5, cursor: 'not-allowed' }}
          title="Create Robot (Locked)"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="btn-label">Create Robot</span>
        </button>

        {/* Create World */}
        <button
          className={`header-btn tier1-btn ${location.pathname === '/create-world' ? 'active' : ''}`}
          onClick={() => navigate(location.pathname === '/create-world' ? '/' : '/create-world')}
          title="Create World"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span className="btn-label">Create World</span>
        </button>
      </div>
    </header>
  );
}
