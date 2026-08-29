// ─────────────────────────────────────────────────────────────────────────────
// server/server.js  —  AMR 2D Sim Map Server
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const cors    = require('cors');
const { exec, spawn } = require('child_process');

const app  = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── Resolve package paths ────────────────────────────────────────────────────
// Works whether you run from repo root or from server/
const PKG_ROOT      = path.resolve(__dirname, '..');   // → amr_2dsim/
const WORLDS_DIR    = path.join(PKG_ROOT, 'worlds');
const URDF_DIR      = path.join(PKG_ROOT, 'urdf');
const ROS2_WS       = process.env.ROS2_WORKSPACE || path.resolve(PKG_ROOT, '..', '..'); // → robot_ws/
const LAUNCH_FILE   = path.join(PKG_ROOT, 'launch', 'sim_bringup.launch.py');

// ─── Sim process state ────────────────────────────────────────────────────────
let simProc   = null;
let simStatus = { status: 'idle', robot: '', world: '' };

// ═════════════════════════════════════════════════════════════════════════════
// GET /map?file=room.json
// ═════════════════════════════════════════════════════════════════════════════
app.get('/map', (req, res) => {
  const file     = path.basename(req.query.file || 'room.json');
  const filePath = path.join(WORLDS_DIR, file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `Map not found: ${file}` });
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /worlds  →  list all .json files in worlds/
// ═════════════════════════════════════════════════════════════════════════════
app.get('/worlds', (req, res) => {
  try {
    const files = fs.readdirSync(WORLDS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const raw     = JSON.parse(fs.readFileSync(path.join(WORLDS_DIR, f), 'utf8'));
          const mapName = raw._meta?.mapName ?? raw.name ?? f.replace(/\.json$/i, '');
          return { name: f, mapName };
        } catch {
          return { name: f, mapName: f.replace(/\.json$/i, '') };
        }
      });
    res.json({ worlds: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /robots  →  list all .urdf files in urdf/
// ═════════════════════════════════════════════════════════════════════════════
app.get('/robots', (req, res) => {
  try {
    const files = fs.readdirSync(URDF_DIR)
      .filter(f => f.endsWith('.urdf'))
      .map(f => {
        try {
          const xml       = fs.readFileSync(path.join(URDF_DIR, f), 'utf8');
          const match     = xml.match(/<robot\s+name="([^"]+)"/);
          const robotName = match ? match[1] : f.replace(/\.urdf$/i, '');
          return { name: f, robotName };
        } catch {
          return { name: f, robotName: f.replace(/\.urdf$/i, '') };
        }
      });
    res.json({ robots: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /urdf?file=amr.urdf
// ═════════════════════════════════════════════════════════════════════════════
app.get('/urdf', (req, res) => {
  const file     = path.basename(req.query.file || 'amr.urdf');
  const filePath = path.join(URDF_DIR, file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('URDF not found');
  }
  res.setHeader('Content-Type', 'application/xml');
  res.send(fs.readFileSync(filePath, 'utf8'));
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /status
// ═════════════════════════════════════════════════════════════════════════════
app.get('/status', (req, res) => {
  res.json(simStatus);
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /switch  { robot: 'tango.urdf', world: 'room.json' }
// ═════════════════════════════════════════════════════════════════════════════
app.post('/switch', (req, res) => {
  const { robot, world } = req.body;
  if (!robot || !world) {
    return res.status(400).json({ ok: false, message: 'Missing robot or world' });
  }

  const urdfPath  = path.join(URDF_DIR,   path.basename(robot));
  const worldPath = path.join(WORLDS_DIR, path.basename(world));

  if (!fs.existsSync(urdfPath)) {
    return res.status(404).json({ ok: false, message: `URDF not found: ${robot}` });
  }
  if (!fs.existsSync(worldPath)) {
    return res.status(404).json({ ok: false, message: `World not found: ${world}` });
  }

  // Kill existing sim process
  if (simProc) {
    try { process.kill(-simProc.pid, 'SIGTERM'); } catch (_) {}
    simProc = null;
  }

  simStatus = { status: 'launching', robot, world };

  const cmd = [
    'ros2', 'launch', LAUNCH_FILE,
    `urdf_file:=${urdfPath}`,
    `world_file:=${worldPath}`,
  ];

  console.log('[switch] Launching:', cmd.join(' '));

  simProc = spawn(cmd[0], cmd.slice(1), {
    detached: true,
    stdio:    'inherit',
    env:      { ...process.env, ROS2_WORKSPACE: ROS2_WS },
  });

  simProc.on('error', (err) => {
    console.error('[switch] spawn error:', err.message);
    simStatus.status = 'error';
  });

  simProc.on('exit', (code) => {
    console.log('[switch] process exited, code:', code);
    simStatus.status = 'idle';
    simProc = null;
  });

  setTimeout(() => {
    if (simStatus.status === 'launching') simStatus.status = 'running';
  }, 5000);

  res.json({ ok: true, message: `Launching ${robot} in ${world}…` });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /stop
// ═════════════════════════════════════════════════════════════════════════════
app.post('/stop', (req, res) => {
  if (simProc) {
    try { process.kill(-simProc.pid, 'SIGTERM'); } catch (_) {}
    simProc = null;
  }
  simStatus = { status: 'idle', robot: '', world: '' };
  res.json({ ok: true, message: 'Simulation stopped' });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /save_map  { filename: 'custom_map.json', data: { ... } }
// ═════════════════════════════════════════════════════════════════════════════
app.post('/save_map', (req, res) => {
  const { filename, data } = req.body;

  if (!filename || !data) {
    return res.status(400).json({ ok: false, message: 'Missing filename or map data.' });
  }

  // Prevent path traversal attacks
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.json')) {
    return res.status(400).json({ ok: false, message: 'Filename must end with .json' });
  }

  const savePath = path.join(WORLDS_DIR, safeName);

  try {
    if (!fs.existsSync(WORLDS_DIR)) {
      fs.mkdirSync(WORLDS_DIR, { recursive: true });
    }
    fs.writeFileSync(savePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[save_map] ✅ Saved: ${savePath}`);
    res.json({ ok: true, message: `Saved to ${savePath}` });
  } catch (err) {
    console.error('[save_map] ❌', err.message);
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🗺️  Map server running at http://localhost:${PORT}`);
  console.log(`   Worlds dir : ${WORLDS_DIR}`);
  console.log(`   URDF dir   : ${URDF_DIR}\n`);
});