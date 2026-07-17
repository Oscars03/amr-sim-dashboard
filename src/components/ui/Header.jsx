import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useAppStore from '../../store/useAppStore';
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

  const rosConnected = rosStatus === 'Connected to ROS 2' || rosStatus === 'Connected';
  const onDashboard = location.pathname === '/';

  return (
    <header className={`app-header ${isDark ? 'dark' : 'light'}`}>
      {/* ── Left Side ─────────────────────────────────── */}
      <div className="header-left">
        {/* Logo */}
        <img
          src={isDark ? '/irish-wbg.png' : '/imagermbg.png'}
          alt="IRiSH Logo"
          className="header-logo"
        />

        {/* Title */}
        <span className="header-title">AMR Simulator</span>

        {/* Version badge */}
        <span className="header-badge version-badge">
          v{appVersion}
        </span>

        {/* Update button */}
        {onDashboard && (
          <button className="header-icon-btn" onClick={handleUpdate} title="Check for updates">
            <svg
              className={isSpinningUpdate ? 'spin' : ''}
              width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Update
          </button>
        )}

        {/* Connection status */}
        <div className={`header-status ${rosConnected ? 'connected' : 'disconnected'}`}>
          <span className="status-dot" />
          {rosStatus}
        </div>
      </div>

      {/* ── Right Side ────────────────────────────────── */}
      <div className="header-right">
        {/* Dark / Light Mode toggle — shows CURRENT theme */}
        <button className="header-icon-btn" onClick={() => setIsDark(!isDark)}>
          {isDark ? (
            /* Currently dark → show moon icon + "Dark Mode" */
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          ) : (
            /* Currently light → show sun icon + "Light Mode" */
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          )}
          {isDark ? 'Dark Mode' : 'Light Mode'}
        </button>

        {/* Monitor — only meaningful on dashboard */}
        {onDashboard && (
          <button
            className={`header-icon-btn ${showMonitor ? 'active' : ''}`}
            onClick={() => setShowMonitor(!showMonitor)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Monitor
          </button>
        )}

        {/* Create Robot */}
        <button
          className={`header-icon-btn ${location.pathname === '/create-robot' ? 'active' : ''}`}
          onClick={() => navigate(location.pathname === '/create-robot' ? '/' : '/create-robot')}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Create Robot
        </button>

        {/* Create World */}
        <button
          className={`header-icon-btn ${location.pathname === '/create-world' ? 'active' : ''}`}
          onClick={() => navigate(location.pathname === '/create-world' ? '/' : '/create-world')}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          Create World
        </button>
      </div>
    </header>
  );
}
