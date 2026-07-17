import { useState, useEffect, useRef } from "react";
import { useNavigate } from 'react-router-dom';
import useAppStore from '../../store/useAppStore';

function ParamRow({ label, unit = '', value, onChange, min, max, step = 0.01, inputBg, border, text }) {
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: text }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="number" value={value} min={min} max={max} step={step}
            onChange={e => onChange(parseFloat(e.target.value) || 0)}
            style={{
              width: '70px', padding: '4px 6px', background: inputBg, border: `1px solid ${border}`,
              color: text, borderRadius: '6px', fontSize: '12px', textAlign: 'right'
            }}
          />
          {unit && <span style={{ fontSize: '11px', color: 'var(--color-text-sub)', minWidth: '20px' }}>{unit}</span>}
        </div>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ display: 'block', width: '100%', accentColor: 'var(--color-accent)' }}
      />
    </div>
  );
}

function SectionHeader({ label, isDark, icon }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', marginBottom: '8px' }}>
      <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-accent)' }}>{icon} {label}</span>
      <div style={{ flex: 1, height: '1px', background: isDark ? '#333' : '#e0e0e0' }} />
    </div>
  );
}

export default function CreateRobotView({ onCreated }) {
  const navigate = useNavigate();
  const { isDark } = useAppStore();
  const onExit = () => navigate('/');

  const [form, setForm] = useState({
    name: '', kinematic_model: 'diff_drive', color: '#2196f3',
    spawn_x: 0.0, spawn_y: 0.0, spawn_yaw: 0.0,
    max_linear_vel: 1.0, max_angular_vel: 1.0,
    geometry_type: 'rectangle',
    body_length_x: 0.70, body_width_y: 0.50, body_size: 0.70, body_radius: 0.35, body_height: 0.20,
    wheel_base: 0.50, wheel_radius: 0.05, wheel_width: 0.03, axle_track: 0.40, max_steering_angle: 30,
    lidar_x: 0.0, lidar_y: 0.0, lidar_height: 0.10, lidar_radius: 0.05, lidar_range_max: 12.0,
    ticks_per_meter: 2000, omni_wheel_count: 3,
  });

  const getAllowedGeometries = (model, omniCount) => {
    if (model === 'diff_drive') return ['rectangle', 'square', 'circle'];
    if (model === 'mecanum') return ['rectangle', 'square'];
    if (model === 'ackermann') return ['rectangle'];
    if (model === 'omni') return omniCount === 3 ? ['circle'] : ['rectangle', 'square'];
    return ['rectangle'];
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef(null);

  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      viewRef.current.zoom = Math.max(0.1, Math.min(viewRef.current.zoom * factor, 10));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const onDown = (e) => { dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY }; if (e.target && e.target.style) e.target.style.cursor = 'grabbing'; };
    const onMove = (e) => {
      if (!dragRef.current.active) return;
      viewRef.current.panX += e.clientX - dragRef.current.lastX;
      viewRef.current.panY += e.clientY - dragRef.current.lastY;
      dragRef.current.lastX = e.clientX; dragRef.current.lastY = e.clientY;
    };
    const onUp = (e) => { dragRef.current.active = false; if (e.target && e.target.style) e.target.style.cursor = 'grab'; };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    let animationFrameId;
    const PX_PER_M = 100;

    const render = () => {
      const f = formRef.current;
      const v = viewRef.current;
      const rect = canvas.parentElement.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width; canvas.height = rect.height;
      }
      const W = canvas.width; const H = canvas.height;
      const ox = W / 2 + v.panX;
      const oy = H / 2 + v.panY;
      const scale = PX_PER_M * v.zoom;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = isDark ? '#0d0d14' : '#f4f6f8';
      ctx.fillRect(0, 0, W, H);

      // Grid
      const halfM = scale / 2;
      ctx.strokeStyle = isDark ? '#ffffff10' : '#00000010';
      ctx.lineWidth = 1;
      for (let x = ox % halfM; x < W; x += halfM) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = oy % halfM; y < H; y += halfM) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      ctx.strokeStyle = isDark ? '#ffffff25' : '#00000025';
      for (let x = ox % scale; x < W; x += scale) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = oy % scale; y < H; y += scale) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      // Axis Indicator (Top Right, shifted down)
      ctx.save();
      ctx.translate(W - 55, 70);
      const axLen = 40; ctx.lineWidth = 2.5;

      // We want +X to point UP and +Y to point LEFT to reflect our view

      // +X Axis (Up)
      ctx.strokeStyle = '#f44336dd'; ctx.fillStyle = '#f44336dd';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -axLen); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -axLen); ctx.lineTo(-4, -axLen + 8); ctx.lineTo(4, -axLen + 8); ctx.fill();
      ctx.font = 'bold 11px monospace'; ctx.fillText('+X (Fwd)', -12, -axLen - 4);

      // +Y Axis (Left)
      ctx.strokeStyle = '#4caf50dd'; ctx.fillStyle = '#4caf50dd';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-axLen, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-axLen, 0); ctx.lineTo(-axLen + 8, -4); ctx.lineTo(-axLen + 8, 4); ctx.fill();
      ctx.fillStyle = '#4caf50'; ctx.fillText('+Y (Left)', -axLen - 50, 4);
      ctx.restore();

      // --- Setup ROS 2 Standard Coordinate System ---
      // ROS: +X Forward, +Y Left. Screen: +X Right, +Y Down.
      // To map visually as +X Up and +Y Left:
      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(-Math.PI / 2);
      ctx.scale(1, -1);

      // Draw Robot Base
      ctx.fillStyle = f.color + '40';
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let rEff;
      if (f.geometry_type === 'circle') {
        rEff = f.body_radius;
        ctx.arc(0, 0, f.body_radius * scale, 0, 2 * Math.PI);
      } else if (f.geometry_type === 'square') {
        rEff = f.body_size / 2;
        const s = f.body_size * scale;
        ctx.rect(-s / 2, -s / 2, s, s);
      } else {
        const lx = f.body_length_x, wy = f.body_width_y;
        rEff = Math.sqrt((lx / 2) ** 2 + (wy / 2) ** 2);
        const lPx = lx * scale, wPx = wy * scale;
        // In this ROS frame, X is length, Y is width
        ctx.rect(-lPx / 2, -wPx / 2, lPx, wPx);
      }
      ctx.fill(); ctx.stroke();

      // Heading Arrow (points along +X axis)
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const arrowLen = Math.max(15, rEff * scale * 0.8);
      ctx.lineTo(arrowLen, 0);
      ctx.strokeStyle = isDark ? '#ffffff' : '#000000';
      ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(arrowLen + 6, 0); ctx.lineTo(arrowLen - 5, -5); ctx.lineTo(arrowLen - 5, 5);
      ctx.fillStyle = isDark ? '#ffffff' : '#000000'; ctx.fill();

      // Wheels
      const drawWheel = (rx, ry, yaw, isMecanum = false, mecanumDir = 1) => {
        ctx.save();
        ctx.translate(rx * scale, ry * scale);
        ctx.rotate(yaw); // native yaw in this frame
        const wPx = f.wheel_width * scale;
        const lPx = (f.wheel_radius * 2) * scale;

        ctx.fillStyle = isDark ? '#e0e0e0' : '#1a1a1a';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-lPx / 2, -wPx / 2, lPx, wPx, 3);
        else ctx.rect(-lPx / 2, -wPx / 2, lPx, wPx);
        ctx.fill();

        if (isMecanum) {
          ctx.strokeStyle = isDark ? '#444' : '#888';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let i = -1; i <= 1; i++) {
            const xOff = i * (lPx / 3.5);
            const dy = (wPx / 2) * mecanumDir;
            ctx.moveTo(xOff - dy, -dy);
            ctx.lineTo(xOff + dy, dy);
          }
          ctx.stroke();
        }
        ctx.restore();
      };

      const hwb = f.wheel_base / 2;
      const hat = f.axle_track / 2;

      if (f.kinematic_model === 'diff_drive') {
        drawWheel(0, hat, 0); drawWheel(0, -hat, 0);
      } else if (f.kinematic_model === 'mecanum') {
        drawWheel(hwb, hat, 0, true, 1); drawWheel(hwb, -hat, 0, true, -1);
        drawWheel(-hwb, hat, 0, true, -1); drawWheel(-hwb, -hat, 0, true, 1);
      } else if (f.kinematic_model === 'ackermann') {
        const steer = f.max_steering_angle * (Math.PI / 180);
        drawWheel(hwb, hat, steer); drawWheel(hwb, -hat, steer);
        drawWheel(-hwb, hat, 0); drawWheel(-hwb, -hat, 0);
      } else if (f.kinematic_model === 'omni') {
        const R = f.axle_track / 2;
        const angles = f.omni_wheel_count === 3 ? [0, 120, 240] : [45, 135, 225, 315];
        angles.forEach(ang => {
          const rad = ang * Math.PI / 180;
          const rx = Math.cos(rad) * R;
          const ry = Math.sin(rad) * R;
          // Omni wheels roll orthogonally to the radius vector
          drawWheel(rx, ry, rad + Math.PI / 2, true, 1);
        });
      }

      // LiDAR
      const lidarSX = f.lidar_x * scale;
      const lidarSY = f.lidar_y * scale;
      const lidarR = Math.max(4, f.lidar_radius * scale);
      const rangePx = f.lidar_range_max * scale;

      ctx.fillStyle = f.color + '15';
      ctx.beginPath(); ctx.arc(lidarSX, lidarSY, rangePx, 0, Math.PI * 2); ctx.fill();

      ctx.strokeStyle = f.color + '66'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(lidarSX, lidarSY, rangePx, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);

      ctx.shadowColor = f.color; ctx.shadowBlur = 10;
      ctx.fillStyle = f.color;
      ctx.beginPath(); ctx.arc(lidarSX, lidarSY, lidarR, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();

      ctx.restore(); // Restore from ROS coordinate frame

      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDark]);

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const sanitizedName = form.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const payload = { ...form, name: sanitizedName };
      const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
      const res = await fetch(`http://${host}:3001/api/robots`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const isJson = res.headers.get('content-type')?.includes('application/json');
      if (isJson) {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create robot');
        if (onCreated) onCreated();
        onExit();
      } else {
        const text = await res.text();
        throw new Error(text || 'Failed to create robot');
      }
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const PRESET_COLORS = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#ff9800', '#ff5722', '#795548', '#607d8b'];
  const bg = 'var(--color-paper)';
  const text = 'var(--color-text)';
  const inputBg = isDark ? '#1a1a24' : '#ffffff';
  const border = 'var(--color-border)';
  const shared = { isDark, inputBg, border, text };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', flex: 1, minHeight: 0, overflow: 'hidden', background: isDark ? '#08080c' : '#f0f2f5' }}>
      <div style={{ width: '320px', minWidth: '320px', background: isDark ? '#12121c' : '#ffffff', borderRight: `1px solid ${border}`, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', zIndex: 10, boxShadow: '2px 0 12px rgba(0,0,0,0.1)' }}>
        <div style={{ padding: '20px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', color: text, fontWeight: 700 }}>Create New Robot</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--color-text-sub)' }}>Configure kinematics & physics</p>
          </div>
          <button onClick={onExit} style={{ background: 'var(--color-paper)', border: `1px solid ${border}`, borderRadius: '50%', width: '32px', height: '32px', color: text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>

        <div className="custom-scrollbar" style={{ padding: '20px', flex: 1, overflowY: 'auto' }}>
          {error && <div style={{ background: '#ffebee', color: '#c62828', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', fontWeight: 500, border: '1px solid #ffcdd2' }}>{error}</div>}

          <form id="robot-creator-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <SectionHeader label="Identity" isDark={isDark} icon="🤖" />
            <label style={{ fontSize: '12px', fontWeight: 600, color: text, marginBottom: '8px', display: 'block' }}>
              Robot Name
              <input required type="text" value={form.name} placeholder="e.g. my_robot"
                onChange={e => set('name', e.target.value)}
                style={{ display: 'block', width: '100%', padding: '10px 12px', marginTop: '6px', background: inputBg, border: `1px solid ${border}`, color: text, borderRadius: '8px', boxSizing: 'border-box' }} />
            </label>

            <label style={{ fontSize: '12px', fontWeight: 600, color: text, marginBottom: '8px', display: 'block' }}>
              Kinematic Model
              <select value={form.kinematic_model} onChange={e => {
                const newModel = e.target.value;
                const allowed = getAllowedGeometries(newModel, form.omni_wheel_count);
                setForm(f => {
                  const f2 = { ...f, kinematic_model: newModel };
                  if (!allowed.includes(f.geometry_type)) f2.geometry_type = allowed[0];
                  return f2;
                });
              }}
                style={{ display: 'block', width: '100%', padding: '10px 12px', marginTop: '6px', background: inputBg, border: `1px solid ${border}`, color: text, borderRadius: '8px' }}>
                <option value="diff_drive">Differential Drive (2 Wheels)</option>
                <option value="mecanum">Mecanum Drive (4 Wheels)</option>
                <option value="omni">Omni-Directional</option>
                <option value="ackermann">Ackermann (Car Steering)</option>
              </select>
            </label>

            {form.kinematic_model === 'omni' && (
              <label style={{ fontSize: '12px', fontWeight: 600, color: text, marginBottom: '8px', display: 'block' }}>
                Omni Wheel Count
                <select value={form.omni_wheel_count} onChange={e => {
                  const newCount = parseInt(e.target.value, 10);
                  const allowed = getAllowedGeometries(form.kinematic_model, newCount);
                  setForm(f => {
                    const f2 = { ...f, omni_wheel_count: newCount };
                    if (!allowed.includes(f.geometry_type)) f2.geometry_type = allowed[0];
                    return f2;
                  });
                }}
                  style={{ display: 'block', width: '100%', padding: '10px 12px', marginTop: '6px', background: inputBg, border: `1px solid ${border}`, color: text, borderRadius: '8px' }}>
                  <option value={3}>3 Wheels (Circle base)</option>
                  <option value={4}>4 Wheels (Square/Rect base)</option>
                </select>
              </label>
            )}

            <div style={{ fontSize: '12px', fontWeight: 600, color: text, marginTop: '8px', marginBottom: '12px' }}>
              <div style={{ marginBottom: '8px' }}>Body Color</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {PRESET_COLORS.map(c => (
                  <div key={c} onClick={() => set('color', c)} style={{ width: '24px', height: '24px', borderRadius: '6px', background: c, border: form.color === c ? `2px solid ${isDark ? '#fff' : '#000'}` : '2px solid transparent', cursor: 'pointer', transition: 'all 0.15s', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }} />
                ))}
                <div style={{ width: '24px', height: '24px', borderRadius: '6px', border: `1px solid ${border}`, overflow: 'hidden', cursor: 'pointer', position: 'relative' }}>
                  <input type="color" value={form.color} onChange={e => set('color', e.target.value)} style={{ width: '150%', height: '150%', position: 'absolute', top: '-25%', left: '-25%', cursor: 'pointer', border: 'none' }} />
                </div>
              </div>
            </div>

            <SectionHeader label="Body Geometry" isDark={isDark} icon="📦" />
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              {[['rectangle', '▭ Rect'], ['square', '□ Square'], ['circle', '○ Circle']]
                .filter(([gt]) => getAllowedGeometries(form.kinematic_model, form.omni_wheel_count).includes(gt))
                .map(([gt, label]) => (
                  <button key={gt} type="button" onClick={() => set('geometry_type', gt)}
                    style={{
                      flex: 1, padding: '8px 4px', borderRadius: '8px', cursor: 'pointer', fontSize: '11px', fontWeight: form.geometry_type === gt ? 700 : 500,
                      border: '1.5px solid ' + (form.geometry_type === gt ? 'var(--color-accent)' : border),
                      background: form.geometry_type === gt ? 'var(--color-accent-sub)' : inputBg,
                      color: form.geometry_type === gt ? 'var(--color-accent)' : text,
                      transition: 'all 0.15s'
                    }}>{label}</button>
                ))}
            </div>

            {form.geometry_type === 'circle' && (
              <ParamRow label="Radius" unit="m" value={form.body_radius} min={0.1} max={2.0} step={0.01} onChange={v => set('body_radius', v)} {...shared} />
            )}
            {form.geometry_type === 'square' && (
              <ParamRow label="Size (all sides)" unit="m" value={form.body_size} min={0.1} max={2.0} step={0.01} onChange={v => set('body_size', v)} {...shared} />
            )}
            {form.geometry_type === 'rectangle' && (
              <>
                <ParamRow label="Length X (forward)" unit="m" value={form.body_length_x} min={0.1} max={2.0} step={0.01} onChange={v => set('body_length_x', v)} {...shared} />
                <ParamRow label="Width Y (lateral)" unit="m" value={form.body_width_y} min={0.1} max={2.0} step={0.01} onChange={v => set('body_width_y', v)} {...shared} />
              </>
            )}

            <SectionHeader label="Wheel Parameters" isDark={isDark} icon="⚙️" />

            {/* Bundled base parameters for Mecanum/Ackermann, Diff drive uses axle track for separation */}
            <div style={{ background: isDark ? '#1a1a24' : '#f8f9fa', padding: '12px', borderRadius: '8px', marginBottom: '12px', border: `1px solid ${border}` }}>
              {form.kinematic_model !== 'diff_drive' && (
                <ParamRow label="Wheel Base (F-R)" unit="m" value={form.wheel_base} min={0.1} max={2.0} step={0.01} onChange={v => set('wheel_base', v)} {...shared} inputBg={bg} />
              )}
              <ParamRow label="Axle Track (L-R)" unit="m" value={form.axle_track} min={0.1} max={2.0} step={0.01} onChange={v => set('axle_track', v)} {...shared} inputBg={bg} />
            </div>

            {form.kinematic_model === 'ackermann' && (
              <ParamRow label="Max Steering Angle" unit="°" value={form.max_steering_angle} min={0} max={45} step={1} onChange={v => set('max_steering_angle', v)} {...shared} />
            )}
            <ParamRow label="Wheel Radius" unit="m" value={form.wheel_radius} min={0.02} max={0.3} step={0.005} onChange={v => set('wheel_radius', v)} {...shared} />
            <ParamRow label="Wheel Width" unit="m" value={form.wheel_width} min={0.01} max={0.2} step={0.005} onChange={v => set('wheel_width', v)} {...shared} />

            <SectionHeader label="LiDAR / Sensor" isDark={isDark} icon="📡" />
            <ParamRow label="Range Max" unit="m" value={form.lidar_range_max} min={1.0} max={50.0} step={0.5} onChange={v => set('lidar_range_max', v)} {...shared} />
            {(() => {
              let maxLidarX = 0, maxLidarY = 0;
              if (form.geometry_type === 'circle') {
                maxLidarX = form.body_radius;
                maxLidarY = form.body_radius;
              } else if (form.geometry_type === 'square') {
                maxLidarX = form.body_size / 2;
                maxLidarY = form.body_size / 2;
              } else {
                maxLidarX = form.body_length_x / 2;
                maxLidarY = form.body_width_y / 2;
              }
              return (
                <>
                  <ParamRow label="Mount X (fwd)" unit="m" value={form.lidar_x} min={-maxLidarX} max={maxLidarX} step={0.01} onChange={v => set('lidar_x', v)} {...shared} />
                  <ParamRow label="Mount Y (lat)" unit="m" value={form.lidar_y} min={-maxLidarY} max={maxLidarY} step={0.01} onChange={v => set('lidar_y', v)} {...shared} />
                </>
              );
            })()}
          </form>
        </div>

        <div style={{ padding: '20px', borderTop: `1px solid ${border}`, background: isDark ? '#12121c' : '#ffffff', flexShrink: 0 }}>
          <button type="submit" form="robot-creator-form" disabled={loading}
            style={{
              width: '100%', padding: '14px', borderRadius: '10px', border: 'none', background: 'var(--color-accent)', color: '#fff', fontWeight: 700, fontSize: '15px', textTransform: 'uppercase', letterSpacing: '0.5px', cursor: loading ? 'wait' : 'pointer', transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(0, 102, 255, 0.3)'
            }}
            onMouseOver={e => !loading && (e.currentTarget.style.transform = 'translateY(-2px)', e.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 102, 255, 0.4)')}
            onMouseOut={e => !loading && (e.currentTarget.style.transform = 'none', e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 102, 255, 0.3)')}
          >
            {loading ? 'Creating...' : 'Deploy Robot'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

        <div style={{ position: 'absolute', top: '24px', left: '24px', background: isDark ? 'rgba(20,20,30,0.85)' : 'rgba(255,255,255,0.85)', padding: '16px', borderRadius: '12px', border: `1px solid ${border}`, color: text, pointerEvents: 'none', backdropFilter: 'blur(10px)', minWidth: '220px', boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 800 }}>Live Configuration Preview</h3>
          <p style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 600, color: 'var(--color-accent)' }}>
            {form.kinematic_model.replace('_', ' ').toUpperCase()}
          </p>
          <div style={{ marginTop: '12px', padding: '12px', borderRadius: '8px', background: isDark ? 'rgba(255, 152, 0, 0.1)' : 'rgba(255, 152, 0, 0.05)', border: '1px solid rgba(255, 152, 0, 0.2)' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#ff9800', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '16px' }}>📡</span> LiDAR Sensor
            </div>
            <div style={{ fontSize: '12px', color: text, opacity: 0.8, display: 'flex', justifyContent: 'space-between' }}><span>Range:</span> <b>{form.lidar_range_max} m</b></div>
            <div style={{ fontSize: '12px', color: text, opacity: 0.8, display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}><span>Offset X:</span> <b>{form.lidar_x.toFixed(2)} m</b></div>
            <div style={{ fontSize: '12px', color: text, opacity: 0.8, display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}><span>Offset Y:</span> <b>{form.lidar_y.toFixed(2)} m</b></div>
          </div>
          <p style={{ margin: '12px 0 0', fontSize: '11px', opacity: 0.5, textAlign: 'center' }}>Scroll to zoom • Drag to pan</p>
        </div>

        <div style={{ position: 'absolute', bottom: '24px', right: '24px', display: 'flex', gap: '10px' }}>
          <button onClick={() => { viewRef.current.zoom = 1; viewRef.current.panX = 0; viewRef.current.panY = 0; }}
            style={{ background: isDark ? 'rgba(30,30,40,0.8)' : 'rgba(255,255,255,0.8)', border: `1px solid ${border}`, color: text, padding: '10px 20px', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, backdropFilter: 'blur(8px)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', transition: 'all 0.2s' }}
            onMouseOver={e => e.currentTarget.style.background = isDark ? '#2a2a3a' : '#f0f0f0'}
            onMouseOut={e => e.currentTarget.style.background = isDark ? 'rgba(30,30,40,0.8)' : 'rgba(255,255,255,0.8)'}>
            Reset View
          </button>
        </div>
      </div>
    </div>
  );
}
