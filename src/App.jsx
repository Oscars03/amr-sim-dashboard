import React, { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import * as ROSLIB from 'roslib';
import useAppStore from './store/useAppStore';
import Header from './components/ui/Header';
import DashboardView from './components/views/DashboardView';
import CreateWorldView from './components/views/CreateWorldView';
import CreateRobotView from './components/views/CreateRobotView';
import './styles/global.css';

const HOST = window.location.hostname || "localhost";
const ROSBRIDGE_URL = `ws://${HOST}:9090`;

export default function App() {
  const { isDark, setRosStatus, setRosObj } = useAppStore();

  useEffect(() => {
    let retryTimer = null;
    let currentRos = null;

    const connect = () => {
      const ros = new ROSLIB.Ros({ url: ROSBRIDGE_URL });
      currentRos = ros;

      ros.on("connection", () => {
        setRosStatus("Connected to ROS2");
        setRosObj(ros);
      });
      ros.on("error", () => {
        setRosStatus("Connection error");
        setRosObj(null);
        retryTimer = setTimeout(connect, 3000);
      });
      ros.on("close", () => {
        setRosStatus("Disconnected");
        setRosObj(null);
        retryTimer = setTimeout(connect, 3000);
      });
    };

    connect();

    return () => {
      clearTimeout(retryTimer);
      currentRos?.close();
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
        background: isDark ? '#08080c' : '#f0f2f5',
        color: isDark ? '#e0e0e0' : '#333333',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
    >
      <Header />
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
