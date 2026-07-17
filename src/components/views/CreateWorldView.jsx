import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import useAppStore from '../../store/useAppStore';
import SplitButton from '../common/SplitButton';
import './CreateWorldView.css';

const HOST = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
const SAVE_MAP_URL = `http://${HOST}:3001/save_map`;

// Transform helper now accounts for zoom and pan
function buildTransformEditor(mapInfo, canvasW, canvasH, zoom, pan) {
  const { origin_x, origin_y, width: mw, height: mh } = mapInfo;
  const baseScale = Math.min(canvasW / mh, canvasH / mw) * 0.9;
  const scale = baseScale * zoom;
  
  // Center offset
  const offsetX = (canvasW - mh * scale) / 2 + pan.x;
  const offsetY = (canvasH - mw * scale) / 2 + pan.y;
  
  return {
    scale,
    offsetX,
    offsetY,
    toCanvas: (wx, wy) => ({
      cx: Math.round(canvasW - offsetX - (wy - origin_y) * scale) + 0.5,
      cy: Math.round(canvasH - offsetY - (wx - origin_x) * scale) + 0.5,
    }),
    fromCanvas: (cx, cy) => ({
      wx: origin_x + (canvasH - offsetY - cy + 0.5) / scale,
      wy: origin_y + (canvasW - offsetX - cx + 0.5) / scale,
    }),
  };
}

export default function CreateWorldView() {
  const navigate = useNavigate();
  const { isDark } = useAppStore();
  
  const [mapName, setMapName] = useState("custom_map");
  const [tool, setTool] = useState("wall"); // "wall", "obstacle", "eraser", "pan"
  const [wallThickness, setWallThickness] = useState(0.12);
  
  // History state for Undo/Redo
  const [history, setHistory] = useState([{ walls: [], obstacles: [] }]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const [availableMaps, setAvailableMaps] = useState([]);

  const fetchMapsList = () => {
    fetch(`http://${HOST}:3001/worlds`)
      .then(r => r.json())
      .then(data => setAvailableMaps(data.files || []))
      .catch(console.error);
  };

  useEffect(() => {
    fetchMapsList();
  }, []);

  const currentMapState = history[historyIndex];
  const walls = currentMapState.walls;
  const obstacles = currentMapState.obstacles;

  // View state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const gridSize = 10;
  const mapInfo = useMemo(() => ({
    origin_x: -gridSize,
    origin_y: -gridSize,
    width: gridSize * 2,
    height: gridSize * 2,
  }), [gridSize]);

  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const updateSize = () => {
      if (wrapRef.current) {
        setCanvasSize({
          w: wrapRef.current.clientWidth,
          h: wrapRef.current.clientHeight,
        });
      }
    };
    updateSize();
    setTimeout(updateSize, 100);
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Interaction State
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPt, setStartPt] = useState(null); // World coords
  const [curPt, setCurPt] = useState(null); // World coords
  const [mouseWorldPos, setMouseWorldPos] = useState({ x: 0, y: 0 }); // For HUD
  
  const [eraserMode, setEraserMode] = useState("radius"); // "box" or "radius"
  const eraserRadius = 0.25; // meter radius
  
  const [isZooming, setIsZooming] = useState(false);
  const zoomTimeout = useRef(null);
  
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPt, setLastPanPt] = useState(null); // Screen coords
  
  const [spacePressed, setSpacePressed] = useState(false);

  const transform = useMemo(() => buildTransformEditor(mapInfo, canvasSize.w, canvasSize.h, zoom, pan), [mapInfo, canvasSize.w, canvasSize.h, zoom, pan]);
  const snap = (val) => Math.round(val * 2) / 2;

  const pushHistory = useCallback((newWalls, newObstacles) => {
    const newState = { walls: newWalls, obstacles: newObstacles };
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newState);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) setHistoryIndex(historyIndex - 1);
  }, [historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) setHistoryIndex(historyIndex + 1);
  }, [historyIndex, history]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') setSpacePressed(true);
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    const handleKeyUp = (e) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleUndo, handleRedo]);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const { wx, wy } = transform.fromCanvas(cx, cy);
    
    // Default grid snapping
    let snappedX = snap(wx);
    let snappedY = snap(wy);

    // Smart Snapping to existing endpoints
    if (tool === "wall") {
      const SNAP_RADIUS = 0.2;
      let closestDist = SNAP_RADIUS;
      walls.forEach(w => {
        [w.start, w.end].forEach(pt => {
          const dist = Math.hypot(wx - pt[0], wy - pt[1]);
          if (dist < closestDist) {
            closestDist = dist;
            snappedX = pt[0];
            snappedY = pt[1];
          }
        });
      });
    }

    return { cx, cy, wx, wy, snappedX, snappedY };
  };

  const deleteInRadius = (wx, wy) => {
    const r = eraserRadius;
    const isWallInRadius = (w) => {
      const l2 = (w.end[0]-w.start[0])**2 + (w.end[1]-w.start[1])**2;
      if (l2 === 0) return Math.hypot(wx-w.start[0], wy-w.start[1]) <= r;
      let t = ((wx-w.start[0])*(w.end[0]-w.start[0]) + (wy-w.start[1])*(w.end[1]-w.start[1])) / l2;
      t = Math.max(0, Math.min(1, t));
      const px = w.start[0] + t*(w.end[0]-w.start[0]);
      const py = w.start[1] + t*(w.end[1]-w.start[1]);
      return Math.hypot(wx - px, wy - py) <= r;
    };
    const isObsInRadius = (o) => {
      const cx = Math.max(o.x, Math.min(wx, o.x + o.w));
      const cy = Math.max(o.y, Math.min(wy, o.y + o.h));
      return Math.hypot(wx - cx, wy - cy) <= r;
    };
    const newWalls = walls.filter(w => !isWallInRadius(w));
    const newObs = obstacles.filter(o => !isObsInRadius(o));
    if (newWalls.length !== walls.length || newObs.length !== obstacles.length) {
      pushHistory(newWalls, newObs);
    }
  };

  const handlePointerDown = (e) => {
    const pos = getPos(e);
    
    // Pan trigger (middle mouse or space+click or tool='pan')
    if (e.button === 1 || spacePressed || tool === "pan") {
      setIsPanning(true);
      setLastPanPt({ x: e.clientX, y: e.clientY });
      return;
    }

    if (e.button !== 0) return; // Only left click for tools

    if (tool === "eraser") {
      if (eraserMode === "box") {
        // Selection box start
        setIsDrawing(true);
        setStartPt({ x: pos.wx, y: pos.wy });
        setCurPt({ x: pos.wx, y: pos.wy });
      } else {
        // Instant delete in radius
        deleteInRadius(pos.wx, pos.wy);
      }
      return;
    }

    if (tool === "wall" || tool === "obstacle") {
      if (!isDrawing) {
        // First click (Point-to-Point start)
        setIsDrawing(true);
        setStartPt({ x: pos.snappedX, y: pos.snappedY });
        setCurPt({ x: pos.snappedX, y: pos.snappedY });
      } else {
        // Second click (Point-to-Point end)
        setIsDrawing(false);
        if (startPt.x === pos.snappedX && startPt.y === pos.snappedY) {
            setStartPt(null);
            setCurPt(null);
            return;
        }

        if (tool === "wall") {
          const newWalls = [...walls, { start: [startPt.x, startPt.y], end: [pos.snappedX, pos.snappedY], thickness: wallThickness }];
          pushHistory(newWalls, obstacles);
        } else if (tool === "obstacle") {
          const w = Math.abs(pos.snappedX - startPt.x);
          const h = Math.abs(pos.snappedY - startPt.y);
          const x = Math.min(startPt.x, pos.snappedX);
          const y = Math.min(startPt.y, pos.snappedY);
          const newObstacles = [...obstacles, { type: "rect", x, y, w, h }];
          pushHistory(walls, newObstacles);
        }
        setStartPt(null);
        setCurPt(null);
      }
    }
  };

  const handlePointerMove = (e) => {
    if (isPanning && lastPanPt) {
      const dx = e.clientX - lastPanPt.x;
      const dy = e.clientY - lastPanPt.y;
      setPan({ x: pan.x - dx, y: pan.y - dy });
      setLastPanPt({ x: e.clientX, y: e.clientY });
      return;
    }

    const pos = getPos(e);
    setMouseWorldPos({ x: pos.wx, y: pos.wy });

    if (isDrawing) {
      if (tool === "eraser") {
        setCurPt({ x: pos.wx, y: pos.wy }); // don't snap for eraser selection
      } else {
        setCurPt({ x: pos.snappedX, y: pos.snappedY });
      }
    }
  };

  const handlePointerUp = (e) => {
    if (isPanning) {
      setIsPanning(false);
      setLastPanPt(null);
      return;
    }

    if (tool === "eraser" && isDrawing && eraserMode === "box") {
      setIsDrawing(false);
      // Delete everything inside the selection box
      const minX = Math.min(startPt.x, curPt.x);
      const maxX = Math.max(startPt.x, curPt.x);
      const minY = Math.min(startPt.y, curPt.y);
      const maxY = Math.max(startPt.y, curPt.y);

      // Helper to check if line intersects or is inside rect
      const isWallInSelection = (w) => {
         const inX = (x) => x >= minX && x <= maxX;
         const inY = (y) => y >= minY && y <= maxY;
         if (inX(w.start[0]) && inY(w.start[1])) return true;
         if (inX(w.end[0]) && inY(w.end[1])) return true;
         // Simple midpoint check as fallback
         const midX = (w.start[0] + w.end[0]) / 2;
         const midY = (w.start[1] + w.end[1]) / 2;
         if (inX(midX) && inY(midY)) return true;
         return false;
      };

      const isObsInSelection = (o) => {
         return !(o.x + o.w < minX || o.x > maxX || o.y + o.h < minY || o.y > maxY);
      };

      const newWalls = walls.filter(w => !isWallInSelection(w));
      const newObstacles = obstacles.filter(o => !isObsInSelection(o));
      
      if (newWalls.length !== walls.length || newObstacles.length !== obstacles.length) {
         pushHistory(newWalls, newObstacles);
      }
      
      setStartPt(null);
      setCurPt(null);
    }
  };

  const handleWheel = (e) => {
    const zoomSensitivity = 0.001;
    const delta = e.deltaY;
    setZoom((z) => Math.max(0.1, Math.min(10, z - delta * zoomSensitivity)));
    setIsZooming(delta > 0 ? "out" : "in");
    clearTimeout(zoomTimeout.current);
    zoomTimeout.current = setTimeout(() => setIsZooming(false), 200);
  };

  const drawStateRef = useRef({ walls, obstacles, isDrawing, startPt, curPt, isDark, transform, mapInfo, canvasSize, tool, eraserMode, eraserRadius, mouseWorldPos, isPanning });
  drawStateRef.current = { walls, obstacles, isDrawing, startPt, curPt, isDark, transform, mapInfo, canvasSize, tool, eraserMode, eraserRadius, mouseWorldPos, isPanning };
  
  useEffect(() => {
    let animationFrameId;

    const renderCanvas = () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      
      const state = drawStateRef.current;
      const { w, h } = state.canvasSize;
      
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = state.isDark ? "#1e1e24" : "#f5f5f5";
      ctx.fillRect(0, 0, w, h);

      // Grid (1m = 1 unit)
      ctx.strokeStyle = state.isDark ? "#ffffff15" : "#00000015";
      ctx.lineWidth = 1;
      
      for (let i = state.mapInfo.origin_x; i <= state.mapInfo.origin_x + state.mapInfo.width; i += 1) {
        const { cx: x1, cy: y1 } = state.transform.toCanvas(i, state.mapInfo.origin_y);
        const { cx: x2, cy: y2 } = state.transform.toCanvas(i, state.mapInfo.origin_y + state.mapInfo.height);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      for (let j = state.mapInfo.origin_y; j <= state.mapInfo.origin_y + state.mapInfo.height; j += 1) {
        const { cx: x1, cy: y1 } = state.transform.toCanvas(state.mapInfo.origin_x, j);
        const { cx: x2, cy: y2 } = state.transform.toCanvas(state.mapInfo.origin_x + state.mapInfo.width, j);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }

      // Existing Walls
      ctx.strokeStyle = state.isDark ? "#e0e0e0" : "#222222";
      ctx.lineCap = "round";
      state.walls.forEach((w) => {
        const p1 = state.transform.toCanvas(w.start[0], w.start[1]);
        const p2 = state.transform.toCanvas(w.end[0], w.end[1]);
        // Scale thickness to canvas pixels
        ctx.lineWidth = Math.max(2, w.thickness * state.transform.scale);
        ctx.beginPath(); ctx.moveTo(p1.cx, p1.cy); ctx.lineTo(p2.cx, p2.cy); ctx.stroke();
      });

      // Existing Obstacles
      ctx.fillStyle = "#ef535077";
      ctx.strokeStyle = "#ef5350";
      ctx.lineWidth = 2;
      state.obstacles.forEach((o) => {
        const p1 = state.transform.toCanvas(o.x, o.y);
        const p2 = state.transform.toCanvas(o.x + o.w, o.y);
        const p3 = state.transform.toCanvas(o.x + o.w, o.y + o.h);
        const p4 = state.transform.toCanvas(o.x, o.y + o.h);
        ctx.beginPath(); ctx.moveTo(p1.cx, p1.cy); ctx.lineTo(p2.cx, p2.cy); ctx.lineTo(p3.cx, p3.cy); ctx.lineTo(p4.cx, p4.cy); ctx.closePath(); ctx.fill(); ctx.stroke();
      });

      // Drawing Previews
      if (state.tool === "eraser" && state.eraserMode === "radius" && !state.isPanning) {
          // Highlight eraser circle at current mouse pos
          const { cx, cy } = state.transform.toCanvas(state.mouseWorldPos.x, state.mouseWorldPos.y);
          ctx.fillStyle = "rgba(244, 67, 54, 0.2)";
          ctx.strokeStyle = "#f44336";
          ctx.lineWidth = 1.5;
          ctx.beginPath(); 
          ctx.arc(cx, cy, state.eraserRadius * state.transform.scale, 0, Math.PI * 2); 
          ctx.fill(); 
          ctx.stroke();
      } else if (state.isDrawing && state.startPt && state.curPt) {
        if (state.tool === "eraser") {
          if (state.eraserMode === "box") {
            // Eraser Selection Box
            const p1 = state.transform.toCanvas(state.startPt.x, state.startPt.y);
            const p2 = state.transform.toCanvas(state.curPt.x, state.startPt.y);
            const p3 = state.transform.toCanvas(state.curPt.x, state.curPt.y);
            const p4 = state.transform.toCanvas(state.startPt.x, state.curPt.y);
            
            ctx.fillStyle = "rgba(244, 67, 54, 0.2)";
            ctx.strokeStyle = "#f44336";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            ctx.beginPath(); ctx.moveTo(p1.cx, p1.cy); ctx.lineTo(p2.cx, p2.cy); ctx.lineTo(p3.cx, p3.cy); ctx.lineTo(p4.cx, p4.cy); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.setLineDash([]);
          }
        } else {
          // Wall / Obstacle Ghost Line
          ctx.strokeStyle = "#4caf50";
          ctx.fillStyle = "rgba(76, 175, 80, 0.3)";
          ctx.lineWidth = Math.max(2, 0.12 * state.transform.scale);
          const p1 = state.transform.toCanvas(state.startPt.x, state.startPt.y);
          const p2 = state.transform.toCanvas(state.curPt.x, state.curPt.y);
          
          if (state.tool === "wall") {
            ctx.setLineDash([8, 6]);
            ctx.beginPath(); ctx.moveTo(p1.cx, p1.cy); ctx.lineTo(p2.cx, p2.cy); ctx.stroke();
            ctx.setLineDash([]);
            
            // Draw end point indicator
            ctx.fillStyle = "#4caf50";
            ctx.beginPath(); ctx.arc(p2.cx, p2.cy, 4, 0, Math.PI * 2); ctx.fill();
          } else if (state.tool === "obstacle") {
            const p3 = state.transform.toCanvas(state.startPt.x, state.curPt.y);
            const p4 = state.transform.toCanvas(state.curPt.x, state.startPt.y);
            ctx.setLineDash([5, 5]);
            ctx.beginPath(); ctx.moveTo(p1.cx, p1.cy); ctx.lineTo(p3.cx, p3.cy); ctx.lineTo(p2.cx, p2.cy); ctx.lineTo(p4.cx, p4.cy); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }

      // Origin axes
      const { cx: ox, cy: oy } = state.transform.toCanvas(0, 0);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#ff4444";
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox, oy - 30); ctx.stroke();
      ctx.strokeStyle = "#44ff44";
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox - 30, oy); ctx.stroke();
      
      animationFrameId = requestAnimationFrame(renderCanvas);
    };

    renderCanvas();
    return () => cancelAnimationFrame(animationFrameId);
  }, [canvasSize, walls, obstacles, isDrawing, startPt, curPt, isDark, transform, mapInfo, tool]);

  const validateClosedLoop = (walls) => {
    if (walls.length < 3) return false;
    const pointCounts = {};
    const key = (pt) => `${pt[0].toFixed(3)},${pt[1].toFixed(3)}`;
    walls.forEach(w => {
      const k1 = key(w.start);
      const k2 = key(w.end);
      pointCounts[k1] = (pointCounts[k1] || 0) + 1;
      pointCounts[k2] = (pointCounts[k2] || 0) + 1;
    });
    return Object.values(pointCounts).every(count => count === 2);
  };

  const saveMap = async (launchAfter = false) => {
    if (walls.length > 0 && !validateClosedLoop(walls)) {
      const proceed = window.confirm("Warning: Your map walls do not form a closed loop (some endpoints don't connect). This can cause issues in simulation. Save anyway?");
      if (!proceed) return;
    }

    let finalName = mapName.trim() || "custom_map";
    if (!finalName.endsWith(".json")) finalName += ".json";

    const formattedWalls = walls.map((w) => [w.start, w.end]);
    const mapJson = {
      name: finalName.replace('.json', ''),
      walls: formattedWalls,
      obstacles: obstacles,
      map_info: { origin_x: mapInfo.origin_x, origin_y: mapInfo.origin_y, width: mapInfo.width, height: mapInfo.height },
    };

    try {
      const res = await fetch(SAVE_MAP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: finalName, data: mapJson }),
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      
      const result = await res.json();
      
      const toast = document.createElement("div");
      toast.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#4caf50;color:white;padding:12px 24px;border-radius:8px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-weight:bold;";
      toast.textContent = `✅ Saved ${finalName}`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);

      if (launchAfter) {
         try {
           const switchRes = await fetch(`http://${HOST}:3001/switch`, {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ robot: "amr.urdf", world: finalName }),
           });
           if (switchRes.ok) {
             navigate("/");
           }
         } catch (e) {
             console.error("Failed to launch map", e);
             alert("Failed to launch map. Is the backend running?");
         }
      }
    } catch (err) {
      console.error("Save map error:", err);
      alert(`Failed to save map: ${err.message}`);
    }
  };

  const loadMap = async (fileName) => {
    try {
      const res = await fetch(`http://${HOST}:3001/api/worlds/${fileName}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      
      const loadedWalls = (data.walls || []).map(w => ({ start: w[0], end: w[1], thickness: 0.12 }));
      const loadedObstacles = data.obstacles || [];
      
      setMapName(data.name || fileName.replace('.json', ''));
      pushHistory(loadedWalls, loadedObstacles);
    } catch (err) {
      console.error(err);
      alert("Error loading map");
    }
  };

  const deleteMap = async (fileName) => {
    if (!window.confirm(`Delete ${fileName}?`)) return;
    try {
      const res = await fetch(`http://${HOST}:3001/api/worlds/${fileName}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to delete");
      fetchMapsList();
      alert(`Deleted ${fileName}`);
    } catch (err) {
      console.error(err);
      alert("Error deleting map");
    }
  };

  // Determine cursor
  let cursor = "default";
  if (isZooming === "in") cursor = "zoom-in";
  else if (isZooming === "out") cursor = "zoom-out";
  else if (isPanning) cursor = "grabbing";
  else if (spacePressed) cursor = "grab";
  else if (tool === "wall" || tool === "obstacle") cursor = "crosshair";
  else if (tool === "eraser") cursor = "cell";

  return (
    <div className="view-wrap">
      <div className="toolbar">
        {/* Navigation */}
        <button onClick={() => navigate('/')} className="btn btn-back">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Main Page
        </button>

        <div className="toolbar-divider" />

        {/* Undo / Redo */}
        <button onClick={handleUndo} disabled={historyIndex === 0} className="btn">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
          </svg>
        </button>
        <button onClick={handleRedo} disabled={historyIndex === history.length - 1} className="btn">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>
          </svg>
        </button>

        <div className="toolbar-divider" />

        {/* Drawing Tools */}
        <button onClick={() => setTool("wall")} className={`btn tool-btn ${tool === "wall" ? "active" : ""}`}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="7" x2="5" y2="17"/><line x1="19" y1="7" x2="19" y2="17"/>
          </svg>
          Draw Wall
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '4px' }}>
          <label style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>Thickness:</label>
          <select 
            value={wallThickness} 
            onChange={(e) => setWallThickness(parseFloat(e.target.value))}
            style={{ background: 'var(--bg-app)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '4px', fontSize: '16px' }}
          >
            <option value={0.05}>Thin</option>
            <option value={0.12}>Normal</option>
            <option value={0.25}>Thick</option>
          </select>
        </div>

        <SplitButton
          icon={
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 20H7L3 16l10-10 7 7-3.5 3.5"/><line x1="6" y1="14" x2="10" y2="18"/>
            </svg>
          }
          label="Eraser"
          isActive={tool === "eraser"}
          onMainClick={() => setTool("eraser")}
          options={[
            {
              value: "radius",
              label: "Circle",
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
            },
            {
              value: "box",
              label: "Box",
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
            }
          ]}
          selectedOption={eraserMode}
          onOptionSelect={(val) => { setEraserMode(val); setTool("eraser"); }}
        />

        <button onClick={() => pushHistory([], [])} className="btn btn-danger" style={{ marginLeft: '8px' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
          Clear All
        </button>

        <div style={{ flex: 1 }} />

        {/* Map Name Input & Load Map */}
        <div className="toolbar-input-wrap">
          <span style={{ fontSize: '16px', fontWeight: 'bold', marginLeft: '8px' }}>Map:</span>
          <input
            value={mapName}
            onChange={(e) => setMapName(e.target.value)}
            className="toolbar-input"
            placeholder="custom_map"
            style={{ width: '120px', fontSize: '16px' }}
          />
          
          <select 
             onChange={(e) => {
               if (e.target.value) {
                 if (e.target.value.startsWith("delete:")) {
                   deleteMap(e.target.value.replace("delete:", ""));
                 } else {
                   loadMap(e.target.value);
                 }
                 e.target.value = "";
               }
             }}
             style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: 'none', outline: 'none', cursor: 'pointer', maxWidth: '100px', fontSize: '16px' }}
             defaultValue=""
          >
            <option value="" disabled>Load...</option>
            {availableMaps.map(m => (
              <optgroup label={m.name} key={m.name}>
                 <option value={m.name}>Load {m.name}</option>
                 <option value={`delete:${m.name}`}>Delete {m.name}</option>
              </optgroup>
            ))}
          </select>
        </div>

        <div className="toolbar-divider" />

        {/* Actions */}
        <button onClick={() => saveMap(false)} className="btn btn-save" style={{ background: 'var(--bg-app)', border: '1px solid var(--accent-green)', color: 'var(--accent-green)', boxShadow: 'none' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
          </svg>
          Save
        </button>
        <button onClick={() => saveMap(true)} className="btn btn-save">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Save & Launch
        </button>
      </div>
      
      <div className="canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onWheel={handleWheel}
          className="map-canvas"
          style={{ cursor }}
        />
        {/* HUD Elements */}
        <div style={{ position: 'absolute', bottom: '16px', right: '16px', color: '#fff', background: 'rgba(0,0,0,0.7)', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)' }}>
          <button onClick={() => { setZoom(1); setPan({x:0, y:0}); }} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.4)', color: 'white', borderRadius: '4px', padding: '4px 8px', fontSize: '12px', cursor: 'pointer', fontWeight: 'bold' }}>
            Reset View
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.85, pointerEvents: 'none' }}>
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
               <rect x="5" y="2" width="14" height="20" rx="7"/>
               <line x1="12" y1="6" x2="12" y2="10"/>
             </svg>
             <span>Middle Click to Pan / Scroll to Zoom</span>
          </div>
          <div style={{ width: '2px', height: '16px', background: 'rgba(255,255,255,0.2)' }} />
          <div style={{ fontFamily: 'monospace', fontSize: '14px', letterSpacing: '0.5px' }}>
            X: {mouseWorldPos.x.toFixed(2)}m, Y: {mouseWorldPos.y.toFixed(2)}m
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: '16px', left: '16px', color: '#fff', pointerEvents: 'none', display: 'flex', alignItems: 'flex-end', gap: '8px', textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
          <span style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '-4px' }}>1m</span>
          <div style={{ width: `${transform.scale}px`, borderBottom: '2px solid #fff', borderLeft: '2px solid #fff', borderRight: '2px solid #fff', height: '8px', boxShadow: '0 1px 2px rgba(0,0,0,0.5)' }} />
        </div>
      </div>
    </div>
  );
}
