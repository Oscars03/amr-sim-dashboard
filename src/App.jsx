import React from 'react';
import { Routes, Route } from 'react-router-dom';
import useAppStore from './store/useAppStore';
import Header from './components/ui/Header';
import DashboardView from './components/views/DashboardView';
import CreateWorldView from './components/views/CreateWorldView';
import CreateRobotView from './components/views/CreateRobotView';
import './styles/global.css';

export default function App() {
  const { isDark } = useAppStore();

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
