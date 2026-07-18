// map-server.cjs  — run manually: node map-server.cjs
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Detect ROS 2 Distro (Humble, Jazzy, Lyrical)
// ─────────────────────────────────────────────────────────────────────────────
let rosDistro = process.env.ROS_DISTRO;
if (!rosDistro) {
  // ไล่เช็คเวอร์ชันที่มีอยู่ในเครื่อง
  const supportedDistros = ['lyrical', 'jazzy', 'humble'];
  for (const distro of supportedDistros) {
    if (fs.existsSync(`/opt/ros/${distro}/setup.bash`)) {
      rosDistro = distro;
      break;
    }
  }
}
if (!rosDistro) rosDistro = 'jazzy'; // Fallback ค่าเริ่มต้น

const ROS_SETUP_BASH = `/opt/ros/${rosDistro}/setup.bash`;
const ROS_BIN_PATH   = `/opt/ros/${rosDistro}/bin`;

let WS_SETUP_BASH = '/opt/irish-amr-sim/simamr_ws/setup.bash';

if (process.env.AMR_WS_SETUP) {
    WS_SETUP_BASH = process.env.AMR_WS_SETUP;
} else {
    // Try candidate paths in order of priority
    const candidates = [
        '/opt/irish-amr-sim/simamr_ws/setup.bash',
        '/opt/irish-amr-sim/simamr_ws/install/setup.bash',
        '/opt/irish-amr-simulator/ros2_ws/install/setup.bash',
        path.join(os.homedir(), 'simamr_ws', 'install', 'setup.bash'),
        path.join(os.homedir(), 'simamr_ws', 'setup.bash'),
    ];
    for (const cand of candidates) {
        if (fs.existsSync(cand)) {
            WS_SETUP_BASH = cand;
            break;
        }
    }
}

console.log(`[INIT] Detected ROS 2 Distro: ${rosDistro}`);
console.log(`[INIT] Workspace Setup Path: ${WS_SETUP_BASH}`);

// ─────────────────────────────────────────────────────────────────────────────
// Express Setup
// ─────────────────────────────────────────────────────────────────────────────
const app = express();
const PORT = 3001;
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let currentState = {
  robot: 'amr.urdf',
  world: 'room.json',
  status: 'idle',   // idle | launching | running | stopping | error
  pid: null,
  launchedAt: null,
  error: null,
};

let rosProcess = null;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function getShareDir() {
  try {
    return execSync(
      'ros2 pkg prefix amr_2dsim --share',
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${process.env.PATH}:${ROS_BIN_PATH}`,
        },
      }
    ).trim();
  } catch (err) {
    console.error('ros2 pkg prefix failed:', err.message);
    return null;
  }
}

function getWorldFiles(shareDir) {
  const dirs = [path.join(shareDir, 'worlds')];
  const srcWorldsDir = path.join(os.homedir(), 'simamr_ws', 'src', 'amr_2dsim', 'worlds');
  if (fs.existsSync(srcWorldsDir)) dirs.push(srcWorldsDir);
  const fallbackWorldsDir = path.join(os.homedir(), '.config', 'irish-amr-sim', 'worlds');
  if (fs.existsSync(fallbackWorldsDir)) dirs.push(fallbackWorldsDir);

  const seen = new Set();
  const results = [];

  for (const worldsDir of dirs) {
    if (!fs.existsSync(worldsDir)) continue;
    fs.readdirSync(worldsDir).filter(f => f.endsWith('.json')).forEach(f => {
      if (seen.has(f)) return;
      seen.add(f);
      const fullPath = path.join(worldsDir, f);
      let stat;
      try { stat = fs.statSync(fullPath); } catch (e) { return; }
      
      let mapName = f;
      try {
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        mapName = data.name ?? path.parse(f).name;
      } catch (e) { /* keep filename */ }

      results.push({
        name: f,
        mapName,
        fullPath,
        sizeKB: (stat.size / 1024).toFixed(2),
        modified: stat.mtime.toISOString(),
        url: `http://localhost:${PORT}/map?file=${f}`,
      });
    });
  }
  return results;
}

function getRobotFiles(shareDir) {
  const dirs = [path.join(shareDir, 'urdf')];
  const srcUrdfDir = path.join(os.homedir(), 'simamr_ws', 'src', 'amr_2dsim', 'urdf');
  if (fs.existsSync(srcUrdfDir)) dirs.push(srcUrdfDir);
  const fallbackUrdfDir = path.join(os.homedir(), '.config', 'irish-amr-sim', 'urdf');
  if (fs.existsSync(fallbackUrdfDir)) dirs.push(fallbackUrdfDir);

  const seen = new Set();
  const results = [];

  for (const urdfDir of dirs) {
    if (!fs.existsSync(urdfDir)) continue;
    fs.readdirSync(urdfDir).filter(f => f.endsWith('.urdf') || f.endsWith('.xacro')).forEach(f => {
      if (seen.has(f)) return;
      seen.add(f);
      const fullPath = path.join(urdfDir, f);
      let stat;
      try { stat = fs.statSync(fullPath); } catch (e) { return; }
      let robotName = path.parse(f).name;
      try {
        const xml = fs.readFileSync(fullPath, 'utf8');
        const match = xml.match(/robot\s+name="([^"]+)"/);
        if (match) robotName = match[1];
      } catch (e) { /* keep filename */ }
      results.push({
        name: f,
        robotName,
        fullPath,
        sizeKB: (stat.size / 1024).toFixed(2),
        modified: stat.mtime.toISOString(),
      });
    });
  }
  return results;
}

function forceKillOrphans() {
  try {
    execSync('fuser -k -9 9090/tcp', { stdio: 'ignore' });
  } catch { /* ignored */ }

  const patterns = ['ros2 launch', 'amr_sim_node', 'robot_state_publisher', 'rosbridge', 'sim_bringup.launch.py'];
  patterns.forEach((p) => {
    try {
      execSync(`pkill -9 -f "${p}"`, { stdio: 'ignore' });
      console.log(`pkill -9 -f "${p}" matched`);
    } catch {
      // exit code 1 = nothing matched, not an error
    }
  });
}

function killRosProcess() {
  return new Promise((resolve) => {
    const finish = () => {
      forceKillOrphans();
      rosProcess = null;
      console.log('ROS stopped (orphan sweep included)');
      resolve();
    };

    if (!rosProcess) {
      console.log('ℹ No tracked process — sweeping orphans anyway');
      finish();
      return;
    }

    console.log(`🔴 Stopping ROS  PID=${rosProcess.pid} ...`);
    currentState.status = 'stopping';

    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; finish(); } };

    rosProcess.once('exit', done);

    try {
      process.kill(-rosProcess.pid, 'SIGINT');
    } catch (e) {
      console.warn('   SIGINT failed:', e.message);
      done();
      return;
    }

    setTimeout(() => {
      if (!resolved) {
        console.warn('Force killing ROS process group...');
        try { process.kill(-rosProcess.pid, 'SIGKILL'); } catch { }
        done();
      }
    }, 2000);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Launch ROS
// ─────────────────────────────────────────────────────────────────────────────
function launchRos(shareDir, urdfPath, worldPath) {
  
  console.log('\n' + '═'.repeat(55));
  console.log('🚀 launchRos() called [MULTI-DISTRO READY]');
  console.log('═'.repeat(55));
  console.log(`Distro    : ${rosDistro}`);
  console.log(`shareDir  : ${shareDir}`);
  console.log(`urdfPath  : ${urdfPath}`);
  console.log(`worldPath : ${worldPath}`);
  console.log(`urdf exists  : ${fs.existsSync(urdfPath)}`);
  console.log(`world exists : ${fs.existsSync(worldPath)}`);

  if (!fs.existsSync(urdfPath)) {
    console.error(`URDF not found: ${urdfPath}`);
    currentState.status = 'error';
    currentState.error = `URDF not found: ${urdfPath}`;
    return;
  }
  if (!fs.existsSync(worldPath)) {
    console.error(`World not found: ${worldPath}`);
    currentState.status = 'error';
    currentState.error = `World not found: ${worldPath}`;
    return;
  }

  const shellCmd =
    `source ${ROS_SETUP_BASH} && ` +
    `source ${WS_SETUP_BASH} && ` +
    `ros2 launch amr_2dsim sim_bringup.launch.py ` +
    `urdf_file:=${urdfPath} ` +
    `world_file:=${worldPath}`;

  console.log('\n Shell command:');
  console.log(`  ${shellCmd}`);
  console.log('');



  rosProcess = spawn('bash', ['-c', shellCmd], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: `${process.env.PATH}:${ROS_BIN_PATH}`,
      AMR_MAP_FILE: worldPath,
      AMR_URDF_FILE: urdfPath,
    },
  });

  rosProcess.stdout.on('data', (d) => {
    const lines = d.toString().split('\n').filter(l => l.trim());
    lines.forEach(l => console.log(`[ROS stdout] ${l}`));
  });

  rosProcess.stderr.on('data', (d) => {
    const lines = d.toString().split('\n').filter(l => l.trim());
    lines.forEach(l => console.error(`[ROS stderr] ${l}`));
  });

  rosProcess.on('exit', (code, signal) => {
    console.log('\n' + '─'.repeat(40));
    console.log(`[ROS] Process EXITED`);
    console.log(`      code   = ${code ?? 'null'}`);
    console.log(`      signal = ${signal ?? 'null'}`);
    console.log('─'.repeat(40));

    if (code === 1) {
      console.error('ROS launch failed (code 1)');
      console.error('   → Check: Was the .deb package installed completely?');
      console.error('   → Check: Are all dependencies listed in control file?');
    }
    if (code === 2) {
      console.error('ROS launch argument error (code 2)');
      console.error('   → Check: urdf_file / world_file args accepted?');
      console.error(`   → Run: ros2 launch amr_2dsim sim_bringup.launch.py --show-args`);
    }

    if (currentState.status !== 'stopping') {
      currentState.status = code === 0 ? 'idle' : 'error';
    } else {
      currentState.status = 'idle';
    }
    currentState.pid = null;
    rosProcess = null;
  });

  rosProcess.on('error', (err) => {
    console.error(`[ROS] spawn error: ${err.message}`);
    currentState.status = 'error';
    currentState.error = err.message;
    rosProcess = null;
  });

  currentState.pid = rosProcess.pid;
  currentState.status = 'running';
  currentState.launchedAt = new Date().toISOString();
  currentState.error = null;

  console.log(`Spawned  PID=${rosProcess.pid}`);
  console.log('   Waiting for ROS nodes to start...\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

// GET /map
app.get('/map', (req, res) => {
  const shareDir = getShareDir();
  if (!shareDir) return res.status(500).json({ error: 'Cannot resolve ROS package' });

  const fileName = req.query.file ?? currentState.world;
  if (!fileName.endsWith('.json') || fileName.includes('/') || fileName.includes('..'))
    return res.status(400).json({ error: 'Invalid file name' });

  const worldFiles = getWorldFiles(shareDir);
  const fileObj = worldFiles.find(w => w.name === fileName);
  if (!fileObj)
    return res.status(404).json({ error: `${fileName} not found` });
  const mapPath = fileObj.fullPath;
  try {
    const data = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    const mapName = data.name ?? path.parse(mapPath).name;
    res.json({
      ...data,
      _meta: {
        mapName,
        fileName: path.basename(mapPath),
        fullPath: mapPath,
        fetchedAt: new Date().toISOString(),
      },
    });
    console.log(`/map → "${mapName}" (${fileName})`);
  } catch (err) {
    res.status(500).json({ error: `JSON parse error: ${err.message}` });
  }
});

// GET /worlds
app.get('/worlds', (req, res) => {
  const shareDir = getShareDir();
  if (!shareDir) return res.status(500).json({ error: 'Cannot resolve ROS package' });
  const worlds = getWorldFiles(shareDir);
  res.json({ worldsDir: path.join(shareDir, 'worlds'), count: worlds.length, worlds });
  console.log(`/worlds → ${worlds.length} files`);
});

// GET /robots
app.get('/robots', (req, res) => {
  const shareDir = getShareDir();
  if (!shareDir) return res.status(500).json({ error: 'Cannot resolve ROS package' });
  const robots = getRobotFiles(shareDir);
  res.json({ urdfDir: path.join(shareDir, 'urdf'), count: robots.length, robots });
  console.log(`/robots → ${robots.length} files`);
});

// GET /urdf?file=tango.urdf
app.get('/urdf', (req, res) => {
  const shareDir = getShareDir();
  if (!shareDir) return res.status(500).json({ error: 'Cannot resolve ROS package' });

  const fileName = req.query.file ?? currentState.robot;
  if (
    (!fileName.endsWith('.urdf') && !fileName.endsWith('.xacro')) ||
    fileName.includes('/') || fileName.includes('..')
  ) return res.status(400).json({ error: 'Invalid file name' });

  const robotFiles = getRobotFiles(shareDir);
  const fileObj = robotFiles.find(r => r.name === fileName);
  if (!fileObj) return res.status(404).json({ error: `${fileName} not found` });
  const urdfPath = fileObj.fullPath;

  res.setHeader('Content-Type', 'application/xml');
  res.send(fs.readFileSync(urdfPath, 'utf8'));
  console.log(`/urdf → ${urdfPath}`);
});

// POST /api/robots
app.post('/api/robots', (req, res) => {
  const shareDir = getShareDir();
  if (!shareDir) return res.status(500).json({ error: 'Cannot resolve ROS package' });

  const {
    name, kinematic_model,
    // Geometry
    geometry_type = 'rectangle',
    body_length_x = 0.70, body_width_y = 0.50,
    body_size = 0.70,
    body_radius = 0.35,
    body_height = 0.20,
    // Wheels
    wheel_base = 0.5, axle_track,
    wheel_radius = 0.05, wheel_width = 0.03,
    // Lidar
    lidar_x = 0.0, lidar_y = 0.0, lidar_height = 0.1,
    lidar_radius = 0.05, lidar_range_max = 12.0,
    // Sim
    ticks_per_meter = 2000,
    omni_wheel_count = 3,
    // Visual
    color
  } = req.body;

  if (!name || !kinematic_model) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // Sanitize filename
  const fileName = `${name.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}.urdf`;
  const urdfPath = path.join(shareDir, 'urdf', fileName);

  if (fs.existsSync(urdfPath)) {
    return res.status(400).json({ error: 'Robot with this name already exists' });
  }

  // Parse color hex → URDF rgba
  let rgba = '0.0 0.3 1.0 1.0';
  if (color && /^#[0-9A-F]{6}$/i.test(color)) {
    const r = (parseInt(color.slice(1, 3), 16) / 255).toFixed(2);
    const g = (parseInt(color.slice(3, 5), 16) / 255).toFixed(2);
    const b = (parseInt(color.slice(5, 7), 16) / 255).toFixed(2);
    rgba = `${r} ${g} ${b} 1.0`;
  }

  const bodyZ = parseFloat(body_height).toFixed(3);
  const bodyZHalf = (parseFloat(body_height) / 2).toFixed(3);

  // Derive geometry-specific values and effective robot_radius
  let bodyGeomXML, robot_radius;
  if (geometry_type === 'circle') {
    const r = parseFloat(body_radius);
    robot_radius = r;
    bodyGeomXML = `<cylinder radius="${r.toFixed(3)}" length="${bodyZ}" />`;
  } else if (geometry_type === 'square') {
    const s = parseFloat(body_size);
    const r = parseFloat(body_radius);
    robot_radius = r;
    bodyGeomXML = `<cylinder radius="${r.toFixed(3)}" length="${bodyZ}" />`;
  } else if (geometry_type === 'square') {
    const s = parseFloat(body_size);
    robot_radius = s / 2;
    bodyGeomXML = `<box size="${s.toFixed(3)} ${s.toFixed(3)} ${bodyZ}" />`;
  } else { // rectangle
    const lx = parseFloat(body_length_x);
    const wy = parseFloat(body_width_y);
    robot_radius = Math.sqrt((lx / 2) ** 2 + (wy / 2) ** 2);
    bodyGeomXML = `<box size="${lx.toFixed(3)} ${wy.toFixed(3)} ${bodyZ}" />`;
  }

  // Effective axle track
  const effectiveAxleTrack = axle_track ?? (robot_radius * 1.6);

  const urdfContent = `<?xml version="1.0"?>
<robot name="${name}">

  <!-- AMR Simulation Config -->
  <amr_sim_config>
    <kinematic_model>${kinematic_model}</kinematic_model>
    <geometry_type>${geometry_type}</geometry_type>
    <wheel_base>${parseFloat(wheel_base).toFixed(3)}</wheel_base>
    <axle_track>${parseFloat(effectiveAxleTrack).toFixed(3)}</axle_track>
    <robot_radius>${parseFloat(robot_radius).toFixed(3)}</robot_radius>
    <wheel_radius>${parseFloat(wheel_radius).toFixed(4)}</wheel_radius>
    <wheel_width>${parseFloat(wheel_width).toFixed(4)}</wheel_width>
    <laser_range_max>${parseFloat(lidar_range_max).toFixed(1)}</laser_range_max>
    <laser_x>${parseFloat(lidar_x).toFixed(3)}</laser_x>
    <laser_y>${parseFloat(lidar_y).toFixed(3)}</laser_y>
    <laser_height>${parseFloat(lidar_height).toFixed(3)}</laser_height>
    <ticks_per_meter>${parseFloat(ticks_per_meter).toFixed(1)}</ticks_per_meter>
    ${kinematic_model === 'omni' ? `<omni_wheel_count>${parseInt(omni_wheel_count, 10)}</omni_wheel_count>` : ''}
  </amr_sim_config>

  <material name="body_color">
    <color rgba="${rgba}" />
  </material>

  <!-- Body (${geometry_type}) -->
  <link name="base_link">
    <visual>
      <origin xyz="0 0 ${bodyZHalf}" rpy="0 0 0" />
      <geometry>
        ${bodyGeomXML}
      </geometry>
      <material name="body_color" />
    </visual>
  </link>

  <!-- LiDAR sensor -->
  <link name="laser_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <cylinder radius="${parseFloat(lidar_radius).toFixed(3)}" length="${parseFloat(lidar_height).toFixed(3)}" />
      </geometry>
      <material name="lidar_color">
        <color rgba="0.1 0.1 0.1 1.0" />
      </material>
    </visual>
  </link>

  <joint name="laser_joint" type="fixed">
    <parent link="base_link" />
    <child link="laser_link" />
    <origin xyz="${parseFloat(lidar_x).toFixed(3)} ${parseFloat(lidar_y).toFixed(3)} ${(parseFloat(body_height) + parseFloat(lidar_height) / 2).toFixed(3)}" rpy="0 0 0" />
  </joint>

</robot>`;

  try {
    let savedAnywhere = false;
    try {
      fs.writeFileSync(urdfPath, urdfContent);
      console.log(`Created new robot URDF: ${urdfPath}`);
      savedAnywhere = true;
    } catch(e) {
      console.warn(`[create_robot] Could not save to shareDir: ${e.message}`);
    }

    const srcUrdfDir = path.join(os.homedir(), 'simamr_ws', 'src', 'amr_2dsim', 'urdf');
    if (fs.existsSync(srcUrdfDir)) {
      const srcUrdfPath = path.join(srcUrdfDir, fileName);
      fs.writeFileSync(srcUrdfPath, urdfContent);
      console.log(`[create_robot] Saved to source: ${srcUrdfPath}`);
      savedAnywhere = true;
    } else {
      const fallbackUrdfDir = path.join(os.homedir(), '.config', 'irish-amr-sim', 'urdf');
      if (!fs.existsSync(fallbackUrdfDir)) fs.mkdirSync(fallbackUrdfDir, { recursive: true });
      const fallbackUrdfPath = path.join(fallbackUrdfDir, fileName);
      fs.writeFileSync(fallbackUrdfPath, urdfContent);
      console.log(`[create_robot] Saved to fallback: ${fallbackUrdfPath}`);
      savedAnywhere = true;
    }
    
    if (!savedAnywhere) {
      return res.status(500).json({ error: 'Filesystem is read-only and source workspace not found.' });
    }
    res.json({ success: true, file: fileName, message: 'Robot created successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to write URDF file' });
  }
});

// DELETE /api/robots/:fileName
app.delete('/api/robots/:fileName', (req, res) => {
  const { fileName } = req.params;
  if (!fileName || (!fileName.endsWith('.urdf') && !fileName.endsWith('.xacro')) || fileName.includes('/') || fileName.includes('..')) {
    return res.status(400).json({ error: 'Invalid file name' });
  }

  let deletedAny = false;

  const shareDir = getShareDir();
  if (shareDir) {
    const filePath = path.join(shareDir, 'urdf', fileName);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); deletedAny = true; } catch (e) { console.error(e); }
    }
  }

  const srcUrdfDir = path.join(os.homedir(), 'simamr_ws', 'src', 'amr_2dsim', 'urdf');
  if (fs.existsSync(srcUrdfDir)) {
    const srcPath = path.join(srcUrdfDir, fileName);
    if (fs.existsSync(srcPath)) {
      try { fs.unlinkSync(srcPath); deletedAny = true; } catch (e) { console.error(e); }
    }
  }

  const fallbackUrdfDir = path.join(os.homedir(), '.config', 'irish-amr-sim', 'urdf');
  if (fs.existsSync(fallbackUrdfDir)) {
    const fallbackPath = path.join(fallbackUrdfDir, fileName);
    if (fs.existsSync(fallbackPath)) {
      try { fs.unlinkSync(fallbackPath); deletedAny = true; } catch (e) { console.error(e); }
    }
  }

  if (deletedAny) {
    console.log(`Deleted robot URDF: ${fileName}`);
    res.json({ success: true, message: 'Robot deleted successfully' });
  } else {
    res.status(404).json({ error: 'File not found or could not be deleted' });
  }
});

// GET /api/worlds/:fileName
app.get('/api/worlds/:fileName', (req, res) => {
  const shareDir = getShareDir();
  if (!shareDir) return res.status(500).json({ error: 'Cannot resolve ROS package' });
  const { fileName } = req.params;
  if (!fileName || !fileName.endsWith('.json') || fileName.includes('/') || fileName.includes('..')) {
    return res.status(400).json({ error: 'Invalid file name' });
  }
  const filePath = path.join(shareDir, 'worlds', fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to read world file' });
  }
});

// DELETE /api/worlds/:fileName
app.delete('/api/worlds/:fileName', (req, res) => {
  let deletedAny = false;

  const shareDir = getShareDir();
  if (shareDir) {
    const filePath = path.join(shareDir, 'worlds', fileName);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); deletedAny = true; } catch (e) { console.error(e); }
    }
  }

  const srcWorldsDir = path.join(os.homedir(), 'simamr_ws', 'src', 'amr_2dsim', 'worlds');
  if (fs.existsSync(srcWorldsDir)) {
    const srcPath = path.join(srcWorldsDir, fileName);
    if (fs.existsSync(srcPath)) {
      try { fs.unlinkSync(srcPath); deletedAny = true; } catch (e) { console.error(e); }
    }
  }

  const fallbackWorldsDir = path.join(os.homedir(), '.config', 'irish-amr-sim', 'worlds');
  if (fs.existsSync(fallbackWorldsDir)) {
    const fallbackPath = path.join(fallbackWorldsDir, fileName);
    if (fs.existsSync(fallbackPath)) {
      try { fs.unlinkSync(fallbackPath); deletedAny = true; } catch (e) { console.error(e); }
    }
  }

  if (deletedAny) {
    console.log(`Deleted world map: ${fileName}`);
    res.json({ success: true, message: 'World deleted successfully' });
  } else {
    res.status(404).json({ error: 'File not found or could not be deleted' });
  }
});




// GET /status
app.get('/status', (req, res) => {
  res.json({
    ...currentState,
    rosRunning: rosProcess !== null,
  });
});

// POST /switch  { robot: "tango.urdf", world: "room.json" }
app.post('/switch', async (req, res) => {
  const { robot, world } = req.body ?? {};

  if (!robot || !world)
    return res.status(400).json({ error: 'robot and world are required' });

  if (robot.includes('/') || robot.includes('..') ||
    world.includes('/') || world.includes('..'))
    return res.status(400).json({ error: 'Invalid file name' });

  if (!robot.endsWith('.urdf') && !robot.endsWith('.xacro'))
    return res.status(400).json({ error: 'robot must be .urdf or .xacro' });

  if (!world.endsWith('.json'))
    return res.status(400).json({ error: 'world must be .json' });

  const shareDir = getShareDir();
  if (!shareDir)
    return res.status(500).json({ error: 'Cannot resolve ROS package' });

  const rObj = getRobotFiles(shareDir).find(r => r.name === robot);
  const wObj = getWorldFiles(shareDir).find(w => w.name === world);
  if (!rObj) return res.status(404).json({ error: `Robot file not found: ${robot}` });
  if (!wObj) return res.status(404).json({ error: `World file not found: ${world}` });
  const urdfPath = rObj.fullPath;
  const worldPath = wObj.fullPath;

  if (
    currentState.robot === robot &&
    currentState.world === world &&
    currentState.status === 'running' &&
    rosProcess !== null
  ) {
    return res.json({
      ok: true,
      message: 'Already running with this configuration',
      state: currentState,
    });
  }

  currentState.status = 'launching';
  currentState.robot = robot;
  currentState.world = world;

  res.json({
    ok: true,
    message: `Switching → robot="${robot}"  world="${world}"`,
    state: currentState,
  });

  try {
    await killRosProcess();
    await new Promise(r => setTimeout(r, 1500));
    launchRos(shareDir, urdfPath, worldPath);
  } catch (err) {
    console.error('Switch failed:', err.message);
    currentState.status = 'error';
    currentState.error = err.message;
  }
});

// POST /save_map  { filename: 'custom_map.json', data: { ... } }
app.post('/save_map', (req, res) => {
  const { filename, data } = req.body;

  if (!filename || !data)
    return res.status(400).json({ ok: false, message: 'Missing filename or map data.' });

  const safeName = path.basename(filename);
  if (!safeName.endsWith('.json'))
    return res.status(400).json({ ok: false, message: 'Filename must end with .json' });

  const shareDir = getShareDir();
  if (!shareDir)
    return res.status(500).json({ ok: false, message: 'Cannot resolve ROS package' });

  const savePath = path.join(shareDir, 'worlds', safeName);

  try {
    let savedAnywhere = false;
    try {
      const dir = path.dirname(savePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(savePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[save_map] Saved to shareDir: ${savePath}`);
      savedAnywhere = true;
    } catch(e) {
      console.warn(`[save_map] Could not save to shareDir: ${e.message}`);
    }

    const srcWorldsDir = path.join(os.homedir(), 'simamr_ws', 'src', 'amr_2dsim', 'worlds');
    if (fs.existsSync(srcWorldsDir)) {
      const srcSavePath = path.join(srcWorldsDir, safeName);
      fs.writeFileSync(srcSavePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[save_map] Saved to source: ${srcSavePath}`);
      savedAnywhere = true;
    } else {
      const fallbackWorldsDir = path.join(os.homedir(), '.config', 'irish-amr-sim', 'worlds');
      if (!fs.existsSync(fallbackWorldsDir)) fs.mkdirSync(fallbackWorldsDir, { recursive: true });
      const fallbackSavePath = path.join(fallbackWorldsDir, safeName);
      fs.writeFileSync(fallbackSavePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[save_map] Saved to fallback: ${fallbackSavePath}`);
      savedAnywhere = true;
    }

    if (!savedAnywhere) {
       throw new Error("Filesystem is read-only and source workspace not found.");
    }
    res.json({ ok: true, message: `Saved successfully` });
  } catch (err) {
    console.error(`[save_map] ${err.message}`);
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /stop
app.post('/stop', async (req, res) => {
  await killRosProcess();
  currentState.status = 'idle';
  res.json({ ok: true, message: 'ROS stopped' });
});

// GET /health
app.get('/health', (_req, res) => {
  const shareDir = getShareDir();
  res.json({
    status: 'ok',
    shareDir: shareDir ?? 'not found',
    rosRunning: rosProcess !== null,
    current: currentState,
    worlds: shareDir ? getWorldFiles(shareDir).map(w => w.name) : [],
    robots: shareDir ? getRobotFiles(shareDir).map(r => r.name) : [],
  });
});

// GET /files
function walkDir(dirPath, baseDir) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;
  fs.readdirSync(dirPath, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, baseDir));
    } else {
      const stat = fs.statSync(fullPath);
      results.push({
        name: entry.name,
        relativePath: path.relative(baseDir, fullPath),
        fullPath,
        sizeKB: (stat.size / 1024).toFixed(2),
        modified: stat.mtime.toISOString(),
        ext: path.extname(entry.name),
      });
    }
  });
  return results;
}

app.get('/files', (req, res) => {
  const shareDir = getShareDir();
  if (!shareDir) return res.status(404).json({ error: 'Package share dir not found' });
  const files = walkDir(shareDir, shareDir);
  res.json({ shareDir, totalFiles: files.length, files });
});

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────
async function shutdown(sig) {
  console.log(`\n${sig} received — shutting down...`);
  await killRosProcess();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   AMR Map Server  –  port 3001                       ║');
  console.log('║                                                      ║');
  console.log('║   GET  /map?file=room.json                           ║');
  console.log('║   GET  /worlds                                       ║');
  console.log('║   GET  /robots                                       ║');
  console.log('║   GET  /urdf?file=tango.urdf                         ║');
  console.log('║   GET  /status                                       ║');
  console.log('║   GET  /health                                       ║');
  console.log('║   POST /switch  { robot, world }                     ║');
  console.log('║   POST /stop                                         ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  const shareDir = getShareDir();
  if (!shareDir) {
    console.warn('⚠ ROS package not found. Run:');
    console.warn(`   source ${WS_SETUP_BASH}\n`);
    return;
  }

  console.log(`Package : ${shareDir}`);

  const worlds = getWorldFiles(shareDir);
  console.log(`\n Worlds (${worlds.length}):`);
  worlds.forEach(w =>
    console.log(`   ${w.name.padEnd(22)} "${w.mapName}"`)
  );

  const robots = getRobotFiles(shareDir);
  console.log(`\n Robots (${robots.length}):`);
  robots.forEach(r =>
    console.log(`   ${r.name.padEnd(22)} "${r.robotName}"`)
  );

  console.log('');
  console.log(' Start simulation from web UI or:');
  console.log(`   curl -X POST http://localhost:${PORT}/switch \\`);
  console.log(`        -H "Content-Type: application/json" \\`);
  console.log(`        -d '{"robot":"tango.urdf","world":"room.json"}'`);
  console.log('');
});

// ดักจับคำสั่ง Kill จาก Electron (หรือจากระบบปฏิบัติการ)
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gently...');
    if (typeof forceKillOrphans === 'function') {
        forceKillOrphans(); // เรียกใช้ฟังก์ชันเคลียร์ ROS เดิมของคุณ
    }
    process.exit(0);
});