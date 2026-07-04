// map-server.cjs  — run manually: node map-server.cjs
const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const fs           = require('fs');
const { execSync, spawn } = require('child_process');

const app  = express();
const PORT = 3001;
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let currentState = {
  robot:      'amr.urdf',
  world:      'room.json',
  status:     'idle',      // idle | launching | running | stopping | error
  pid:        null,
  launchedAt: null,
  error:      null,
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
          PATH: `${process.env.PATH}:/opt/ros/jazzy/bin`,
        },
      }
    ).trim();
  } catch (err) {
    console.error('❌ ros2 pkg prefix failed:', err.message);
    return null;
  }
}

function getWorldFiles(shareDir) {
  const worldsDir = path.join(shareDir, 'worlds');
  if (!fs.existsSync(worldsDir)) return [];
  return fs.readdirSync(worldsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const fullPath = path.join(worldsDir, f);
      const stat     = fs.statSync(fullPath);
      let   mapName  = f;
      try {
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        mapName    = data.name ?? path.parse(f).name;
      } catch { /* keep filename */ }
      return {
        name:     f,
        mapName,
        fullPath,
        sizeKB:   (stat.size / 1024).toFixed(2),
        modified: stat.mtime.toISOString(),
        url:      `http://localhost:${PORT}/map?file=${f}`,
      };
    });
}

function getRobotFiles(shareDir) {
  const urdfDir = path.join(shareDir, 'urdf');
  if (!fs.existsSync(urdfDir)) return [];
  return fs.readdirSync(urdfDir)
    .filter(f => f.endsWith('.urdf') || f.endsWith('.xacro'))
    .map(f => {
      const fullPath = path.join(urdfDir, f);
      const stat     = fs.statSync(fullPath);
      let   robotName = path.parse(f).name;
      try {
        const xml   = fs.readFileSync(fullPath, 'utf8');
        const match = xml.match(/robot\s+name="([^"]+)"/);
        if (match) robotName = match[1];
      } catch { /* keep filename */ }
      return {
        name: f,
        robotName,
        fullPath,
        sizeKB:   (stat.size / 1024).toFixed(2),
        modified: stat.mtime.toISOString(),
      };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Kill ROS process tree
// ─────────────────────────────────────────────────────────────────────────────
function killRosProcess() {
  return new Promise((resolve) => {
    if (!rosProcess) {
      console.log('ℹ️  No ROS process to kill');
      resolve();
      return;
    }

    console.log(`🔴 Stopping ROS  PID=${rosProcess.pid} ...`);
    currentState.status = 'stopping';

    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved   = true;
        rosProcess = null;
        console.log('✅ ROS process stopped');
        resolve();
      }
    };

    // Listen for exit before sending signal
    rosProcess.once('exit', done);

    // Send SIGTERM to the entire process group
    try {
      process.kill(-rosProcess.pid, 'SIGTERM');
    } catch (e) {
      console.warn('   SIGTERM failed:', e.message);
      done();
      return;
    }

    // Force kill after 4 s
    setTimeout(() => {
      if (!resolved) {
        console.warn('⚠️  Force killing with SIGKILL...');
        try { process.kill(-rosProcess.pid, 'SIGKILL'); } catch { /* dead */ }
        done();
      }
    }, 4000);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Launch ROS (sim_bringup.launch.py only — no map-server inside)
// ─────────────────────────────────────────────────────────────────────────────
// map-server.cjs  — replace launchRos() with this debug version

function launchRos(shareDir, robotFile, worldFile) {
  const urdfPath  = path.join(shareDir, 'urdf',   robotFile);
  const worldPath = path.join(shareDir, 'worlds', worldFile);

  // ── Pre-flight checks ────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(55));
  console.log('🚀 launchRos() called');
  console.log('═'.repeat(55));
  console.log(`   shareDir  : ${shareDir}`);
  console.log(`   urdfPath  : ${urdfPath}`);
  console.log(`   worldPath : ${worldPath}`);
  console.log(`   urdf exists  : ${fs.existsSync(urdfPath)}`);
  console.log(`   world exists : ${fs.existsSync(worldPath)}`);

  // ── Check files exist before launching ───────────────────────────────────
  if (!fs.existsSync(urdfPath)) {
    console.error(`❌ URDF not found: ${urdfPath}`);
    currentState.status = 'error';
    currentState.error  = `URDF not found: ${urdfPath}`;
    return;
  }
  if (!fs.existsSync(worldPath)) {
    console.error(`❌ World not found: ${worldPath}`);
    currentState.status = 'error';
    currentState.error  = `World not found: ${worldPath}`;
    return;
  }

  // ── Build shell command ───────────────────────────────────────────────────
  const shellCmd =
    `source /opt/ros/jazzy/setup.bash && ` +
    `source ~/robot_ws/install/setup.bash && ` +
    `ros2 launch amr_2dsim sim_bringup.launch.py ` +
    `urdf_file:=${urdfPath} ` +
    `world_file:=${worldPath}`;

  console.log('\n📋 Shell command:');
  console.log(`   ${shellCmd}`);
  console.log('');

  // ── Verify ros2 launch file exists in package ─────────────────────────────
  try {
    const launchCheck = execSync(
      'source /opt/ros/jazzy/setup.bash && ' +
      'source ~/robot_ws/install/setup.bash && ' +
      'ros2 launch amr_2dsim sim_bringup.launch.py --show-args',
      {
        encoding: 'utf8',
        shell:    '/bin/bash',
        env: {
          ...process.env,
          PATH: `${process.env.PATH}:/opt/ros/jazzy/bin`,
        },
      }
    );
    console.log('✅ Launch file found. Args:');
    console.log(launchCheck);
  } catch (err) {
    console.error('❌ Launch file check failed:');
    console.error(err.message);
    currentState.status = 'error';
    currentState.error  = `Launch file not accessible: ${err.message}`;
    return;
  }

  // ── Spawn ─────────────────────────────────────────────────────────────────
  rosProcess = spawn('bash', ['-c', shellCmd], {
    detached: true,
    stdio:    ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH:          `${process.env.PATH}:/opt/ros/jazzy/bin`,
      AMR_MAP_FILE:  worldPath,
      AMR_URDF_FILE: urdfPath,
    },
  });

  rosProcess.stdout.on('data', (d) => {
    // Print every line with [ROS] prefix
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
    console.log(`      code   = ${code   ?? 'null'}`);
    console.log(`      signal = ${signal ?? 'null'}`);
    console.log('─'.repeat(40));

    // ── Detect common failures ─────────────────────────────────────────────
    if (code === 1) {
      console.error('❌ ROS launch failed (code 1)');
      console.error('   → Check: colcon build ran successfully?');
      console.error('   → Check: all packages installed?');
    }
    if (code === 2) {
      console.error('❌ ROS launch argument error (code 2)');
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
    currentState.error  = err.message;
    rosProcess = null;
  });

  currentState.pid        = rosProcess.pid;
  currentState.status     = 'running';
  currentState.launchedAt = new Date().toISOString();
  currentState.error      = null;

  console.log(`✅ Spawned  PID=${rosProcess.pid}`);
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

  const mapPath = path.join(shareDir, 'worlds', fileName);
  if (!fs.existsSync(mapPath))
    return res.status(404).json({ error: `${fileName} not found`, tried: mapPath });

  try {
    const data    = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    const mapName = data.name ?? path.parse(mapPath).name;
    res.json({
      ...data,
      _meta: {
        mapName,
        fileName:  path.basename(mapPath),
        fullPath:  mapPath,
        fetchedAt: new Date().toISOString(),
      },
    });
    console.log(`📤 /map → "${mapName}" (${fileName})`);
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
  console.log(`📁 /worlds → ${worlds.length} files`);
});

// GET /robots
app.get('/robots', (req, res) => {
  const shareDir = getShareDir();
  if (!shareDir) return res.status(500).json({ error: 'Cannot resolve ROS package' });
  const robots = getRobotFiles(shareDir);
  res.json({ urdfDir: path.join(shareDir, 'urdf'), count: robots.length, robots });
  console.log(`🤖 /robots → ${robots.length} files`);
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

  const urdfPath = path.join(shareDir, 'urdf', fileName);
  if (!fs.existsSync(urdfPath))
    return res.status(404).json({
      error:     `${fileName} not found`,
      available: getRobotFiles(getShareDir() ?? '').map(f => f.name),
    });

  res.setHeader('Content-Type', 'application/xml');
  res.send(fs.readFileSync(urdfPath, 'utf8'));
  console.log(`📤 /urdf → ${urdfPath}`);
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

  // ── Validate ─────────────────────────────────────────────────────────────
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

  const urdfPath  = path.join(shareDir, 'urdf',   robot);
  const worldPath = path.join(shareDir, 'worlds', world);

  if (!fs.existsSync(urdfPath))
    return res.status(404).json({
      error:     `Robot file not found: ${robot}`,
      available: getRobotFiles(shareDir).map(f => f.name),
    });

  if (!fs.existsSync(worldPath))
    return res.status(404).json({
      error:     `World file not found: ${world}`,
      available: getWorldFiles(shareDir).map(f => f.name),
    });

  // ── Already same config? ──────────────────────────────────────────────────
  if (
    currentState.robot  === robot &&
    currentState.world  === world &&
    currentState.status === 'running' &&
    rosProcess !== null
  ) {
    return res.json({
      ok:      true,
      message: 'Already running with this configuration',
      state:   currentState,
    });
  }

  // ── Acknowledge immediately ───────────────────────────────────────────────
  currentState.status = 'launching';
  currentState.robot  = robot;
  currentState.world  = world;

  res.json({
    ok:      true,
    message: `Switching → robot="${robot}"  world="${world}"`,
    state:   currentState,
  });

  // ── Kill → wait → relaunch (async after response) ────────────────────────
  try {
    await killRosProcess();
    await new Promise(r => setTimeout(r, 1500));   // ports settle
    launchRos(shareDir, robot, world);
  } catch (err) {
    console.error('❌ Switch failed:', err.message);
    currentState.status = 'error';
    currentState.error  = err.message;
  }
});

// POST /stop
app.post('/stop', async (req, res) => {
  await killRosProcess();
  currentState.status = 'idle';
  res.json({ ok: true, message: '🛑 ROS stopped' });
});

// GET /health
app.get('/health', (_req, res) => {
  const shareDir = getShareDir();
  res.json({
    status:     'ok',
    shareDir:   shareDir ?? 'not found',
    rosRunning: rosProcess !== null,
    current:    currentState,
    worlds:     shareDir ? getWorldFiles(shareDir).map(w => w.name) : [],
    robots:     shareDir ? getRobotFiles(shareDir).map(r => r.name) : [],
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
        name:         entry.name,
        relativePath: path.relative(baseDir, fullPath),
        fullPath,
        sizeKB:       (stat.size / 1024).toFixed(2),
        modified:     stat.mtime.toISOString(),
        ext:          path.extname(entry.name),
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
process.on('SIGINT',  () => shutdown('SIGINT'));
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
    console.warn('⚠️  ROS package not found. Run:');
    console.warn('   source ~/robot_ws/install/setup.bash\n');
    return;
  }

  console.log(`📦 Package : ${shareDir}`);

  const worlds = getWorldFiles(shareDir);
  console.log(`\n🌍 Worlds (${worlds.length}):`);
  worlds.forEach(w =>
    console.log(`   ${w.name.padEnd(22)} "${w.mapName}"`)
  );

  const robots = getRobotFiles(shareDir);
  console.log(`\n🤖 Robots (${robots.length}):`);
  robots.forEach(r =>
    console.log(`   ${r.name.padEnd(22)} "${r.robotName}"`)
  );

  console.log('');
  console.log('💡 Start simulation from web UI or:');
  console.log(`   curl -X POST http://localhost:${PORT}/switch \\`);
  console.log(`        -H "Content-Type: application/json" \\`);
  console.log(`        -d \'{"robot":"tango.urdf","world":"room.json"}\'`);
  console.log('');
});