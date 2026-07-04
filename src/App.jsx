// App.jsx — HUD Axis & Mouse Icons Update
import React, { useEffect, useState, useRef, useCallback } from 'react';
import * as ROSLIB from 'roslib';
import MapEditor from './components/MapEditor';

const MAP_SERVER_URL  = 'http://localhost:3001/map';
const URDF_SERVER_URL = 'http://localhost:3001/urdf';
const ROBOTS_URL      = 'http://localhost:3001/robots';
const STATUS_URL      = 'http://localhost:3001/status';
const SWITCH_URL      = 'http://localhost:3001/switch';
const STOP_URL        = 'http://localhost:3001/stop';
const ROSBRIDGE_URL   = 'ws://localhost:9090';
const FETCH_INTERVAL  = 3000;
const STATUS_INTERVAL = 1500;

// ─────────────────────────────────────────────────────────────────────────────
// parseURDF
// ─────────────────────────────────────────────────────────────────────────────
function parseURDF(xmlString) {
  try {
    const parser = new DOMParser();
    const xml    = parser.parseFromString(xmlString, 'application/xml');
    const shapes = [];

    const materialColors = {};
    xml.querySelectorAll('material').forEach((mat) => {
      const name    = mat.getAttribute('name');
      const colorEl = mat.querySelector('color');
      if (name && colorEl) {
        const rgba  = colorEl.getAttribute('rgba')?.split(' ').map(Number) ?? [0, 0.3, 1, 1];
        const toHex = (v) =>
          Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
        materialColors[name] = `#${toHex(rgba[0])}${toHex(rgba[1])}${toHex(rgba[2])}`;
      }
    });

    xml.querySelectorAll('link').forEach((link) => {
      const linkName = link.getAttribute('name') ?? '';
      link.querySelectorAll('visual').forEach((visual) => {
        const originEl = visual.querySelector('origin');
        const xyz = originEl?.getAttribute('xyz')?.split(' ').map(Number) ?? [0, 0, 0];
        const rpy = originEl?.getAttribute('rpy')?.split(' ').map(Number) ?? [0, 0, 0];

        let hexColor = '#1a4dcc';
        const matEl  = visual.querySelector('material');
        if (matEl) {
          const inlineColor = matEl.querySelector('color');
          if (inlineColor) {
            const rgba  = inlineColor.getAttribute('rgba')?.split(' ').map(Number) ?? [0.1, 0.3, 0.8, 1];
            const toHex = (v) =>
              Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
            hexColor = `#${toHex(rgba[0])}${toHex(rgba[1])}${toHex(rgba[2])}`;
          } else {
            hexColor = materialColors[matEl.getAttribute('name') ?? ''] ?? hexColor;
          }
        }

        const box      = visual.querySelector('geometry box');
        const cylinder = visual.querySelector('geometry cylinder');
        const sphere   = visual.querySelector('geometry sphere');

        if (box) {
          const size = box.getAttribute('size')?.split(' ').map(Number) ?? [0.1, 0.1, 0.1];
          shapes.push({ link: linkName, type: 'box',
            w: size[0], d: size[1], h: size[2],
            ox: xyz[0], oy: xyz[1], oz: xyz[2],
            yaw: rpy[2], color: hexColor });
        }
        if (cylinder) {
          shapes.push({ link: linkName, type: 'cylinder',
            radius: parseFloat(cylinder.getAttribute('radius') ?? '0.05'),
            length: parseFloat(cylinder.getAttribute('length') ?? '0.1'),
            ox: xyz[0], oy: xyz[1], oz: xyz[2],
            yaw: rpy[2], color: hexColor });
        }
        if (sphere) {
          shapes.push({ link: linkName, type: 'sphere',
            radius: parseFloat(sphere.getAttribute('radius') ?? '0.05'),
            ox: xyz[0], oy: xyz[1], oz: xyz[2],
            color: hexColor });
        }
      });
    });

    let maxR = 0.2;
    shapes.forEach((s) => {
      if (s.type === 'box') maxR = Math.max(maxR, s.w / 2, s.d / 2);
      else                  maxR = Math.max(maxR, s.radius);
    });

    return { shapes, maxR };
  } catch (err) {
    console.error('URDF parse error:', err);
    return { shapes: [], maxR: 0.2 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// drawRobot
// ─────────────────────────────────────────────────────────────────────────────
function drawRobot(ctx, rx, ry, thetaRad, worldX, worldY, urdf, scale, isDark, view) {
  const { shapes, maxR } = urdf ?? { shapes: [], maxR: 0.2 };
  const labelR = Math.max(10, maxR * scale);
  
  // เปลี่ยนจากค่าคงที่ เป็นแบบนี้ครับ
  const textColor = isDark ? '#000000' : '#ffffff'; 
  const lineColor = isDark ? '#000000' : '#ffffff'; 
  const coordColor = isDark ? '#000652' : '#3ed6fc';

  ctx.save();
  ctx.translate(rx, ry);
  
  ctx.rotate(-Math.PI / 2 - thetaRad);

  if (shapes.length === 0) {
    ctx.shadowColor = '#00e5ffaa';
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = '#00e5ff';
    ctx.strokeStyle = '#ffffffcc';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(0, 0, labelR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else {
    shapes.forEach((s) => {
      const sx =  s.ox * scale;
      const sy = -s.oy * scale;
      ctx.save();
      ctx.translate(sx, sy);
      if (s.yaw) ctx.rotate(-s.yaw);
      ctx.shadowColor = s.color + '99';
      ctx.shadowBlur  = 8;

      if (s.type === 'box') {
        const hw = (s.w / 2) * scale;
        const hd = (s.d / 2) * scale;
        ctx.fillStyle   = s.color + 'dd';
        ctx.fillRect(-hw, -hd, hw * 2, hd * 2);
        ctx.strokeStyle = '#ffffffcc';
        ctx.lineWidth   = 1.5;
        ctx.strokeRect(-hw, -hd, hw * 2, hd * 2);
        ctx.shadowBlur  = 0;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 2;
        ctx.beginPath(); ctx.moveTo(hw, -hd); ctx.lineTo(hw, hd); ctx.stroke();
        ctx.strokeStyle = '#ffffff55';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(-hw, 0); ctx.lineTo(hw, 0);
        ctx.moveTo(0, -hd); ctx.lineTo(0, hd);
        ctx.stroke();
        ctx.fillStyle = '#ffffffaa';
        ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();

      } else if (s.type === 'cylinder' || s.type === 'sphere') {
        const pr = Math.max(3, s.radius * scale);
        ctx.fillStyle   = s.color + 'dd';
        ctx.strokeStyle = '#ffffffcc';
        ctx.lineWidth   = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, pr, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    });
  }

  ctx.shadowBlur   = 0;
  const arrowStart = Math.max(10, maxR * scale) * 0.6;
  const arrowEnd   = Math.max(10, maxR * scale) * 2.0;
  ctx.strokeStyle  = lineColor;
  ctx.lineWidth    = 2;
  ctx.lineCap      = 'round';
  ctx.beginPath(); ctx.moveTo(arrowStart, 0); ctx.lineTo(arrowEnd, 0); ctx.stroke();
  ctx.fillStyle = lineColor;
  ctx.beginPath();
  ctx.moveTo(arrowEnd, 0);
  ctx.lineTo(arrowEnd - 8, -4);
  ctx.lineTo(arrowEnd - 8,  4);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(rx, ry);
  ctx.rotate(-view.rotation); 
  ctx.scale(1 / view.zoom, 1 / view.zoom); 
  
  const textOffset = (labelR * view.zoom) + 6;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.font         = 'bold 10px sans-serif';
  ctx.fillStyle    = textColor;
  ctx.fillText('AMR', 0, textOffset);
  ctx.font      = '9px monospace';
  ctx.fillStyle = coordColor;
  ctx.fillText(`(${worldX}, ${worldY})`, 0, textOffset + 12);
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// normaliseMap
// ─────────────────────────────────────────────────────────────────────────────
function normaliseMap(raw) {
  if (!raw) return null;

  const walls = (raw.walls || []).map((w) =>
    Array.isArray(w)
      ? { start: [w[0][0], w[0][1]], end: [w[1][0], w[1][1]], thickness: 0.12 }
      : { start: w.start, end: w.end, thickness: w.thickness ?? 0.12 }
  );
  const obstacles = (raw.obstacles || []).map((o) => {
    if (Array.isArray(o)) {
      if (o.length === 3) return { type: 'circle', x: o[0], y: o[1], radius: o[2] };
      if (o.length === 4) return { type: 'rect',   x: o[0], y: o[1], w: o[2], h: o[3] };
    }
    return o;
  });
  const waypoints = (raw.waypoints || []).map((wp) =>
    Array.isArray(wp) ? { x: wp[0], y: wp[1], name: wp[2] ?? '' } : wp
  );
  const zones = (raw.zones || []).map((z) =>
    Array.isArray(z) ? { points: z, name: '', color: '#4a90e2' } : z
  );

  let mapInfo = raw.map_info ?? null;
  if (!mapInfo) {
    const allX = [], allY = [];
    walls.forEach(({ start, end }) => { allX.push(start[0], end[0]); allY.push(start[1], end[1]); });
    obstacles.forEach((o) => { allX.push(o.x); allY.push(o.y); });
    waypoints.forEach((wp) => { allX.push(wp.x); allY.push(wp.y); });
    if (allX.length) {
      const pad = 1.0;
      mapInfo = {
        origin_x: Math.min(...allX) - pad,
        origin_y: Math.min(...allY) - pad,
        width:    Math.max(...allX) - Math.min(...allX) + pad * 2,
        height:   Math.max(...allY) - Math.min(...allY) + pad * 2,
      };
    } else {
      mapInfo = { origin_x: -6, origin_y: -6, width: 12, height: 12 };
    }
  }
  return { ...raw, walls, obstacles, waypoints, zones, map_info: mapInfo };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildTransform (X Vertical / Y Horizontal)
// ─────────────────────────────────────────────────────────────────────────────
function buildTransform(mapInfo, canvasW, canvasH) {
  const { origin_x, origin_y, width: mw, height: mh } = mapInfo;
  
  const scale   = Math.min(canvasW / mh, canvasH / mw) * 0.90;
  const offsetX = (canvasW - mh * scale) / 2;
  const offsetY = (canvasH - mw * scale) / 2;
  
  return {
    scale,
    offsetX,
    toCanvas: (wx, wy) => ({
      cx: Math.round(canvasW - offsetX - (wy - origin_y) * scale) + 0.5,
      cy: Math.round(canvasH - offsetY - (wx - origin_x) * scale) + 0.5,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WorldMap Component 
// ─────────────────────────────────────────────────────────────────────────────
function WorldMap({ mapData, pose, urdf, width = 560, height = 560, isDark }) {
  const canvasRef = useRef(null);
  
  const [view, setView] = useState({ zoom: 1, rotation: 0, panX: 0, panY: 0 });
  const dragRef = useRef({ isMiddle: false, isLeft: false, lastX: 0, lastY: 0 });
  const [cursor, setCursor] = useState('crosshair');

  const handleMouseDown = (e) => {
    if (e.button === 0) { 
      e.preventDefault();
      dragRef.current = { isMiddle: false, isLeft: true, lastX: e.clientX, lastY: e.clientY };
      setCursor('ew-resize');
    } else if (e.button === 1) { 
      dragRef.current = { isMiddle: true, isLeft: false, lastX: e.clientX, lastY: e.clientY };
      setCursor('grabbing');
    }
  };

  const handleMouseMove = (e) => {
    if (dragRef.current.isLeft) { // ถ้าคลิกซ้ายอยู่ให้หมุน
      const dx = e.clientX - dragRef.current.lastX;
      setView(v => ({ ...v, rotation: v.rotation + dx * 0.01 }));
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
    } else if (dragRef.current.isMiddle) { // ถ้าคลิกกลางอยู่ให้เลื่อน
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      setView(v => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
    }
  };

  const handleMouseUpOrLeave = () => {
    dragRef.current = { isMiddle: false, isLeft: false, lastX: 0, lastY: 0 };
    setCursor('crosshair');
  };

  const handleDoubleClick = () => {
    setView({ zoom: 1, rotation: 0, panX: 0, panY: 0 });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      setView(v => ({ ...v, zoom: Math.max(0.1, Math.min(v.zoom * zoomFactor, 10)) }));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const bgFill = isDark ? '#d3d3d3' : '#222222';
    const gridLine = isDark ? '#08080886' : '#ffffff15'; 
    const wallColor = isDark ? '#000000' : '#eeeeee';
    
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = bgFill;
    ctx.fillRect(0, 0, width, height);

    if (!mapData) {
      ctx.fillStyle = '#ffffff88';
      ctx.font      = '15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Connecting to map server…', width / 2, height / 2);
      return;
    }

    const { scale, offsetX, toCanvas } = buildTransform(mapData.map_info, width, height);
    const { origin_x, origin_y, width: mw, height: mh } = mapData.map_info;

    ctx.save();
    ctx.translate(width / 2 + view.panX, height / 2 + view.panY);
    ctx.scale(view.zoom, view.zoom);
    ctx.rotate(view.rotation);
    ctx.translate(-width / 2, -height / 2);

    ctx.strokeStyle = gridLine;
    ctx.lineWidth   = 1;
    for (let gx = Math.ceil(origin_x); gx <= origin_x + mw; gx++) {
      const { cx: x1, cy: y1 } = toCanvas(gx, origin_y);
      const { cx: x2, cy: y2 } = toCanvas(gx, origin_y + mh);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    for (let gy = Math.ceil(origin_y); gy <= origin_y + mh; gy++) {
      const { cx: x1, cy: y1 } = toCanvas(origin_x, gy);
      const { cx: x2, cy: y2 } = toCanvas(origin_x + mw, gy);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }

    (mapData.zones || []).forEach((zone) => {
      if (!zone.points?.length) return;
      const color = zone.color || '#4a90e2';
      ctx.fillStyle   = color + '33';
      ctx.strokeStyle = color + 'cc';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      zone.points.forEach(([wx, wy], i) => {
        const { cx, cy } = toCanvas(wx, wy);
        i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
      });
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if (zone.name) {
        const avgX = zone.points.reduce((s, p) => s + p[0], 0) / zone.points.length;
        const avgY = zone.points.reduce((s, p) => s + p[1], 0) / zone.points.length;
        const { cx, cy } = toCanvas(avgX, avgY);
        
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-view.rotation);
        ctx.scale(1/view.zoom, 1/view.zoom);
        ctx.fillStyle = '#ffffffcc';
        ctx.font      = `${Math.max(11, scale * 0.12)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(zone.name, 0, 0);
        ctx.restore();
      }
    });

    ctx.strokeStyle = wallColor;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    (mapData.walls || []).forEach(({ start, end, thickness }) => {
      if (!start || !end) return;
      const { cx: x1, cy: y1 } = toCanvas(start[0], start[1]);
      const { cx: x2, cy: y2 } = toCanvas(end[0],   end[1]);
      ctx.lineWidth = Math.max(2, (thickness ?? 0.12) * scale);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });

    (mapData.obstacles || []).forEach((obs) => {
      ctx.fillStyle   = '#ef535077';
      ctx.strokeStyle = '#ef5350';
      ctx.lineWidth   = 1.5;
      if (obs.type === 'rect') {
        const { cx, cy } = toCanvas(obs.x, obs.y + obs.h);
        ctx.fillRect(cx, cy, obs.w * scale, obs.h * scale);
        ctx.strokeRect(cx, cy, obs.w * scale, obs.h * scale);
        if (obs.label) {
          const { cx: lx, cy: ly } = toCanvas(obs.x + obs.w / 2, obs.y + obs.h / 2);
          ctx.save();
          ctx.translate(lx, ly);
          ctx.rotate(-view.rotation);
          ctx.scale(1/view.zoom, 1/view.zoom);
          ctx.fillStyle = '#ffccbc';
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center'; ctx.fillText(obs.label, 0, 0);
          ctx.restore();
        }
      } else if (obs.type === 'circle') {
        const { cx, cy } = toCanvas(obs.x, obs.y);
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(3, obs.radius * scale), 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        if (obs.label) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(-view.rotation);
          ctx.scale(1/view.zoom, 1/view.zoom);
          ctx.fillStyle = '#ffccbc';
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center'; ctx.fillText(obs.label, 0, -obs.radius * scale - 5);
          ctx.restore();
        }
      }
    });

    if (pose && pose.x !== '-') {
      const worldX   = parseFloat(pose.x);
      const worldY   = parseFloat(pose.y);
      const thetaRad = (parseFloat(pose.theta) * Math.PI) / 180;
      const { cx: rx, cy: ry } = toCanvas(worldX, worldY);
      drawRobot(ctx, rx, ry, thetaRad, pose.x, pose.y, urdf, scale, isDark, view);
    }

    ctx.restore(); 

    const hudX = 50;
    const hudY = height - 70; 

    ctx.save();
    ctx.translate(hudX, hudY);
    ctx.rotate(view.rotation); 

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ff4444'; 
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -30); ctx.stroke();
    
    ctx.strokeStyle = '#44ff44'; 
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-30, 0); ctx.stroke();

    ctx.fillStyle = isDark ? '#000000dd' : '#ffffffdd';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.save();
    ctx.translate(0, -42);
    ctx.rotate(-view.rotation);
    ctx.fillText('X', 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(-42, 0);
    ctx.rotate(-view.rotation);
    ctx.fillText('Y', 0, 0);
    ctx.restore();

    ctx.restore();

    // ── HUD: Scale Bar ──
    const scaleColor = isDark ? '#000000' : '#ffffff'; 
    const barPx = Math.round(scale * view.zoom); 
    const bx = 16.5; 
    const by = height - 16.5; 
    
    ctx.strokeStyle = scaleColor; 
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + barPx, by); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx, by-4); ctx.lineTo(bx, by+4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx+barPx, by-4); ctx.lineTo(bx+barPx, by+4); ctx.stroke();
    
    ctx.fillStyle = scaleColor;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('1 m', bx + barPx + 8, by + 4);

  }, [mapData, pose, urdf, width, height, isDark, view]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onDoubleClick={handleDoubleClick}
        style={{ borderRadius: '8px', display: 'block', cursor, width: '100%', height: '100%' }}
      />
      {/* Instruction Zone */}
      <div style={{ 
        position: 'absolute', 
        bottom: '16px', 
        right: '16px', 
        fontSize: '18px', 
        color: isDark ? '#ffffff' : '#000000', 
        background: isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.5)', 
        backdropFilter: 'blur(4px)', 
        padding: '12px 20px',
        borderRadius: '12px',
        pointerEvents: 'none', 
        fontWeight: 600, 
        display: 'flex', 
        gap: '24px', 
        alignItems: 'center' 
      }}>
        <span style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="7"></rect><path d="M5 9h14"></path><path d="M12 2v7"></path><path d="M5 9V9A7 7 0 0 1 12 2v7H5z" fill="currentColor"></path></svg>
          Rotate
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="7"></rect><path d="M5 9h14"></path><path d="M12 2v7"></path><rect x="10.5" y="3" width="3" height="5" rx="1" fill="currentColor"></rect></svg>
          Pan
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="7"></rect><path d="M12 5v4"></path><path d="M10 7l2-2 2 2"></path><path d="M10 9l2 2 2-2"></path></svg>
          Zoom
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="8" width="10" height="14" rx="5"></rect>
            <path d="M4 14h10"></path>
            <path d="M9 8v6"></path>
            <path d="M5 5L2 2"></path>
            <path d="M2 9L0 7"></path>
            <rect x="12" y="1" width="12" height="9" rx="2" fill="currentColor" stroke="none"></rect>
            <text x="13.5" y="7.5" fill={isDark?'#000':'#fff'} stroke="none" fontSize="7.5" fontWeight="900" fontFamily="sans-serif">2X</text>
          </svg>
          Reset
        </span>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// KeyboardController
// ─────────────────────────────────────────────────────────────────────────────
function KeyboardController({ ros, isDark }) {
  const cmdPubRef  = useRef(null);
  const [keys,       setKeys]       = useState({});
  const [speed,      setSpeed]      = useState(0.5);
  const [turnSpeed,  setTurnSpeed]  = useState(1.0);
  const [webControl, setWebControl] = useState(true);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!webControl) return;

      const k = e.key.toLowerCase();
      if (k === 'k') {
        e.preventDefault();
        setKeys({}); 
      } else if (['i', ',', 'j', 'l'].includes(k)) {
        e.preventDefault();
        setKeys({ [k]: true }); 
      } else if (k === 'w') {
        setSpeed(s => Math.min(2.0, s * 1.1)); 
      } else if (k === 'x') {
        setSpeed(s => Math.max(0.1, s * 0.9)); 
      } else if (k === 'e') {
        setTurnSpeed(t => Math.min(3.0, t * 1.1)); 
      } else if (k === 'c') {
        setTurnSpeed(t => Math.max(0.1, t * 0.9)); 
      } else if (k === 'q') {
        setSpeed(s => Math.min(2.0, s * 1.1));     
        setTurnSpeed(t => Math.min(3.0, t * 1.1));
      } else if (k === 'z') {
        setSpeed(s => Math.max(0.1, s * 0.9));     
        setTurnSpeed(t => Math.max(0.1, t * 0.9));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [webControl]);

  useEffect(() => {
    if (!ros) {
      if (cmdPubRef.current) {
        cmdPubRef.current.unadvertise();
        cmdPubRef.current = null;
      }
      return;
    }

    cmdPubRef.current = new ROSLIB.Topic({
      ros,
      name:        '/cmd_vel',
      messageType: 'geometry_msgs/msg/Twist',
      latch:       false,
    });

    return () => {
      if (cmdPubRef.current) {
        cmdPubRef.current.publish({
          linear:  { x: 0.0, y: 0.0, z: 0.0 },
          angular: { x: 0.0, y: 0.0, z: 0.0 },
        });
        cmdPubRef.current.unadvertise();
        cmdPubRef.current = null;
      }
    };
  }, [ros]);

  useEffect(() => {
    let zeroCount = 0;

    const loop = setInterval(() => {
      if (!cmdPubRef.current) return;
      if (!webControl) return;

      const fwd   = keys['i'];
      const back  = keys[','];
      const left  = keys['j'];
      const right = keys['l'];

      const isMoving = fwd || back || left || right;

      const linear  = fwd ? speed : (back ? -speed : 0);
      const angular = left ? turnSpeed : (right ? -turnSpeed : 0);

      if (isMoving) {
        cmdPubRef.current.publish({
          linear:  { x: linear,  y: 0.0, z: 0.0 },
          angular: { x: 0.0,     y: 0.0, z: angular },
        });
      } else {
        if (zeroCount < 10) {
          cmdPubRef.current.publish({
            linear:  { x: 0.0, y: 0.0, z: 0.0 },
            angular: { x: 0.0, y: 0.0, z: 0.0 },
          });
          zeroCount++;
        }
      }
    }, 50);

    return () => clearInterval(loop);
  }, [keys, speed, turnSpeed, webControl]);

  const S = {
   wrap: {
      background: isDark ? '#121212' : '#ffffff', 
      border: `1px solid ${isDark ? '#333333' : '#e0e0e0'}`,
      boxShadow: isDark ? 'none' : '0 4px 12px rgba(0,0,0,0.03)',
      borderRadius: '16px', padding: '20px',
      opacity: webControl ? 1 : 0.6,
      transition: 'opacity 0.3s',
      display: 'flex', flexDirection: 'column', boxSizing: 'border-box', flexShrink: 0,
      overflow: 'hidden'
    },
    titleRow: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px'
    },
    title: { fontSize: '18px', fontWeight: 600, color: isDark ? '#90caf9' : '#1976d2' },
    toggleWrap: {
      display: 'flex',
      alignItems: 'center',
      background: isDark ? '#00000044' : '#f0f0f0',
      borderRadius: '20px',
      padding: '4px',
      cursor: 'pointer',
      border: `1px solid ${isDark ? '#333333' : '#dddddd'}`,
      userSelect: 'none'
    },
    toggleOpt: (active, color) => ({
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 16px',
      borderRadius: '20px',
      fontSize: '13px', 
      fontWeight: 700,
      letterSpacing: '0.5px',
      color: active ? color : (isDark ? '#555555' : '#aaaaaa'),
      background: active ? `${color}15` : 'transparent',
      border: active ? `1px solid ${color}` : '1px solid transparent',
      transition: 'all 0.2s ease-in-out'
    }),
    controlBody: {
      display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '20px', justifyContent: 'center'
    },
    dpad: {
      display: 'grid', gridTemplateColumns: 'repeat(3, 56px)', 
      gridTemplateRows: 'repeat(3, 56px)', gap: '8px',
      pointerEvents: webControl ? 'auto' : 'none'
    },
    key: (active) => ({
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: '10px',
      border: active ? `2px solid ${isDark ? '#90caf9' : '#1976d2'}` : `1px solid ${isDark ? '#ffffff25' : '#e0e0e0'}`,
      background: active ? (isDark ? '#3949ab' : '#e3f2fd') : (isDark ? '#ffffff0d' : '#f8f9fa'),
      color: active ? (isDark ? '#fff' : '#1565c0') : (isDark ? '#9e9ec0' : '#666666'),
      fontSize: '18px', fontWeight: 600, cursor: 'pointer', userSelect: 'none'
    }),
    sliderCol: {
      display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, maxWidth: '240px', minWidth: '180px'
    },
    sliderRow: {
      display: 'flex', alignItems: 'center', gap: '10px',
      fontSize: '14px', color: isDark ? '#9e9ec0' : '#666', fontWeight: 500,
      pointerEvents: webControl ? 'auto' : 'none'
    },
    slider: { flex: 1, accentColor: isDark ? '#90caf9' : '#1976d2' },
    val:    { fontFamily: 'monospace', color: isDark ? '#00e5ff' : '#007b83', width: '38px', textAlign: 'right', fontWeight: 700, fontSize: '12px' },
    cmdBar: {
      marginTop: '10px', fontSize: '13px', color: isDark ? '#9e9ec0' : '#666666',
      fontFamily: 'monospace', background: isDark ? '#ffffff06' : '#f0f0f0',
      borderRadius: '8px', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', fontWeight: 600
    },
  };

  const VKey = ({ keyName, label, styleOverrides }) => {
    const handlePress = (e) => {
      if (e) e.preventDefault();
      if (!webControl) return;

      if (keyName === 'k') {
        setKeys({}); 
      } else {
        setKeys({ [keyName]: true }); 
      }
    };

    return (
      <div
        style={{ ...S.key(!!keys[keyName] && webControl), ...styleOverrides }}
        onMouseDown={handlePress}
        onTouchStart={handlePress}
      >
        {label}
      </div>
    );
  };

  return (
    <div style={S.wrap}>
      <div style={S.titleRow}>
        <div style={S.title}>Robot Control</div>
        
        <div style={S.toggleWrap} onClick={() => setWebControl(!webControl)}>
          <div style={S.toggleOpt(!webControl, '#ff1744')}>
            <div style={{ width: '8px', height: '8px', borderRadius: '30%', background: !webControl ? '#ff1744' : 'transparent', boxShadow: !webControl ? '0 0 8px #ff1744' : 'none', transition: 'all 0.2s' }}/>
            Terminal
          </div>
          <div style={S.toggleOpt(webControl, '#00e676')}>
            <div style={{ width: '8px', height: '8px', borderRadius: '30%', background: webControl ? '#00e676' : 'transparent', boxShadow: webControl ? '0 0 8px #00e676' : 'none', transition: 'all 0.2s' }}/>
            UI
          </div>
        </div>
      </div>

      <div style={S.controlBody}>
        <div style={S.dpad}>
          <div/> <VKey keyName="i" label="I"/> <div/>
          <VKey  keyName="j" label="J"/>
          <VKey  keyName="k" label="K"/>
          <VKey  keyName="l" label="L"/>
          <div/> <VKey keyName="," label=","/> <div/>
        </div>

        <div style={S.sliderCol}>
          <div style={S.sliderRow}>
            <div style={{ display: 'flex', flexDirection: 'column', width: '55px' }}>
              <span>Speed</span>
              <span style={{ fontSize: '9px', opacity: 0.6, marginTop: '-2px' }}>w / x</span>
            </div>
            <input type="range" min="0.1" max="2.0" step="0.1" value={speed} onChange={e => setSpeed(parseFloat(e.target.value))} style={S.slider} disabled={!webControl} />
            <span style={S.val}>{speed.toFixed(2)}</span>
          </div>
          <div style={S.sliderRow}>
            <div style={{ display: 'flex', flexDirection: 'column', width: '55px' }}>
              <span>Angle</span>
              <span style={{ fontSize: '9px', opacity: 0.6, marginTop: '-2px' }}>e / c</span>
            </div>
            <input type="range" min="0.1" max="3.0" step="0.1" value={turnSpeed} onChange={e => setTurnSpeed(parseFloat(e.target.value))} style={S.slider} disabled={!webControl} />
            <span style={S.val}>{turnSpeed.toFixed(2)}</span>
          </div>

          <div style={S.cmdBar}>
            <span>X: <span style={{color: webControl ? (isDark ? '#00e5ff' : '#007b83') : (isDark ? '#9e9ec0' : '#aaaaaa')}}>{(keys['i']) && webControl ? speed.toFixed(2) : (keys[',']) && webControl ? (-speed).toFixed(2) : '0.00'}</span></span>
            <span>Z: <span style={{color: webControl ? (isDark ? '#00e5ff' : '#007b83') : (isDark ? '#9e9ec0' : '#aaaaaa')}}>{(keys['j']) && webControl ? turnSpeed.toFixed(2) : (keys['l']) && webControl ? (-turnSpeed).toFixed(2) : '0.00'}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SimSelector
// ─────────────────────────────────────────────────────────────────────────────
function SimSelector({ onSwitch, onStop, isDark, isWaitingOdom }) {
  const [robotList,  setRobotList]  = useState([]);
  const [worldList,  setWorldList]  = useState([]);
  const [selRobot,   setSelRobot]   = useState('');
  const [selWorld,   setSelWorld]   = useState('');
  const [simStatus,  setSimStatus]  = useState(null);
  const [switching,  setSwitching]  = useState(false);
  const [switchMsg,  setSwitchMsg]  = useState('');
  const statusRef    = useRef(null);
  const autoLaunched = useRef(false);

  const doSwitch = useCallback(async (robot, world) => {
    if (!robot || !world) return;
    setSwitching(true);
    setSwitchMsg('');
    try {
      const res  = await fetch(SWITCH_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ robot, world }),
      });
      const data = await res.json();
      setSwitchMsg(data.message ?? (data.ok ? 'Launching…' : 'Error'));
      if (data.ok && onSwitch) setTimeout(() => onSwitch(robot, world), 3000);
    } catch (err) {
      setSwitchMsg(`${err.message}`);
    } finally {
      setSwitching(false);
    }
  }, [onSwitch]);

  useEffect(() => {
    const init = async () => {
      try {
        const [robotRes, worldRes, statusRes] = await Promise.all([
          fetch(ROBOTS_URL),
          fetch('http://localhost:3001/worlds'),
          fetch(STATUS_URL),
        ]);
        const robotData  = await robotRes.json();
        const worldData  = await worldRes.json();
        const statusData = await statusRes.json();

        const robots = robotData.robots ?? [];
        const worlds = worldData.worlds ?? [];
        setRobotList(robots);
        setWorldList(worlds);

        const defaultRobot = statusData.robot ?? robots[0]?.name ?? '';
        const defaultWorld = statusData.world ?? worlds[0]?.name ?? '';
        setSelRobot(defaultRobot);
        setSelWorld(defaultWorld);

        if (!autoLaunched.current && statusData.status !== 'running' && statusData.status !== 'launching' && defaultRobot && defaultWorld) {
          autoLaunched.current = true;
          setSwitchMsg('Auto-launching simulation…');
          await doSwitch(defaultRobot, defaultWorld);
        }
      } catch (err) {
        setSwitchMsg(`Cannot reach map-server: ${err.message}`);
      }
    };
    init();
  }, [doSwitch]);

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(STATUS_URL);
        const d = await r.json();
        setSimStatus(d);
      } catch { /* ignore */ }
    };
    poll();
    statusRef.current = setInterval(poll, STATUS_INTERVAL);
    return () => clearInterval(statusRef.current);
  }, []);

  const handleSwitch = () => doSwitch(selRobot, selWorld);
  const handleStop   = async () => {
    try {
      await fetch(STOP_URL, { method: 'POST' });
      setSwitchMsg('ROS stopped');
      if (onStop) onStop();
    } catch (err) {
      setSwitchMsg(`${err.message}`);
    }
  };

  let displayStatus = simStatus?.status ?? 'idle';
  if (displayStatus === 'running' && isWaitingOdom) {
    displayStatus = 'waiting for robot';
  }

  const statusColor = {
    running: isDark ? '#4caf50' : '#2e7d32', 
    launching: isDark ? '#ff9800' : '#f57c00',
    'waiting for robot': isDark ? '#29b6f6' : '#0288d1',
    stopping: isDark ? '#ff9800' : '#f57c00', 
    error: isDark ? '#f44336' : '#c62828', 
    idle: isDark ? '#9e9ec0' : '#999999',
  }[displayStatus] ?? (isDark ? '#9e9ec0' : '#999999');

  const S = {
    wrap:  { 
      background: isDark ? '#121212' : '#ffffff', 
      border: `1px solid ${isDark ? '#333333' : '#e0e0e0'}`, 
      borderRadius: '16px', padding: '20px',
      boxShadow: isDark ? 'none' : '0 4px 16px rgba(0,0,0,0.05)',
      display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0,
      minWidth: 0, overflow: 'hidden'
    },
    title: { fontSize:'18px', fontWeight:600, color: isDark ? '#90caf9' : '#1976d2', marginBottom:'16px', textAlign: 'center' },
    grid:  { display:'grid', gridTemplateColumns:'minmax(0, 1fr) minmax(0, 1fr)', gap:'12px', marginBottom:'16px', flex: 1, minHeight: 0 },
    col:   { display:'flex', flexDirection:'column', gap:'6px', overflowY: 'auto', paddingRight: '6px' },
    label: { fontSize:'12px', color: isDark ? '#9e9ec0' : '#666666', textTransform:'uppercase', position: 'sticky', top: 0, background: isDark ? '#121212' : '#ffffff', zIndex: 1, paddingBottom: '6px', fontWeight: 600, letterSpacing: '1px', textAlign: 'center' },
    card:  (active) => ({
      padding:'10px 14px', borderRadius:'8px',
      border: active ? `2px solid ${isDark ? '#90caf9' : '#1976d2'}` : `1px solid ${isDark ? '#ffffff20' : '#e0e0e0'}`,
      background: active ? (isDark ? '#1a237e55' : '#e3f2fd') : (isDark ? '#ffffff08' : '#f8f9fa'),
      cursor:'pointer', transition:'all 0.15s', userSelect:'none', flexShrink: 0
    }),
    cardName: (active) => ({ fontWeight:600, fontSize:'14px', color: active ? (isDark ? '#90caf9' : '#1565c0') : (isDark ? '#e0e0e0' : '#333333'), display: 'block', textAlign: 'center' }),
    btnRow:  { display:'flex', gap:'12px', alignItems: 'stretch' },
    btnLaunch: { background: isDark ? '#3949ab' : '#1976d2', border: 'none', color:'#fff', borderRadius:'8px', padding:'10px 16px', cursor:'pointer', fontSize:'14px', fontWeight:600, flex: 1 },
    btnStop: { background: isDark ? '#b71c1c44' : '#ffebee', border: 'none', color: isDark ? '#ef9a9a' : '#c62828', borderRadius:'8px', padding:'10px 20px', cursor:'pointer', fontSize:'14px', fontWeight:600 },
    statusBar: { display:'flex', alignItems:'center', gap:'10px', background: isDark ? '#ffffff06' : '#f5f5f5', borderRadius:'8px', padding:'0 16px' },
    dot: { width:'10px', height:'10px', borderRadius:'50%', background:statusColor, boxShadow:`0 0 6px ${statusColor}`, flexShrink:0 },
  };

  return (
    <div style={S.wrap}>
      <div style={S.title}>Simulation Config</div>
      <div style={S.grid}>
        <div style={S.col}>
          <div style={S.label}>Robot</div>
          {robotList.map((r) => {
            const displayName = r.robotName || r.name.replace(/\.urdf$/i, '');
            return (
              <div key={r.name} style={S.card(selRobot === r.name)} onClick={() => setSelRobot(r.name)}>
                <span style={S.cardName(selRobot === r.name)}>{displayName}</span>
              </div>
            );
          })}
        </div>
        <div style={S.col}>
          <div style={S.label}>World</div>
          {worldList.map((w) => {
            const displayName = w.mapName || w.name.replace(/\.json$/i, '');
            return (
              <div key={w.name} style={S.card(selWorld === w.name)} onClick={() => setSelWorld(w.name)}>
                <span style={S.cardName(selWorld === w.name)}>{displayName}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={S.btnRow}>
        <button style={S.btnLaunch} onClick={handleSwitch} disabled={switching || !selRobot || !selWorld}>{switching ? 'Wait…' : 'Launch'}</button>
        <button style={S.btnStop} onClick={handleStop}>Stop</button>
        
        {(displayStatus !== 'idle') && (
          <div style={S.statusBar}>
            <div style={S.dot}/>
            <span style={{ fontSize:'12px', color:statusColor, fontWeight:700, letterSpacing: '1px', whiteSpace: 'nowrap' }}>
              {displayStatus.toUpperCase()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Topic Monitor (Popup Style)
// ─────────────────────────────────────────────────────────────────────────────
function TopicMonitor({ ros, isDark }) {
  const [topics, setTopics] = useState([]);
  const [selTopic, setSelTopic] = useState('');
  const [msgData, setMsgData] = useState(null);
  const subRef = useRef(null);

  const refreshTopics = useCallback(() => {
    if (!ros) return;
    ros.getTopics((result) => {
      const list = result.topics.map((t, i) => ({ name: t, type: result.types[i] }));
      setTopics(list);
    });
  }, [ros]);

  useEffect(() => {
    refreshTopics();
    const inv = setInterval(refreshTopics, 5000);
    return () => clearInterval(inv);
  }, [refreshTopics]);

  useEffect(() => {
    if (subRef.current) {
      subRef.current.unsubscribe();
      subRef.current = null;
    }
    setMsgData(null);
    
    if (!selTopic || !ros) return;
    const t = topics.find(x => x.name === selTopic);
    if (!t) return;

    const listener = new ROSLIB.Topic({
      ros: ros,
      name: t.name,
      messageType: Array.isArray(t.type) ? t.type[0] : t.type 
    });

    listener.subscribe((m) => {
      setMsgData(m);
    });
    subRef.current = listener;

    return () => {
      if (subRef.current) {
        subRef.current.unsubscribe();
        subRef.current = null;
      }
    };
  }, [selTopic, ros, topics]);

  const S = {
    wrap: {
      background: isDark ? '#151525f0' : '#fffffffa', 
      border: `1px solid ${isDark ? '#ffffff30' : '#e0e0e0'}`, 
      borderRadius: '16px', padding: '20px', backdropFilter: 'blur(12px)',
      boxShadow: isDark ? '0 16px 40px rgba(0,0,0,0.5)' : '0 16px 40px rgba(0,0,0,0.15)',
      display: 'flex', flexDirection: 'column', gap: '14px'
    },
    title: { fontSize:'18px', fontWeight:600, color: isDark ? '#90caf9' : '#1976d2', textAlign: 'center' },
    select: {
      width: '100%', padding: '10px', borderRadius: '8px',
      background: isDark ? '#ffffff10' : '#f5f5f5', color: isDark ? '#e0e0e0' : '#333',
      border: `1px solid ${isDark ? '#ffffff20' : '#ccc'}`,
      fontSize: '14px', outline: 'none', cursor: 'pointer', fontWeight: 500,
      colorScheme: isDark ? 'dark' : 'light'
    },
    dataBox: {
      height: '240px', overflowY: 'auto', padding: '12px',
      background: isDark ? '#00000088' : '#f8f9fa',
      border: `1px solid ${isDark ? '#ffffff15' : '#eee'}`, borderRadius: '8px',
      fontSize: '12px', fontFamily: 'monospace', color: isDark ? '#a5d6ff' : '#005b9f'
    }
  };

  return (
    <div style={S.wrap}>
      <div style={S.title}>Topic Monitor</div>
      <select style={S.select} value={selTopic} onChange={(e) => setSelTopic(e.target.value)}>
        <option value="" style={{ background: isDark ? '#1a1a1a' : '#ffffff', color: isDark ? '#e0e0e0' : '#333' }}>
          -- Select a topic --
        </option>
        {topics.map(t => (
          <option
            key={t.name}
            value={t.name}
            style={{ background: isDark ? '#1a1a1a' : '#ffffff', color: isDark ? '#e0e0e0' : '#333' }}
          >
            {t.name}
          </option>
        ))}
      </select>
      <div style={S.dataBox}>
        {selTopic ? (
          msgData !== null ? (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify(msgData, null, 2)}
            </pre>
          ) : (
            'Waiting for data...'
          )
        ) : (
          'No topic selected'
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App (Main - No Scroll Layout)
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {

  const [status,      setStatus]      = useState('Disconnected');
  const [pose,        setPose]        = useState({ x: '-', y: '-', theta: '-' });
  const [mapData,     setMapData]     = useState(null);
  const [mapName,     setMapName]     = useState('');
  const [mapStatus,   setMapStatus]   = useState('idle');
  const [urdf,        setUrdf]        = useState(null);
  const [activeWorld, setActiveWorld] = useState('room.json');
  const [activeRobot, setActiveRobot] = useState('tango.urdf');
  const [rosObj,      setRosObj]      = useState(null);
  
  const [showMonitor, setShowMonitor] = useState(false); 
  const [isDark,      setIsDark]      = useState(true);
  const [isWaitingOdom, setIsWaitingOdom] = useState(false);

  const mapWrapRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ w: 400, h: 300 });

  useEffect(() => {
    const updateSize = () => {
      if (mapWrapRef.current) {
        setCanvasSize({
          w: mapWrapRef.current.clientWidth,
          h: mapWrapRef.current.clientHeight
        });
      }
    };
    updateSize(); 
    setTimeout(updateSize, 100);
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const rosRef   = useRef(null);
  const odomRef  = useRef(null);
  const fetchRef = useRef(null);

  useEffect(() => {
    let retryTimer = null;
    const connect = () => {
      const ros = new ROSLIB.Ros({ url: ROSBRIDGE_URL });
      rosRef.current = ros;

      ros.on('connection', () => { setStatus('Connected to ROS 2'); setRosObj(ros); });
      ros.on('error', () => { setStatus('Connection error'); setRosObj(null); retryTimer = setTimeout(connect, 3000); });
      ros.on('close', () => { setStatus('Disconnected'); setRosObj(null); retryTimer = setTimeout(connect, 3000); });
    };
    connect();
    return () => { clearTimeout(retryTimer); rosRef.current?.close(); };
  }, []);

  useEffect(() => {
    if (!rosObj) return;
    const odom = new ROSLIB.Topic({
      ros: rosObj, name: '/odom', messageType: 'nav_msgs/msg/Odometry',
      qos_profile: { reliability: 'reliable', durability: 'volatile', history: 'keep_last', depth: 10 }
    });
    odom.subscribe((msg) => {
      const x = msg.pose.pose.position.x;
      const y = msg.pose.pose.position.y;
      const q_z = msg.pose.pose.orientation.z;
      const q_w = msg.pose.pose.orientation.w;
      const theta = 2.0 * Math.atan2(q_z, q_w);
      
      setPose({ x: x.toFixed(2), y: y.toFixed(2), theta: (theta * 180 / Math.PI).toFixed(1) });
      
      if (Math.abs(x) <= 0.05 && Math.abs(y) <= 0.05) {
        setIsWaitingOdom(false);
      }
    });
    odomRef.current = odom;
    return () => { odom.unsubscribe(); odomRef.current = null; };
  }, [rosObj]);

  const fetchMap = useCallback(async () => {
    setMapStatus('loading');
    try {
      const res = await fetch(`${MAP_SERVER_URL}?file=${activeWorld}`);
      if (!res.ok) throw new Error();
      const raw = await res.json();
      setMapName(raw._meta?.mapName ?? raw.name ?? 'Unknown');
      setMapData(normaliseMap(raw));
      setMapStatus('ok');
    } catch (err) { setMapStatus('error'); }
  }, [activeWorld]);

  useEffect(() => { fetchMap(); fetchRef.current = setInterval(fetchMap, FETCH_INTERVAL); return () => clearInterval(fetchRef.current); }, [fetchMap]);

  const fetchUrdf = useCallback(async (robotFile) => {
    const file = robotFile ?? activeRobot;
    try {
      const res = await fetch(`${URDF_SERVER_URL}?file=${file}`);
      if (!res.ok) throw new Error();
      const xml = await res.text();
      setUrdf(parseURDF(xml));
    } catch (err) { /* ignore */ }
  }, [activeRobot]);

  useEffect(() => { fetchUrdf(); }, [fetchUrdf]);

  const handleSwitch = useCallback((robot, world) => {
    setIsWaitingOdom(true);
    setPose({ x: '-', y: '-', theta: '-' });
    setActiveRobot(robot); setActiveWorld(world);
    setTimeout(() => { fetchUrdf(robot); fetchMap(); }, 2000);
  }, [fetchUrdf, fetchMap]);

  const rosConnected = status.includes('Connected');
  const mapBadgeText = mapStatus === 'ok' ? 'Loaded' : mapStatus === 'loading' ? 'Loading' : mapStatus === 'error' ? 'Error' : 'Waiting';

  const S = {
    app: { 
      height: '100vh', width: '100vw', overflow: 'hidden', 
      background: isDark ? '#08080c' : '#f0f2f5', 
      color: isDark ? '#e0e0e0' : '#333333', 
      fontFamily: "'Segoe UI',sans-serif", padding: '20px', display: 'flex', justifyContent: 'center', boxSizing: 'border-box' 
    },
    wrap: { width: '100%', maxWidth: '1600px', display: 'flex', flexDirection: 'column', height: '100%' },
    
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexShrink: 0 },
    titleBox: { display: 'flex', alignItems: 'center', gap: '24px' },
    h1: { fontSize: '24px', fontWeight: 700, margin: 0, color: isDark ? '#fff' : '#111' },
    statusBox: { display: 'flex', alignItems: 'center', gap: '10px', background: isDark ? '#121212' : '#ffffff', padding: '8px 16px', borderRadius: '10px', fontSize: '14px', border: `1px solid ${isDark ? '#333' : '#ddd'}`, boxShadow: isDark ? 'none' : '0 2px 8px rgba(0,0,0,0.04)', fontWeight: 500 },
    dot: (on) => ({ width: '12px', height: '12px', borderRadius: '50%', background: on ? (isDark?'#4caf50':'#388e3c') : (isDark?'#f44336':'#d32f2f'), boxShadow: on ? `0 0 8px ${isDark?'#4caf50':'#388e3c'}` : 'none' }),
    
    btnGroup: { display: 'flex', gap: '12px' },
    topBtn: {
      display: 'flex', alignItems: 'center', gap: '8px',
      background: isDark ? '#121212' : '#ffffff', border: `1px solid ${isDark ? '#333' : '#ccc'}`,
      color: isDark ? '#90caf9' : '#1976d2', borderRadius: '10px', padding: '8px 16px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', boxShadow: isDark ? 'none' : '0 2px 8px rgba(0,0,0,0.04)', transition: 'all 0.2s'
    },
    topBtnActive: {
      display: 'flex', alignItems: 'center', gap: '8px',
      background: isDark ? '#1a237e' : '#e3f2fd', border: `1px solid ${isDark ? '#3949ab' : '#90caf9'}`,
      color: isDark ? '#ffffff' : '#1565c0', borderRadius: '10px', padding: '8px 16px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', boxShadow: isDark ? 'none' : '0 2px 8px rgba(0,0,0,0.04)', transition: 'all 0.2s'
    },

    mainContent: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 2.5fr) minmax(0, 1fr)',
      gridTemplateRows: 'minmax(0, 1fr)',
      gap: '20px', flex: 1, minHeight: 0
    },

    mapCard: { 
      display: 'flex', flexDirection: 'column', 
      background: isDark ? '#121212' : '#ffffff', border: `1px solid ${isDark ? '#333333' : '#e0e0e0'}`, borderRadius: '16px', padding: '16px', height: '100%', boxSizing: 'border-box', boxShadow: isDark ? 'none' : '0 6px 16px rgba(0,0,0,0.04)',
      minWidth: 0, minHeight: 0
    },
    mapHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexShrink: 0 },
    mapCanvasWrap: { flex: 1, minHeight: 0, background: isDark ? '#0d0d1a' : '#e6e9ec', borderRadius: '10px', border: `1px solid ${isDark ? '#ffffff15' : '#cccccc'}`, overflow: 'hidden' },

    rightPanel: {
      display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', minHeight: 0, minWidth: 0 
    },

    poseCard: { background: isDark ? '#121212' : '#ffffff', border: `1px solid ${isDark ? '#333333' : '#e0e0e0'}`, borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: isDark ? 'none' : '0 6px 16px rgba(0,0,0,0.04)', overflow: 'hidden' },
    poseGrid: { display: 'flex', gap: '16px', alignItems: 'stretch', minWidth: 0 },
    poseItem: { background: isDark ? '#ffffff08' : '#f8f9fa', border: `1px solid ${isDark ? '#ffffff10' : '#eeeeee'}`, borderRadius: '10px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', flex: '1 1 0', minWidth: 0, padding: '20px 10px' },
    poseLabel: { fontSize: '20px', fontWeight: 700, color: isDark ? '#9e9ec0' : '#666', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '1px' },
    poseVal: { fontSize: '32px', fontWeight: 700, color: isDark ? '#00e5ff' : '#007b83', fontFamily: 'monospace' },

    popupWrap2: { position: 'fixed', top: '75px', right: '20px', width: '380px', zIndex: 1000, display: showMonitor ? 'block' : 'none' }
  };

  return (
    <>
      <style>{`
        body, html, #root { margin: 0 !important; padding: 0 !important; width: 100% !important; height: 100% !important; background-color: ${isDark ? '#08080c' : '#f0f2f5'} !important; overflow: hidden; }
        * { box-sizing: border-box; }
      `}</style>

      <div style={S.app}>

        <div style={S.popupWrap2}><TopicMonitor ros={rosObj} isDark={isDark} /></div>

        <div style={S.wrap}>
          
          <div style={S.header}>
            <div style={S.titleBox}>
              <h1 style={S.h1}>AMR Dashboard</h1>
              <div style={S.statusBox}><div style={S.dot(rosConnected)}/>{status}</div>
            </div>
            
            <div style={S.btnGroup}>
              {/* Theme Toggle */}
              <button style={S.topBtn} onClick={() => setIsDark(!isDark)}>
                {isDark ? (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                    Dark Mode
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                    Light Mode
                  </>
                )}
              </button>

              <button 
                style={showMonitor ? S.topBtnActive : S.topBtn} 
                onClick={() => setShowMonitor(!showMonitor)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                Monitor
              </button>
            </div>
          </div>

          <div style={S.mainContent}>
            <div style={S.mapCard}>
              <div style={S.mapHeader}>
                <div style={{ fontSize:'18px', fontWeight:600, color: isDark ? '#90caf9' : '#1976d2' }}>
                  Map: <span style={{ color: isDark ? '#fff' : '#111' }}>{mapName || 'Loading...'}</span>
                  <span style={{ padding:'3px 8px', fontSize:'12px', borderRadius:'6px', border:'1px solid', marginLeft:'12px',
                    background: isDark?'#1b5e2033':'#e8f5e9', color: isDark?'#81c784':'#2e7d32', borderColor: isDark?'#4caf5055':'#81c784' 
                  }}>{mapBadgeText}</span>
                </div>
                <button style={{ background: 'transparent', border: 'none', color: isDark ? '#90caf9' : '#1976d2', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }} onClick={fetchMap}>↻ REFRESH</button>
              </div>

              <div style={S.mapCanvasWrap} ref={mapWrapRef}>
                <WorldMap mapData={mapData} pose={pose} urdf={urdf} width={canvasSize.w} height={canvasSize.h} isDark={isDark} />
              </div>
            </div>

            <div style={S.rightPanel}>
              <div style={S.poseCard}>
                <div style={{ fontSize:'18px', fontWeight:600, color: isDark ? '#90caf9' : '#1976d2', marginBottom:'16px', textAlign: 'center' }}>Odometry</div>
                <div style={S.poseGrid}>
                  {[
                    { label:'X', value: pose.x, unit:'[m]' },
                    { label:'Y', value: pose.y, unit:'[m]' },
                    { label:'Angle', value: pose.theta === '-' ? '-' : `${pose.theta}°`, unit:'[degrees]' },
                  ].map(({ label, value, unit }) => (
                    <div key={label} style={S.poseItem}>
                      <div style={S.poseLabel}>{label}</div>
                      <div style={S.poseVal}>{value}</div>
                      <div style={{ fontSize: '12px', color: isDark ? '#9e9ec0' : '#888', marginTop: '4px' }}>{unit}</div>
                    </div>
                  ))}
                </div>
              </div>

                <SimSelector onSwitch={handleSwitch} onStop={() => setIsWaitingOdom(false)} isDark={isDark} isWaitingOdom={isWaitingOdom} />
                
                <KeyboardController ros={rosObj} isDark={isDark}/>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}