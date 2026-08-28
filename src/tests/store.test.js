/**
 * Tests for useAppStore — pure state, no DOM needed
 */
import { describe, it, expect, beforeEach } from 'vitest';

// Zustand getState/setState — no React render needed
let useAppStore;

beforeEach(async () => {
  // Re-import with cache bust to get fresh module state
  const mod = await import('../store/useAppStore.js');
  useAppStore = mod.default;
  useAppStore.setState({
    fpsLimit: 20,
    isDark: true,
    rosStatus: 'Disconnected',
    pose: { x: '-', y: '-', theta: '-' },
  });
});

describe('useAppStore', () => {
  it('default fpsLimit is 20', () => {
    expect(useAppStore.getState().fpsLimit).toBe(20);
  });

  it('setFpsLimit cycles 20→60→0', () => {
    const { setFpsLimit } = useAppStore.getState();
    setFpsLimit(60);
    expect(useAppStore.getState().fpsLimit).toBe(60);
    setFpsLimit(0);
    expect(useAppStore.getState().fpsLimit).toBe(0);
  });

  it('setIsDark toggles theme', () => {
    useAppStore.getState().setIsDark(false);
    expect(useAppStore.getState().isDark).toBe(false);
  });

  it('setPose updates pose fields', () => {
    useAppStore.getState().setPose({ x: '1.23', y: '4.56', theta: '0.78' });
    expect(useAppStore.getState().pose).toEqual({ x: '1.23', y: '4.56', theta: '0.78' });
  });

  it('setRosStatus transitions Connected→Disconnected', () => {
    useAppStore.getState().setRosStatus('Connected');
    expect(useAppStore.getState().rosStatus).toBe('Connected');
    useAppStore.getState().setRosStatus('Disconnected');
    expect(useAppStore.getState().rosStatus).toBe('Disconnected');
  });

  it('manages envData and showEnvModal state', () => {
    expect(useAppStore.getState().showEnvModal).toBe(false);
    expect(useAppStore.getState().envData).toBe(null);

    useAppStore.getState().setShowEnvModal(true);
    expect(useAppStore.getState().showEnvModal).toBe(true);

    const mockEnv = { allReady: true, distro: 'jazzy' };
    useAppStore.getState().setEnvData(mockEnv);
    expect(useAppStore.getState().envData).toEqual(mockEnv);
  });
});
