import os

with open('src/App.jsx', 'r') as f:
    content = f.read()

# 1. Imports
if "import RobotCreator" not in content:
    content = content.replace("import MapEditor from './components/MapEditor';", "import MapEditor from './components/MapEditor';\nimport RobotCreator from './components/RobotCreator';")

if "forwardRef" not in content:
    content = content.replace("import React, { useEffect, useState, useRef, useCallback } from 'react';", "import React, { useEffect, useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';")

# 2. SimSelector forwardRef
if "const SimSelector = forwardRef" not in content:
    content = content.replace("function SimSelector({ onSwitch, onStop, isDark, isWaitingOdom }) {", "const SimSelector = forwardRef(function SimSelector({ onSwitch, onStop, isDark, isWaitingOdom }, ref) {\n  useImperativeHandle(ref, () => ({ fetchRobots }));")
    
    # Close forwardRef: replace the closing brace of SimSelector
    # We find the end of SimSelector by looking for the next function, e.g. TopicMonitor
    idx = content.find("function TopicMonitor")
    if idx != -1:
        # Find the closing brace of SimSelector before TopicMonitor
        last_brace_idx = content.rfind("}", 0, idx)
        content = content[:last_brace_idx] + "});\n\n" + content[idx:]

# 3. Update logic in App
if "const [appVersion" not in content:
    update_logic = """
  const simSelectorRef = useRef(null);
  const [appVersion, setAppVersion] = useState('0.0.0');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [isSpinningUpdate, setIsSpinningUpdate] = useState(false);
  const [showStatusToast, setShowStatusToast] = useState(false);
  const toastTimerRef = useRef(null);

  const triggerUpdateCheck = () => {
    setIsSpinningUpdate(true);
    setTimeout(() => setIsSpinningUpdate(false), 1200);

    setShowStatusToast(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setShowStatusToast(false);
    }, 10000);

    if (window.electronAPI) {
      window.electronAPI.checkForUpdates();
    } else {
      setUpdateInfo({ status: 'checking', message: 'Checking for updates...' });
      setTimeout(() => {
        setUpdateInfo({ status: 'latest', message: 'No update available.' });
      }, 1500);
    }
  };

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getAppVersion().then(v => {
        if (v) setAppVersion(v);
      });
      const unsubscribe = window.electronAPI.onUpdateStatus((info) => {
        setUpdateInfo(info);
        setShowStatusToast(true);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => {
          setShowStatusToast(false);
        }, 10000);
      });
      return () => unsubscribe && unsubscribe();
    }
  }, []);
"""
    content = content.replace("const [appMode,     setAppMode]     = useState('dashboard');", "const [appMode,     setAppMode]     = useState('dashboard');" + update_logic)

# 4. Buttons in header
buttons_code = """
                {/* 🌟 NEW: Create Robot Toggle Button */}
                <button
                  style={appMode === 'creator' ? S.topBtnActive : S.topBtn}
                  onClick={() => {
                    setAppMode(appMode === 'creator' ? 'dashboard' : 'creator');
                    setShowMonitor(false);
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></svg>
                  Create Robot
                </button>

                {/* 🌟 NEW: Map Editor / Create World Toggle Button */}
                <button
                  style={appMode === 'editor' ? S.topBtnActive : S.topBtn}
                  onClick={() => {
                     setAppMode(appMode === 'editor' ? 'dashboard' : 'editor');
                     setShowMonitor(false);
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l9 4-9 4-9-4 9-4zm0 8l9 4-9 4-9-4 9-4zm0 8l9 4-9 4-9-4 9-4z"></path></svg>
                  Create World
                </button>
"""
if "Create Robot" not in content:
    # Replace existing Map Editor button with both
    start_idx = content.find("{/* 🌟 NEW: Map Editor Toggle Button */}")
    end_idx = content.find("</button>", start_idx) + 9
    content = content[:start_idx] + buttons_code.strip() + content[end_idx:]

# Update button next to logo
update_btn = """
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '16px' }}>
                <span style={{ 
                  background: isDark ? '#ffffff10' : '#00000010', 
                  color: isDark ? '#fff' : '#000',
                  padding: '4px 10px', borderRadius: '20px', fontSize: '13px', fontWeight: 600 
                }}>
                  v{appVersion}
                </span>
                <button 
                  style={{
                    background: isDark ? '#ffffff15' : '#e0e0e0', color: isDark ? '#fff' : '#000',
                    border: 'none', padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 600,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px'
                  }}
                  onClick={triggerUpdateCheck}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: isSpinningUpdate ? 'spin 1s linear infinite' : 'none' }}>
                    <polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                  </svg>
                  Update
                </button>
              </div>
"""
if "triggerUpdateCheck" in content and "v{appVersion}" not in content:
    # Insert next to status box
    status_idx = content.find("<div style={S.statusBox}><div style={S.dot(rosConnected)}/>{status}</div>")
    insert_pos = status_idx + len("<div style={S.statusBox}><div style={S.dot(rosConnected)}/>{status}</div>")
    content = content[:insert_pos] + update_btn + content[insert_pos:]

# 5. Add toast at the top of app
toast_code = """
      {showStatusToast && updateInfo && (
        <div style={{
          position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, display: 'flex', alignItems: 'center', gap: '10px',
          background: updateInfo.status === 'available' || updateInfo.status === 'downloaded' ? (isDark ? '#1b5e20' : '#e8f5e9')
            : updateInfo.status === 'downloading' ? (isDark ? '#0d47a1' : '#e3f2fd')
              : updateInfo.status === 'error' ? (isDark ? '#b71c1c' : '#ffebee')
                : (isDark ? '#333' : '#fff'),
          color: updateInfo.status === 'available' || updateInfo.status === 'downloaded' ? (isDark ? '#81c784' : '#2e7d32')
            : updateInfo.status === 'downloading' ? (isDark ? '#64b5f6' : '#1565c0')
              : updateInfo.status === 'error' ? (isDark ? '#e57373' : '#c62828')
                : (isDark ? '#ccc' : '#666'),
          border: `1px solid ${updateInfo.status === 'available' || updateInfo.status === 'downloaded' ? '#4caf50'
          : updateInfo.status === 'downloading' ? '#2196f3'
            : (isDark ? '#444' : '#ddd')}`,
          padding: '8px 18px', borderRadius: '24px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          fontSize: '13px', fontWeight: 600
        }}>
          <span>
            {updateInfo.status === 'checking' ? 'Checking for updates...'
              : updateInfo.status === 'available' ? 'Update available! Downloading...'
                : updateInfo.status === 'downloading' ? `Downloading: ${updateInfo.progress}%`
                  : updateInfo.status === 'downloaded' ? 'Update ready. Restarting...'
                    : updateInfo.status === 'error' ? `Error: ${updateInfo.message}`
                      : updateInfo.message || 'No Update Available'}
          </span>
          <button
            onClick={() => setShowStatusToast(false)}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, marginLeft: '8px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      )}
"""
if "showStatusToast && updateInfo" not in content:
    app_div = content.find("<div style={S.app}>")
    content = content[:app_div+19] + toast_code + content[app_div+19:]

# 6. Change appMode render logic
if "<RobotCreator" not in content:
    orig_render = "{appMode === 'editor' ? (\n              <MapEditor onExit={() => setAppMode('dashboard')} isDark={isDark} />\n            ) : (\n              <div style={S.mainContent}>"
    new_render = """{appMode === 'editor' ? (
              <MapEditor onExit={() => setAppMode('dashboard')} isDark={isDark} />
            ) : appMode === 'creator' ? (
              <RobotCreator onExit={() => setAppMode('dashboard')} isDark={isDark} onCreated={() => simSelectorRef.current?.fetchRobots()} />
            ) : (
              <div style={S.mainContent}>"""
    content = content.replace(orig_render, new_render)
    
# 7. Add simSelectorRef to SimSelector usage
if "ref={simSelectorRef}" not in content:
    content = content.replace("<SimSelector onSwitch={handleSwitch} onStop={() => setIsWaitingOdom(false)} isDark={isDark} isWaitingOdom={isWaitingOdom} />", "<SimSelector ref={simSelectorRef} onSwitch={handleSwitch} onStop={() => setIsWaitingOdom(false)} isDark={isDark} isWaitingOdom={isWaitingOdom} />")

with open('src/App.jsx', 'w') as f:
    f.write(content)
