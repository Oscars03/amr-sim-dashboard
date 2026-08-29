import { useEffect, useCallback } from 'react';
import { Routes, Route } from 'react-router-dom';
import * as ROSLIB from 'roslib';
import useAppStore from './store/useAppStore';
import Header from './components/ui/Header';
import EnvironmentCheckModal from './components/ui/EnvironmentCheckModal';
import DashboardView from './components/views/DashboardView';
import CreateWorldView from './components/views/CreateWorldView';
import CreateRobotView from './components/views/CreateRobotView';
import './styles/global.css';

const HOST = window.location.hostname || "localhost";
const ROSBRIDGE_URL = `ws://${HOST}:9090`;

export default function App() {
  const {
    isDark,
    setRosStatus,
    setRosObj,
    envData,
    setEnvData,
    showEnvModal,
    setShowEnvModal,
  } = useAppStore();

  const fetchEnv = useCallback(async () => {
    try {
      const res = await fetch(`http://${HOST}:3001/environment-check`);
      if (res.ok) {
        const data = await res.json();
        setEnvData(data);
      }
    } catch (err) {
      console.warn('Failed to fetch environment status:', err);
    }
  }, [setEnvData]);

  useEffect(() => {
    fetchEnv();
  }, [fetchEnv]);

  useEffect(() => {
    let retryTimer = null;
    let currentRos = null;
    let isUnmounted = false;

    // Tear the previous connection down completely before making a new one.
    // ROSLIB.Ros keeps its listeners and underlying WebSocket alive after a
    // failed connect; without this, a sim that stays down (or any flapping
    // rosbridge) leaks one Ros + socket per second.
    const teardown = (ros) => {
      if (!ros) return;
      try { ros.removeAllListeners(); } catch { /* not an emitter yet */ }
      try { ros.close(); } catch { /* already closed */ }
    };

    const scheduleReconnect = () => {
      if (isUnmounted) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, 1000);
    };

    function connect() {
      if (isUnmounted) return;
      teardown(currentRos);
      const ros = new ROSLIB.Ros({ url: ROSBRIDGE_URL });
      currentRos = ros;

      ros.on("connection", () => {
        if (isUnmounted) return;
        setRosStatus("Connected to ROS2");
        setRosObj(ros);
      });
      ros.on("error", () => {
        if (isUnmounted) return;
        setRosStatus("Connecting...");
        setRosObj(null);
        scheduleReconnect();
      });
      ros.on("close", () => {
        if (isUnmounted) return;
        setRosStatus("Disconnected");
        setRosObj(null);
        scheduleReconnect();
      });
    }

    connect();

    return () => {
      isUnmounted = true;
      if (retryTimer) clearTimeout(retryTimer);
      teardown(currentRos);
    };
  }, [setRosObj, setRosStatus]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [isDark]);

  return (
    <div
      className={`app-container ${isDark ? 'dark-theme' : 'light-theme'}`}
      style={{
        background: 'var(--c-bg)',
        color: 'var(--c-text-1)',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <Header />
      <EnvironmentCheckModal
        isOpen={showEnvModal}
        onClose={() => setShowEnvModal(false)}
        isDark={isDark}
        envData={envData}
        onRecheck={fetchEnv}
      />
      <div className="view-container">
        <Routes>
          <Route path="/" element={<DashboardView />} />
          <Route path="/create-robot" element={<CreateRobotView />} />
          <Route path="/create-world" element={<CreateWorldView />} />
        </Routes>
      </div>
    </div>
  );
}
