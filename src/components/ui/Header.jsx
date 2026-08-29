import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useAppStore from '../../store/useAppStore';
import logoDark from '/irish-wbg.png?url';
import logoLight from '/imagermbg.png?url';
import './Header.css';

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark, setIsDark, showMonitor, setShowMonitor, setShowEnvModal } = useAppStore();

  const [appVersion, setAppVersion] = useState('0.0.0');
  const [isSpinningUpdate, setIsSpinningUpdate] = useState(false);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getAppVersion?.().then((v) => { if (v) setAppVersion(v); });
    }
  }, []);

  const handleUpdate = () => {
    setIsSpinningUpdate(true);
    setTimeout(() => setIsSpinningUpdate(false), 1200);
    window.electronAPI?.checkForUpdates?.();
  };

  const onDashboard = location.pathname === '/';

  return (
    <header className={`app-header ${isDark ? 'dark' : 'light'}`}>
      <div className="header-left">
        <img src={isDark ? logoDark : logoLight} alt="IRiSH Logo" className="header-logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }} />
        <span className="header-title" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>AMR Simulator</span>
        <span className="header-badge">v{appVersion}</span>
      </div>
      <div className="header-right">
        {onDashboard && (
          <button className="hdr-icon-btn" onClick={handleUpdate} title="Check for updates">
            <svg className={isSpinningUpdate ? 'spin' : ''} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        )}
        {onDashboard && (
          <button className={`hdr-icon-btn ${showMonitor ? 'active' : ''}`} onClick={() => setShowMonitor(!showMonitor)} title="Topic Monitor">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </button>
        )}
        {onDashboard && (
          <button className="hdr-icon-btn" onClick={() => setShowEnvModal(true)} title="Environment Check">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </button>
        )}
        <div className="hdr-divider" />
        <button className={`hdr-icon-btn ${location.pathname === '/create-robot' ? 'active' : ''}`} onClick={() => navigate(location.pathname === '/create-robot' ? '/' : '/create-robot')} title="Create Robot">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" />
            <line x1="8" y1="16" x2="8.01" y2="16" /><line x1="16" y1="16" x2="16.01" y2="16" />
          </svg>
        </button>
        <button className={`hdr-icon-btn ${location.pathname === '/create-world' ? 'active' : ''}`} onClick={() => navigate(location.pathname === '/create-world' ? '/' : '/create-world')} title="Create World">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </button>
        <div className="hdr-divider" />
        <button className="hdr-icon-btn" onClick={() => setIsDark(!isDark)} title={isDark ? 'Light Mode' : 'Dark Mode'}>
          {isDark ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
