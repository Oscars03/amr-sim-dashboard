const fs = require('fs');
const file = '/home/phutanate/amr-sim-dashboard/src/App.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Replace RobotCreatorModal with RobotCreator
const newComponent = `// ─────────────────────────────────────────────────────────────────────────────
// RobotCreator
// ─────────────────────────────────────────────────────────────────────────────
function RobotCreator({ onExit, isDark, onCreated }) {
  const [form, setForm] = useState({
    name: '', kinematic_model: 'diff_drive', wheel_base: 0.5,
    robot_radius: 0.35, laser_range_max: 12.0, color: '#0044ff'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    let w = form.robot_radius * 2;
    let d = form.robot_radius * 2;
    if (form.kinematic_model === 'mecanum') { w = form.robot_radius * 2.2; d = form.robot_radius * 1.8; }
    if (form.kinematic_model === 'ackermann') { w = form.robot_radius * 2.8; d = form.robot_radius * 1.4; }

    const mockUrdf = {
      shapes: [ { type: 'box', w, d, ox: 0, oy: 0, yaw: 0, color: form.color } ],
      maxR: form.robot_radius,
      simConfig: { kinematic_model: form.kinematic_model }
    };

    let animationFrameId;
    let angle = 0;

    const render = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width; canvas.height = rect.height;
      }
      const width = canvas.width; const height = canvas.height;
      
      ctx.fillStyle = isDark ? '#111118' : '#e6e9ec';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = isDark ? '#333333' : '#cccccc';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = (width/2)%gridSize; x < width; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = (height/2)%gridSize; y < height; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
      
      const scale = 150 / (form.robot_radius || 0.1);
      angle += 0.01;
      drawRobot(ctx, width/2, height/2, angle, width/2, height/2, mockUrdf, scale, isDark, null);

      animationFrameId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, [form, isDark]);

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const res = await fetch('http://localhost:3001/api/robots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create robot');
      onCreated();
      onExit();
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const bg = isDark ? '#1e1e1e' : '#ffffff';
  const panelBg = isDark ? '#111118' : '#f5f5f5';
  const text = isDark ? '#eee' : '#222';
  const inputBg = isDark ? '#2d2d2d' : '#ffffff';
  const border = isDark ? '#444' : '#ccc';

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', background: panelBg }}>
      <div style={{ width: '400px', background: bg, borderRight: \`1px solid \${border}\`, display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
        <div style={{ padding: '20px', borderBottom: \`1px solid \${border}\`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '20px', color: text }}>Create New Robot</h2>
          <button onClick={onExit} style={{ background: 'transparent', border: 'none', color: isDark ? '#aaa' : '#666', cursor: 'pointer', fontSize: '18px' }}>✕</button>
        </div>
        <div style={{ padding: '20px', flex: 1 }}>
          {error && <div style={{ background: '#ffebee', color: '#c62828', padding: '12px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>{error}</div>}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <label style={{ fontSize: '13px', fontWeight: '600', color: text }}>
              Robot Name (e.g. my_robot)
              <input required type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                style={{ display: 'block', width: '100%', padding: '10px', marginTop: '6px', background: inputBg, border: \`1px solid \${border}\`, color: text, borderRadius: '8px' }} />
            </label>
            <label style={{ fontSize: '13px', fontWeight: '600', color: text }}>
              Kinematic Model
              <select value={form.kinematic_model} onChange={e => setForm({...form, kinematic_model: e.target.value})}
                style={{ display: 'block', width: '100%', padding: '10px', marginTop: '6px', background: inputBg, border: \`1px solid \${border}\`, color: text, borderRadius: '8px' }}>
                <option value="diff_drive">Differential Drive (2 Wheels)</option>
                <option value="mecanum">Mecanum Drive (4 Wheels)</option>
                <option value="omni">Omni-Directional (3 Wheels)</option>
                <option value="ackermann">Ackermann (Car Steering)</option>
              </select>
            </label>
            <label style={{ fontSize: '13px', fontWeight: '600', color: text }}>
              Robot Radius (m): {form.robot_radius}
              <input type="range" min="0.1" max="1.5" step="0.01" value={form.robot_radius} onChange={e => setForm({...form, robot_radius: parseFloat(e.target.value)})}
                style={{ display: 'block', width: '100%', marginTop: '6px' }} />
            </label>
            <label style={{ fontSize: '13px', fontWeight: '600', color: text }}>
              Wheel Base (m): {form.wheel_base}
              <input type="range" min="0.1" max="1.5" step="0.01" value={form.wheel_base} onChange={e => setForm({...form, wheel_base: parseFloat(e.target.value)})}
                style={{ display: 'block', width: '100%', marginTop: '6px' }} />
            </label>
            <label style={{ fontSize: '13px', fontWeight: '600', color: text }}>
              LiDAR Range (m): {form.laser_range_max}
              <input type="range" min="1.0" max="30.0" step="0.5" value={form.laser_range_max} onChange={e => setForm({...form, laser_range_max: parseFloat(e.target.value)})}
                style={{ display: 'block', width: '100%', marginTop: '6px' }} />
            </label>
            <label style={{ fontSize: '13px', fontWeight: '600', color: text }}>
              Body Color
              <input type="color" value={form.color} onChange={e => setForm({...form, color: e.target.value})}
                style={{ display: 'block', width: '100%', height: '40px', padding: '2px', marginTop: '6px', background: inputBg, border: \`1px solid \${border}\`, borderRadius: '8px', cursor: 'pointer' }} />
            </label>
            <div style={{ marginTop: '10px' }}>
              <button type="submit" disabled={loading} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', background: isDark ? '#90caf9' : '#1976d2', color: isDark ? '#000' : '#fff', fontWeight: 'bold', fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer' }}>
                {loading ? 'Creating...' : 'Create Robot'}
              </button>
            </div>
          </form>
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        <div style={{ position: 'absolute', top: '20px', left: '20px', background: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.8)', padding: '10px 16px', borderRadius: '8px', border: \`1px solid \${border}\`, color: text, pointerEvents: 'none' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '14px' }}>2D Live Preview</h3>
          <p style={{ margin: 0, fontSize: '12px', opacity: 0.7 }}>Robot visually sizes to {(form.robot_radius*2).toFixed(2)}m</p>
        </div>
      </div>
    </div>
  );
}`;

let startIdx = content.indexOf('// ─────────────────────────────────────────────────────────────────────────────\n// RobotCreatorModal');
let endIdx = content.indexOf('\n// ─────────────────────────────────────────────────────────────────────────────\n// CustomDropdown');
if (startIdx !== -1 && endIdx !== -1) {
  content = content.slice(0, startIdx) + newComponent + content.slice(endIdx);
} else {
  console.log("Could not find RobotCreatorModal bounds!");
  process.exit(1);
}

// 2. Add fetchRobots to useImperativeHandle in SimSelector
content = content.replace(
  `  useImperativeHandle(ref, () => ({
    openCreator: () => setShowCreator(true)
  }));`,
  `  useImperativeHandle(ref, () => ({
    openCreator: () => setShowCreator(true),
    fetchRobots: () => fetchRobots()
  }));`
);

// 3. Remove old RobotCreatorModal usage inside SimSelector
const modalUsageStr = `<RobotCreatorModal \n        isOpen={showCreator} \n        onClose={() => setShowCreator(false)} \n        isDark={isDark} \n        onCreated={() => { fetchRobots(); }} \n      />`;
content = content.replace(modalUsageStr, '');

// 4. Update Create Robot button in App
content = content.replace(
  `<button
                style={S.topBtn}
                onClick={() => {
                  simSelectorRef.current?.openCreator();
                  setAppMode('dashboard');
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>
                Create Robot
              </button>`,
  `<button
                style={appMode === 'creator' ? S.topBtnActive : S.topBtn}
                onClick={() => {
                  setAppMode(appMode === 'creator' ? 'dashboard' : 'creator');
                  setShowMonitor(false);
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>
                Create Robot
              </button>`
);

// 5. Update view routing to include RobotCreator
content = content.replace(
  `          {/* 🌟 View Routing based on appMode */}
          {appMode === 'editor' ? (
            <MapEditor onExit={() => setAppMode('dashboard')} isDark={isDark} />
          ) : (`,
  `          {/* 🌟 View Routing based on appMode */}
          {appMode === 'editor' ? (
            <MapEditor onExit={() => setAppMode('dashboard')} isDark={isDark} />
          ) : appMode === 'creator' ? (
            <RobotCreator onExit={() => setAppMode('dashboard')} isDark={isDark} onCreated={() => simSelectorRef.current?.fetchRobots()} />
          ) : (`
);

fs.writeFileSync(file, content);
console.log("App.jsx updated successfully!");
