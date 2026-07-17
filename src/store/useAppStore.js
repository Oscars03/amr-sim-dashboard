import { create } from 'zustand';

const useAppStore = create((set) => ({
  // Theme state
  isDark: true,
  setIsDark: (val) => set({ isDark: val }),

  // ROS Connection state
  rosObj: null,
  setRosObj: (ros) => set({ rosObj: ros }),
  rosStatus: 'Disconnected',
  setRosStatus: (status) => set({ rosStatus: status }),

  // Simulation Config
  activeWorld: 'room.json',
  setActiveWorld: (world) => set({ activeWorld: world }),
  activeRobot: 'tango.urdf',
  setActiveRobot: (robot) => set({ activeRobot: robot }),
  urdf: null,
  setUrdf: (urdf) => set({ urdf: urdf }),
  
  // Map Config
  mapName: '',
  setMapName: (name) => set({ mapName: name }),
  mapData: null,
  setMapData: (data) => set({ mapData: data }),
  mapStatus: 'idle',
  setMapStatus: (status) => set({ mapStatus: status }),

  // Robot Pose
  pose: { x: '-', y: '-', theta: '-' },
  setPose: (pose) => set({ pose: pose }),
  isWaitingOdom: false,
  setIsWaitingOdom: (val) => set({ isWaitingOdom: val }),

  // Monitor toggle
  showMonitor: false,
  setShowMonitor: (val) => set({ showMonitor: val }),
  
  // App Version
  appVersion: '0.2.0',
  setAppVersion: (ver) => set({ appVersion: ver }),
  isSpinningUpdate: false,
  setIsSpinningUpdate: (val) => set({ isSpinningUpdate: val }),
}));

export default useAppStore;
