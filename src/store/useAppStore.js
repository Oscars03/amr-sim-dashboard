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
  activeRobot: 'amr.urdf',
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

  // Robot pose is NOT kept here -- /odom arrives at 20 Hz and a store write
  // re-renders every useAppStore() subscriber. It lives in a ref in
  // DashboardView and is read straight off it by the canvas / PoseReadout.
  isWaitingOdom: false,
  setIsWaitingOdom: (val) => set({ isWaitingOdom: val }),

  // Monitor toggle
  showMonitor: false,
  setShowMonitor: (val) => set({ showMonitor: val }),

  // FPS Limit (20=low-power, 60, 0=unlimited)
  fpsLimit: 20,
  setFpsLimit: (val) => set({ fpsLimit: val }),

  // Environment Check
  envData: null,
  setEnvData: (data) => set({ envData: data }),
  showEnvModal: false,
  setShowEnvModal: (val) => set({ showEnvModal: val }),

  // Spawn Pose Config { x: 0, y: 0, yaw: 0 } (yaw in degrees)
  spawnPose: { x: 0, y: 0, yaw: 0 },
  setSpawnPose: (pose) => set({ spawnPose: pose }),

  // Shortcuts Modal
  showShortcuts: false,
  setShowShortcuts: (val) => set({ showShortcuts: val }),
}));

export default useAppStore;
