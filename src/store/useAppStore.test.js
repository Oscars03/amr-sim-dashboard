import { describe, it, expect, beforeEach } from 'vitest'
import useAppStore from './useAppStore'

const initialState = useAppStore.getState()

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  it('has the expected initial state shape', () => {
    const state = useAppStore.getState()
    expect(state.isDark).toBe(true)
    expect(state.rosObj).toBeNull()
    expect(state.rosStatus).toBe('Disconnected')
    expect(state.activeWorld).toBe('room.json')
    expect(state.activeRobot).toBe('amr_flaregun.urdf')
    expect(state.urdf).toBeNull()
    expect(state.mapName).toBe('')
    expect(state.mapData).toBeNull()
    expect(state.mapStatus).toBe('idle')
    expect(state.pose).toEqual({ x: '-', y: '-', theta: '-' })
    expect(state.isWaitingOdom).toBe(false)
    expect(state.showMonitor).toBe(false)
    expect(state.appVersion).toBe('0.2.0')
    expect(state.isSpinningUpdate).toBe(false)
    expect(state.fpsLimit).toBe(20)
  })

  it.each([
    ['setIsDark', 'isDark', false],
    ['setRosObj', 'rosObj', { id: 'ros-1' }],
    ['setRosStatus', 'rosStatus', 'Connected'],
    ['setActiveWorld', 'activeWorld', 'office.json'],
    ['setActiveRobot', 'activeRobot', 'rhino.urdf'],
    ['setUrdf', 'urdf', '<robot/>'],
    ['setMapName', 'mapName', 'My Map'],
    ['setMapData', 'mapData', { walls: [] }],
    ['setMapStatus', 'mapStatus', 'loading'],
    ['setPose', 'pose', { x: 1, y: 2, theta: 3 }],
    ['setIsWaitingOdom', 'isWaitingOdom', true],
    ['setShowMonitor', 'showMonitor', true],
    ['setAppVersion', 'appVersion', '1.0.0'],
    ['setIsSpinningUpdate', 'isSpinningUpdate', true],
    ['setFpsLimit', 'fpsLimit', 60],
  ])('%s updates only its own key', (setterName, key, value) => {
    const before = useAppStore.getState()
    before[setterName](value)
    const after = useAppStore.getState()

    expect(after[key]).toEqual(value)

    for (const otherKey of Object.keys(initialState)) {
      if (otherKey === key || typeof initialState[otherKey] === 'function') continue
      expect(after[otherKey]).toEqual(before[otherKey])
    }
  })
})
