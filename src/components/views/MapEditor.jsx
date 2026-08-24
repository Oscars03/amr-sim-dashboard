import React, { useState, useEffect, useRef, useMemo } from 'react';

const HOST = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
const SAVE_MAP_URL = `http://${HOST}:3001/save_map`;

// ─────────────────────────────────────────────────────────────────────────────
// MapEditor Component (New Feature)
// ─────────────────────────────────────────────────────────────────────────────
function buildTransformEditor(mapInfo, canvasW, canvasH) {
  const { origin_x, origin_y, width: mw, height: mh } = mapInfo;
  const scale = Math.min(canvasW / mh, canvasH / mw) * 0.9;
  const offsetX = (canvasW - mh * scale) / 2;
  const offsetY = (canvasH - mw * scale) / 2;
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

export default function MapEditor({ onExit, isDark }) {
  const [mapName, setMapName] = useState("custom_map");
  const [walls, setWalls] = useState([]);
  const [obstacles, setObstacles] = useState([]);
  const [tool, setTool] = useState("wall");
  const gridSize = 10;
  const mapInfo = {
    origin_x: -gridSize,
    origin_y: -gridSize,
    width: gridSize * 2,
    height: gridSize * 2,
  };

  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    let timeoutId;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        // Simple debounce to avoid ResizeObserver loop limit exceeded error & excessive renders
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          setCanvasSize({
            w: entry.contentRect.width,
            h: entry.contentRect.height,
          });
        }, 16); // ~60fps
      }
    });
    if (wrapRef.current) observer.observe(wrapRef.current);
    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, []);

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPt, setStartPt] = useState(null);
  const [curPt, setCurPt] = useState(null);

  const transform = useMemo(() => buildTransformEditor(mapInfo, canvasSize.w, canvasSize.h), [mapInfo, canvasSize.w, canvasSize.h]);
  const snap = (val) => Math.round(val * 2) / 2;

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const { wx, wy } = transform.fromCanvas(cx, cy);
    return { x: snap(wx), y: snap(wy) };
  };

  const handlePointerDown = (e) => {
    const pt = getPos(e);
    if (tool === "eraser") {
      setWalls((ws) =>
        ws.filter((w) => !isNearLine(pt.x, pt.y, w.start, w.end)),
      );
      setObstacles((os) => os.filter((o) => !isInsideRect(pt.x, pt.y, o)));
      return;
    }
    setIsDrawing(true);
    setStartPt(pt);
    setCurPt(pt);
  };

  const handlePointerMove = (e) => {
    if (!isDrawing) return;
    setCurPt(getPos(e));
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (startPt.x === curPt.x && startPt.y === curPt.y) return;

    if (tool === "wall") {
      setWalls([
        ...walls,
        {
          start: [startPt.x, startPt.y],
          end: [curPt.x, curPt.y],
          thickness: 0.12,
        },
      ]);
    } else if (tool === "obstacle") {
      const w = Math.abs(curPt.x - startPt.x);
      const h = Math.abs(curPt.y - startPt.y);
      const x = Math.min(startPt.x, curPt.x);
      const y = Math.min(startPt.y, curPt.y);
      setObstacles([...obstacles, { type: "rect", x, y, w, h }]);
    }
  };

  const isNearLine = (x, y, p1, p2) => {
    const dist =
      Math.abs(
        (p2[1] - p1[1]) * x -
        (p2[0] - p1[0]) * y +
        p2[0] * p1[1] -
        p2[1] * p1[0],
      ) / (Math.hypot(p2[1] - p1[1], p2[0] - p1[0]) || 1e-6);
    const minX = Math.min(p1[0], p2[0]) - 0.5;
    const maxX = Math.max(p1[0], p2[0]) + 0.5;
    const minY = Math.min(p1[1], p2[1]) - 0.5;
    const maxY = Math.max(p1[1], p2[1]) + 0.5;
    return dist < 0.5 && x >= minX && x <= maxX && y >= minY && y <= maxY;
  };

  const isInsideRect = (x, y, o) => {
    return x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h;
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);
    ctx.fillStyle = isDark ? "#555555" : "#222222";
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);

    ctx.strokeStyle = isDark ? "#ffffff20" : "#ffffff15";
    ctx.lineWidth = 1;
    for (
      let i = mapInfo.origin_x;
      i <= mapInfo.origin_x + mapInfo.width;
      i += 0.5
    ) {
      const { cx: x1, cy: y1 } = transform.toCanvas(i, mapInfo.origin_y);
      const { cx: x2, cy: y2 } = transform.toCanvas(
        i,
        mapInfo.origin_y + mapInfo.height,
      );
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    for (
      let j = mapInfo.origin_y;
      j <= mapInfo.origin_y + mapInfo.height;
      j += 0.5
    ) {
      const { cx: x1, cy: y1 } = transform.toCanvas(mapInfo.origin_x, j);
      const { cx: x2, cy: y2 } = transform.toCanvas(
        mapInfo.origin_x + mapInfo.width,
        j,
      );
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.strokeStyle = isDark ? "#000000" : "#eeeeee";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    walls.forEach((w) => {
      const p1 = transform.toCanvas(w.start[0], w.start[1]);
      const p2 = transform.toCanvas(w.end[0], w.end[1]);
      ctx.beginPath();
      ctx.moveTo(p1.cx, p1.cy);
      ctx.lineTo(p2.cx, p2.cy);
      ctx.stroke();
    });

    ctx.fillStyle = "#ef535077";
    ctx.strokeStyle = "#ef5350";
    ctx.lineWidth = 2;
    obstacles.forEach((o) => {
      const p1 = transform.toCanvas(o.x, o.y);
      const p2 = transform.toCanvas(o.x + o.w, o.y);
      const p3 = transform.toCanvas(o.x + o.w, o.y + o.h);
      const p4 = transform.toCanvas(o.x, o.y + o.h);
      ctx.beginPath();
      ctx.moveTo(p1.cx, p1.cy);
      ctx.lineTo(p2.cx, p2.cy);
      ctx.lineTo(p3.cx, p3.cy);
      ctx.lineTo(p4.cx, p4.cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });

    if (isDrawing && startPt && curPt) {
      ctx.strokeStyle = "#4caf50";
      ctx.lineWidth = 4;
      const p1 = transform.toCanvas(startPt.x, startPt.y);
      const p2 = transform.toCanvas(curPt.x, curPt.y);
      if (tool === "wall") {
        ctx.beginPath();
        ctx.moveTo(p1.cx, p1.cy);
        ctx.lineTo(p2.cx, p2.cy);
        ctx.stroke();
      } else if (tool === "obstacle") {
        const p3 = transform.toCanvas(startPt.x, curPt.y);
        const p4 = transform.toCanvas(curPt.x, startPt.y);
        ctx.fillStyle = "#4caf5077";
        ctx.beginPath();
        ctx.moveTo(p1.cx, p1.cy);
        ctx.lineTo(p3.cx, p3.cy);
        ctx.lineTo(p2.cx, p2.cy);
        ctx.lineTo(p4.cx, p4.cy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    const { cx: ox, cy: oy } = transform.toCanvas(0, 0);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#ff4444";
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox, oy - 30);
    ctx.stroke();
    ctx.strokeStyle = "#44ff44";
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox - 30, oy);
    ctx.stroke();
  }, [
    canvasSize,
    walls,
    obstacles,
    isDrawing,
    startPt,
    curPt,
    isDark,
    transform,
    mapInfo,
  ]);

  const saveMap = async () => {
    const formattedWalls = walls.map((w) => [w.start, w.end]);
    const mapJson = {
      name: mapName,
      walls: formattedWalls,
      obstacles: obstacles, // ← also include obstacles
      map_info: {
        // ← include so normaliseMap works
        origin_x: mapInfo.origin_x,
        origin_y: mapInfo.origin_y,
        width: mapInfo.width,
        height: mapInfo.height,
      },
    };

    try {
      const res = await fetch(SAVE_MAP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: `${mapName}.json`, // → saved as e.g. custom_map.json
          data: mapJson, // → the map object
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `HTTP error! status: ${res.status}`);
      }

      const result = await res.json();
      alert(`Map "${mapName}.json" saved!\nPath: ${result.message}`);
    } catch (err) {
      console.error("Save map error:", err);
      alert(
        `Failed to save map: ${err.message}\n\nCheck that your Node.js server is running on port 3001.`,
      );
    }
  };

  const S = {
    wrap: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      gap: "16px",
      flex: 1,
      minHeight: 0,
    },
    toolbar: {
      display: "flex",
      gap: "12px",
      alignItems: "center",
      background: isDark ? "#121212" : "#ffffff",
      padding: "12px 20px",
      borderRadius: "16px",
      border: `1px solid ${isDark ? "#333" : "#ddd"}`,
      boxShadow: isDark ? "none" : "0 4px 16px rgba(0,0,0,0.04)",
      flexShrink: 0,
    },
    input: {
      background: isDark ? "#00000044" : "#f5f5f5",
      border: `1px solid ${isDark ? "#444" : "#ccc"}`,
      color: isDark ? "#fff" : "#000",
      padding: "8px 12px",
      borderRadius: "8px",
      outline: "none",
      fontSize: "13px",
      fontWeight: 600,
      width: "200px",
    },
    btn: {
      background: isDark ? "#1e1e1e" : "#f5f5f5",
      border: `1px solid ${isDark ? "#444" : "#ddd"}`,
      color: isDark ? "#ccc" : "#555",
      padding: "8px 16px",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: 600,
      transition: "all 0.2s",
    },
    btnActive: {
      background: isDark ? "#1a237e" : "#e3f2fd",
      border: `1px solid ${isDark ? "#3949ab" : "#90caf9"}`,
      color: isDark ? "#fff" : "#1565c0",
      padding: "8px 16px",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: 600,
      transition: "all 0.2s",
    },
    btnSave: {
      background: "#4caf50",
      border: "none",
      color: "#fff",
      padding: "8px 20px",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "13px",
      fontWeight: 700,
      boxShadow: "0 2px 6px rgba(76,175,80,0.3)",
      marginLeft: "auto",
    },
    btnDanger: {
      background: isDark ? "#b71c1c44" : "#ffebee",
      border: `1px solid ${isDark ? "#ef535055" : "#ef9a9a"}`,
      color: isDark ? "#ef9a9a" : "#c62828",
      padding: "8px 16px",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: 600,
    },
    canvasWrap: {
      flex: 1,
      minHeight: 0,
      background: isDark ? "#0d0d1a" : "#e6e9ec",
      borderRadius: "16px",
      border: `1px solid ${isDark ? "#ffffff15" : "#cccccc"}`,
      overflow: "hidden",
      position: "relative",
    },
  };

  return (
    <div style={S.wrap}>
      <div style={S.toolbar}>
        <button onClick={onExit} style={S.btn}>
          ← Back to Dashboard
        </button>
        <div
          style={{
            width: "1px",
            height: "24px",
            background: isDark ? "#333" : "#ddd",
            margin: "0 8px",
          }}
        />
        <input
          value={mapName}
          onChange={(e) => setMapName(e.target.value)}
          style={S.input}
          placeholder="Map Name"
        />
        <button
          onClick={() => setTool("wall")}
          style={tool === "wall" ? S.btnActive : S.btn}
        >
          Draw Wall
        </button>
        <button
          onClick={() => setTool("obstacle")}
          style={tool === "obstacle" ? S.btnActive : S.btn}
        >
          Add Obstacle
        </button>
        <button
          onClick={() => setTool("eraser")}
          style={tool === "eraser" ? S.btnActive : S.btn}
        >
          Eraser
        </button>
        <button
          onClick={() => {
            setWalls([]);
            setObstacles([]);
          }}
          style={S.btnDanger}
        >
          Clear All
        </button>
        <button onClick={saveMap} style={S.btnSave}>
          Save to ROS
        </button>
      </div>
      <div style={S.canvasWrap} ref={wrapRef}>
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          style={{
            cursor: tool === "eraser" ? "crosshair" : "crosshair",
            touchAction: "none",
            display: "block",
            width: "100%",
            height: "100%",
          }}
        />
      </div>
    </div>
  );
}
