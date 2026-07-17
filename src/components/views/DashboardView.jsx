import useAppStore from '../../store/useAppStore';
import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as ROSLIB from "roslib";

const MAP_SERVER_URL = "http://localhost:3001/map";
const URDF_SERVER_URL = "http://localhost:3001/urdf";
const ROBOTS_URL = "http://localhost:3001/robots";
const STATUS_URL = "http://localhost:3001/status";
const SWITCH_URL = "http://localhost:3001/switch";
const STOP_URL = "http://localhost:3001/stop";
const SAVE_MAP_URL = "http://localhost:3001/save_map";
const ROSBRIDGE_URL = "ws://localhost:9090";
const FETCH_INTERVAL = 3000;
const STATUS_INTERVAL = 1500;

// ─────────────────────────────────────────────────────────────────────────────
// parseURDF
// ─────────────────────────────────────────────────────────────────────────────
function parseURDF(xmlString) {
  try {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlString, "application/xml");
    const shapes = [];

    const materialColors = {};
    xml.querySelectorAll("material").forEach((mat) => {
      const name = mat.getAttribute("name");
      const colorEl = mat.querySelector("color");
      if (name && colorEl) {
        const rgba = colorEl.getAttribute("rgba")?.split(" ").map(Number) ?? [
          0, 0.3, 1, 1,
        ];
        const toHex = (v) =>
          Math.round(Math.min(1, Math.max(0, v)) * 255)
            .toString(16)
            .padStart(2, "0");
        materialColors[name] =
          `#${toHex(rgba[0])}${toHex(rgba[1])}${toHex(rgba[2])}`;
      }
    });

    xml.querySelectorAll("link").forEach((link) => {
      const linkName = link.getAttribute("name") ?? "";
      link.querySelectorAll("visual").forEach((visual) => {
        const originEl = visual.querySelector("origin");
        const xyz = originEl?.getAttribute("xyz")?.split(" ").map(Number) ?? [
          0, 0, 0,
        ];
        const rpy = originEl?.getAttribute("rpy")?.split(" ").map(Number) ?? [
          0, 0, 0,
        ];

        let hexColor = "#1a4dcc";
        const matEl = visual.querySelector("material");
        if (matEl) {
          const inlineColor = matEl.querySelector("color");
          if (inlineColor) {
            const rgba = inlineColor
              .getAttribute("rgba")
              ?.split(" ")
              .map(Number) ?? [0.1, 0.3, 0.8, 1];
            const toHex = (v) =>
              Math.round(Math.min(1, Math.max(0, v)) * 255)
                .toString(16)
                .padStart(2, "0");
            hexColor = `#${toHex(rgba[0])}${toHex(rgba[1])}${toHex(rgba[2])}`;
          } else {
            hexColor =
              materialColors[matEl.getAttribute("name") ?? ""] ?? hexColor;
          }
        }

        const box = visual.querySelector("geometry box");
        const cylinder = visual.querySelector("geometry cylinder");
        const sphere = visual.querySelector("geometry sphere");

        if (box) {
          const size = box.getAttribute("size")?.split(" ").map(Number) ?? [
            0.1, 0.1, 0.1,
          ];
          shapes.push({
            link: linkName,
            type: "box",
            w: size[0],
            d: size[1],
            h: size[2],
            ox: xyz[0],
            oy: xyz[1],
            oz: xyz[2],
            yaw: rpy[2],
            color: hexColor,
          });
        }
        if (cylinder) {
          shapes.push({
            link: linkName,
            type: "cylinder",
            radius: parseFloat(cylinder.getAttribute("radius") ?? "0.05"),
            length: parseFloat(cylinder.getAttribute("length") ?? "0.1"),
            ox: xyz[0],
            oy: xyz[1],
            oz: xyz[2],
            yaw: rpy[2],
            color: hexColor,
          });
        }
        if (sphere) {
          shapes.push({
            link: linkName,
            type: "sphere",
            radius: parseFloat(sphere.getAttribute("radius") ?? "0.05"),
            ox: xyz[0],
            oy: xyz[1],
            oz: xyz[2],
            color: hexColor,
          });
        }
      });
    });

    let maxR = 0.2;
    shapes.forEach((s) => {
      if (s.type === "box") maxR = Math.max(maxR, s.w / 2, s.d / 2);
      else maxR = Math.max(maxR, s.radius);
    });

    return { shapes, maxR };
  } catch (err) {
    console.error("URDF parse error:", err);
    return { shapes: [], maxR: 0.2 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// drawRobot
// ─────────────────────────────────────────────────────────────────────────────
function drawRobot(
  ctx,
  rx,
  ry,
  thetaRad,
  worldX,
  worldY,
  urdf,
  scale,
  isDark,
  view,
) {
  const { shapes, maxR } = urdf ?? { shapes: [], maxR: 0.2 };
  const labelR = Math.max(10, maxR * scale);

  // เปลี่ยนจากค่าคงที่ เป็นแบบนี้ครับ
  const textColor = isDark ? "#000000" : "#ffffff";
  const lineColor = isDark ? "#000000" : "#ffffff";
  const coordColor = isDark ? "#000652" : "#3ed6fc";

  ctx.save();
  ctx.translate(rx, ry);

  ctx.rotate(-Math.PI / 2 - thetaRad);

  if (shapes.length === 0) {
    ctx.shadowColor = "#00e5ffaa";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#00e5ff";
    ctx.strokeStyle = "#ffffffcc";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, labelR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else {
    shapes.forEach((s) => {
      const sx = s.ox * scale;
      const sy = -s.oy * scale;
      ctx.save();
      ctx.translate(sx, sy);
      if (s.yaw) ctx.rotate(-s.yaw);
      ctx.shadowColor = s.color + "99";
      ctx.shadowBlur = 8;

      if (s.type === "box") {
        const hw = (s.w / 2) * scale;
        const hd = (s.d / 2) * scale;
        ctx.fillStyle = s.color + "dd";
        ctx.fillRect(-hw, -hd, hw * 2, hd * 2);
        ctx.strokeStyle = "#ffffffcc";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-hw, -hd, hw * 2, hd * 2);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(hw, -hd);
        ctx.lineTo(hw, hd);
        ctx.stroke();
        ctx.strokeStyle = "#ffffff55";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-hw, 0);
        ctx.lineTo(hw, 0);
        ctx.moveTo(0, -hd);
        ctx.lineTo(0, hd);
        ctx.stroke();
        ctx.fillStyle = "#ffffffaa";
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.type === "cylinder" || s.type === "sphere") {
        const pr = Math.max(3, s.radius * scale);
        ctx.fillStyle = s.color + "dd";
        ctx.strokeStyle = "#ffffffcc";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, pr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    });
  }

  ctx.shadowBlur = 0;
  const arrowStart = Math.max(10, maxR * scale) * 0.6;
  const arrowEnd = Math.max(10, maxR * scale) * 2.0;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(arrowStart, 0);
  ctx.lineTo(arrowEnd, 0);
  ctx.stroke();
  ctx.fillStyle = lineColor;
  ctx.beginPath();
  ctx.moveTo(arrowEnd, 0);
  ctx.lineTo(arrowEnd - 8, -4);
  ctx.lineTo(arrowEnd - 8, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(rx, ry);
  ctx.rotate(-view.rotation);
  ctx.scale(1 / view.zoom, 1 / view.zoom);

  const textOffset = labelR * view.zoom + 6;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "bold 10px sans-serif";
  ctx.fillStyle = textColor;
  ctx.fillText("AMR", 0, textOffset);
  ctx.font = "9px monospace";
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
      : { start: w.start, end: w.end, thickness: w.thickness ?? 0.12 },
  );
  const obstacles = (raw.obstacles || []).map((o) => {
    if (Array.isArray(o)) {
      if (o.length === 3)
        return { type: "circle", x: o[0], y: o[1], radius: o[2] };
      if (o.length === 4)
        return { type: "rect", x: o[0], y: o[1], w: o[2], h: o[3] };
    }
    return o;
  });
  const waypoints = (raw.waypoints || []).map((wp) =>
    Array.isArray(wp) ? { x: wp[0], y: wp[1], name: wp[2] ?? "" } : wp,
  );
  const zones = (raw.zones || []).map((z) =>
    Array.isArray(z) ? { points: z, name: "", color: "#4a90e2" } : z,
  );

  let mapInfo = raw.map_info ?? null;
  if (!mapInfo) {
    const allX = [],
      allY = [];
    walls.forEach(({ start, end }) => {
      allX.push(start[0], end[0]);
      allY.push(start[1], end[1]);
    });
    obstacles.forEach((o) => {
      allX.push(o.x);
      allY.push(o.y);
    });
    waypoints.forEach((wp) => {
      allX.push(wp.x);
      allY.push(wp.y);
    });
    if (allX.length) {
      const pad = 1.0;
      mapInfo = {
        origin_x: Math.min(...allX) - pad,
        origin_y: Math.min(...allY) - pad,
        width: Math.max(...allX) - Math.min(...allX) + pad * 2,
        height: Math.max(...allY) - Math.min(...allY) + pad * 2,
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

  const scale = Math.min(canvasW / mh, canvasH / mw) * 0.9;
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

function MapEditor({ onExit, isDark }) {
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

// ─────────────────────────────────────────────────────────────────────────────
// WorldMap Component
// ─────────────────────────────────────────────────────────────────────────────
function WorldMap({ mapData, pose, urdf, width = 560, height = 560, isDark }) {
  const canvasRef = useRef(null);

  const [view, setView] = useState({ zoom: 1, rotation: 0, panX: 0, panY: 0 });
  const dragRef = useRef({
    isMiddle: false,
    isLeft: false,
    lastX: 0,
    lastY: 0,
  });
  const [cursor, setCursor] = useState("crosshair");

  const handleMouseDown = (e) => {
    if (e.button === 0) {
      e.preventDefault();
      dragRef.current = {
        isMiddle: false,
        isLeft: true,
        lastX: e.clientX,
        lastY: e.clientY,
      };
      setCursor("ew-resize");
    } else if (e.button === 1) {
      dragRef.current = {
        isMiddle: true,
        isLeft: false,
        lastX: e.clientX,
        lastY: e.clientY,
      };
      setCursor("grabbing");
    }
  };

  const handleMouseMove = (e) => {
    if (dragRef.current.isLeft) {
      const dx = e.clientX - dragRef.current.lastX;
      setView((v) => ({ ...v, rotation: v.rotation + dx * 0.01 }));
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
    } else if (dragRef.current.isMiddle) {
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      setView((v) => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
    }
  };

  const handleMouseUpOrLeave = () => {
    dragRef.current = { isMiddle: false, isLeft: false, lastX: 0, lastY: 0 };
    setCursor("crosshair");
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
      setView((v) => ({
        ...v,
        zoom: Math.max(0.1, Math.min(v.zoom * zoomFactor, 10)),
      }));
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const bgFill = isDark ? "#d3d3d3" : "#222222";
    const gridLine = isDark ? "#08080886" : "#ffffff15";
    const wallColor = isDark ? "#000000" : "#eeeeee";

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = bgFill;
    ctx.fillRect(0, 0, width, height);

    if (!mapData) {
      ctx.fillStyle = "#ffffff88";
      ctx.font = "15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Connecting to map server…", width / 2, height / 2);
      return;
    }

    const { scale, offsetX, toCanvas } = buildTransform(
      mapData.map_info,
      width,
      height,
    );
    const { origin_x, origin_y, width: mw, height: mh } = mapData.map_info;

    ctx.save();
    ctx.translate(width / 2 + view.panX, height / 2 + view.panY);
    ctx.scale(view.zoom, view.zoom);
    ctx.rotate(view.rotation);
    ctx.translate(-width / 2, -height / 2);

    ctx.strokeStyle = gridLine;
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(origin_x); gx <= origin_x + mw; gx++) {
      const { cx: x1, cy: y1 } = toCanvas(gx, origin_y);
      const { cx: x2, cy: y2 } = toCanvas(gx, origin_y + mh);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    for (let gy = Math.ceil(origin_y); gy <= origin_y + mh; gy++) {
      const { cx: x1, cy: y1 } = toCanvas(origin_x, gy);
      const { cx: x2, cy: y2 } = toCanvas(origin_x + mw, gy);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    (mapData.zones || []).forEach((zone) => {
      if (!zone.points?.length) return;
      const color = zone.color || "#4a90e2";
      ctx.fillStyle = color + "33";
      ctx.strokeStyle = color + "cc";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      zone.points.forEach(([wx, wy], i) => {
        const { cx, cy } = toCanvas(wx, wy);
        i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (zone.name) {
        const avgX =
          zone.points.reduce((s, p) => s + p[0], 0) / zone.points.length;
        const avgY =
          zone.points.reduce((s, p) => s + p[1], 0) / zone.points.length;
        const { cx, cy } = toCanvas(avgX, avgY);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-view.rotation);
        ctx.scale(1 / view.zoom, 1 / view.zoom);
        ctx.fillStyle = "#ffffffcc";
        ctx.font = `${Math.max(11, scale * 0.12)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(zone.name, 0, 0);
        ctx.restore();
      }
    });

    ctx.strokeStyle = wallColor;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    (mapData.walls || []).forEach(({ start, end, thickness }) => {
      if (!start || !end) return;
      const { cx: x1, cy: y1 } = toCanvas(start[0], start[1]);
      const { cx: x2, cy: y2 } = toCanvas(end[0], end[1]);
      ctx.lineWidth = Math.max(2, (thickness ?? 0.12) * scale);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });

    (mapData.obstacles || []).forEach((obs) => {
      ctx.fillStyle = "#ef535077";
      ctx.strokeStyle = "#ef5350";
      ctx.lineWidth = 1.5;
      if (obs.type === "rect") {
        const { cx, cy } = toCanvas(obs.x, obs.y + obs.h);
        ctx.fillRect(cx, cy, obs.w * scale, obs.h * scale);
        ctx.strokeRect(cx, cy, obs.w * scale, obs.h * scale);
        if (obs.label) {
          const { cx: lx, cy: ly } = toCanvas(
            obs.x + obs.w / 2,
            obs.y + obs.h / 2,
          );
          ctx.save();
          ctx.translate(lx, ly);
          ctx.rotate(-view.rotation);
          ctx.scale(1 / view.zoom, 1 / view.zoom);
          ctx.fillStyle = "#ffccbc";
          ctx.font = "11px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(obs.label, 0, 0);
          ctx.restore();
        }
      } else if (obs.type === "circle") {
        const { cx, cy } = toCanvas(obs.x, obs.y);
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(3, obs.radius * scale), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (obs.label) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(-view.rotation);
          ctx.scale(1 / view.zoom, 1 / view.zoom);
          ctx.fillStyle = "#ffccbc";
          ctx.font = "11px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(obs.label, 0, -obs.radius * scale - 5);
          ctx.restore();
        }
      }
    });

    if (pose && pose.x !== "-") {
      const worldX = parseFloat(pose.x);
      const worldY = parseFloat(pose.y);
      const thetaRad = (parseFloat(pose.theta) * Math.PI) / 180;
      const { cx: rx, cy: ry } = toCanvas(worldX, worldY);
      drawRobot(
        ctx,
        rx,
        ry,
        thetaRad,
        pose.x,
        pose.y,
        urdf,
        scale,
        isDark,
        view,
      );
    }

    ctx.restore();

    const hudX = 50;
    const hudY = height - 70;

    ctx.save();
    ctx.translate(hudX, hudY);
    ctx.rotate(view.rotation);

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#ff4444";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -30);
    ctx.stroke();

    ctx.strokeStyle = "#44ff44";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-30, 0);
    ctx.stroke();

    ctx.fillStyle = isDark ? "#000000dd" : "#ffffffdd";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.save();
    ctx.translate(0, -42);
    ctx.rotate(-view.rotation);
    ctx.fillText("X", 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(-42, 0);
    ctx.rotate(-view.rotation);
    ctx.fillText("Y", 0, 0);
    ctx.restore();

    ctx.restore();

    const scaleColor = isDark ? "#000000" : "#ffffff";
    const barPx = Math.round(scale * view.zoom);
    const bx = 16.5;
    const by = height - 16.5;

    ctx.strokeStyle = scaleColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + barPx, by);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx, by - 4);
    ctx.lineTo(bx, by + 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx + barPx, by - 4);
    ctx.lineTo(bx + barPx, by + 4);
    ctx.stroke();

    ctx.fillStyle = scaleColor;
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("1 m", bx + barPx + 8, by + 4);
  }, [mapData, pose, urdf, width, height, isDark, view]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onDoubleClick={handleDoubleClick}
        style={{
          borderRadius: "8px",
          display: "block",
          cursor,
          width: "100%",
          height: "100%",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "16px",
          right: "16px",
          fontSize: "18px",
          color: isDark ? "#ffffff" : "#000000",
          background: isDark
            ? "rgba(0, 0, 0, 0.5)"
            : "rgba(255, 255, 255, 0.5)",
          backdropFilter: "blur(4px)",
          padding: "12px 20px",
          borderRadius: "12px",
          pointerEvents: "none",
          fontWeight: 600,
          display: "flex",
          gap: "24px",
          alignItems: "center",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="5" y="2" width="14" height="20" rx="7"></rect>
            <path d="M5 9h14"></path>
            <path d="M12 2v7"></path>
            <path d="M5 9V9A7 7 0 0 1 12 2v7H5z" fill="currentColor"></path>
          </svg>
          Rotate
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="5" y="2" width="14" height="20" rx="7"></rect>
            <path d="M5 9h14"></path>
            <path d="M12 2v7"></path>
            <rect
              x="10.5"
              y="3"
              width="3"
              height="5"
              rx="1"
              fill="currentColor"
            ></rect>
          </svg>
          Pan
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="5" y="2" width="14" height="20" rx="7"></rect>
            <path d="M12 5v4"></path>
            <path d="M10 7l2-2 2 2"></path>
            <path d="M10 9l2 2 2-2"></path>
          </svg>
          Zoom
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="8" width="10" height="14" rx="5"></rect>
            <path d="M4 14h10"></path>
            <path d="M9 8v6"></path>
            <path d="M5 5L2 2"></path>
            <path d="M2 9L0 7"></path>
            <rect
              x="12"
              y="1"
              width="12"
              height="9"
              rx="2"
              fill="currentColor"
              stroke="none"
            ></rect>
            <text
              x="13.5"
              y="7.5"
              fill={isDark ? "#000" : "#fff"}
              stroke="none"
              fontSize="7.5"
              fontWeight="900"
              fontFamily="sans-serif"
            >
              2X
            </text>
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
  const cmdPubRef = useRef(null);
  const [keys, setKeys] = useState({});
  const [speed, setSpeed] = useState(0.5);
  const [turnSpeed, setTurnSpeed] = useState(1.0);
  const [webControl, setWebControl] = useState(true);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!webControl) return;

      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setKeys({});
      } else if (["i", ",", "j", "l"].includes(k)) {
        e.preventDefault();
        setKeys({ [k]: true });
      } else if (k === "w") {
        setSpeed((s) => Math.min(2.0, s * 1.1));
      } else if (k === "x") {
        setSpeed((s) => Math.max(0.1, s * 0.9));
      } else if (k === "e") {
        setTurnSpeed((t) => Math.min(3.0, t * 1.1));
      } else if (k === "c") {
        setTurnSpeed((t) => Math.max(0.1, t * 0.9));
      } else if (k === "q") {
        setSpeed((s) => Math.min(2.0, s * 1.1));
        setTurnSpeed((t) => Math.min(3.0, t * 1.1));
      } else if (k === "z") {
        setSpeed((s) => Math.max(0.1, s * 0.9));
        setTurnSpeed((t) => Math.max(0.1, t * 0.9));
      }
    };

    const handleKeyUp = (e) => {
      const k = e.key.toLowerCase();
      if (["i", ",", "j", "l"].includes(k)) {
        setKeys((prev) => {
          const next = { ...prev };
          delete next[k];
          return next;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
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
      name: "/cmd_vel",
      messageType: "geometry_msgs/msg/Twist",
      latch: false,
    });

    return () => {
      if (cmdPubRef.current) {
        cmdPubRef.current.publish({
          linear: { x: 0.0, y: 0.0, z: 0.0 },
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

      const fwd = keys["i"];
      const back = keys[","];
      const left = keys["j"];
      const right = keys["l"];

      const isMoving = fwd || back || left || right;

      const linear = fwd ? speed : back ? -speed : 0;
      const angular = left ? turnSpeed : right ? -turnSpeed : 0;

      if (isMoving) {
        zeroCount = 0;
        cmdPubRef.current.publish({
          linear: { x: linear, y: 0.0, z: 0.0 },
          angular: { x: 0.0, y: 0.0, z: angular },
        });
      } else {
        if (zeroCount < 10) {
          cmdPubRef.current.publish({
            linear: { x: 0.0, y: 0.0, z: 0.0 },
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
      background: isDark ? "#121212" : "#ffffff",
      border: `1px solid ${isDark ? "#333333" : "#e0e0e0"}`,
      borderRadius: "16px",
      padding: "16px",
      opacity: webControl ? 1 : 0.6,
      transition: "opacity 0.3s",
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box",
      flexShrink: 0,
      overflow: "hidden",
    },
    titleRow: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "20px",
    },
    title: {
      fontSize: "18px",
      fontWeight: 600,
      color: isDark ? "#90caf9" : "#1976d2",
    },
    toggleWrap: {
      display: "flex",
      alignItems: "center",
      background: isDark ? "#00000044" : "#f0f0f0",
      borderRadius: "20px",
      padding: "4px",
      cursor: "pointer",
      border: `1px solid ${isDark ? "#333333" : "#dddddd"}`,
      userSelect: "none",
    },
    toggleOpt: (active, color) => ({
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "6px 16px",
      borderRadius: "20px",
      fontSize: "13px",
      fontWeight: 700,
      letterSpacing: "0.5px",
      color: active ? color : isDark ? "#555555" : "#aaaaaa",
      background: active ? `${color}15` : "transparent",
      border: active ? `1px solid ${color}` : "1px solid transparent",
      transition: "all 0.2s ease-in-out",
    }),
    controlBody: {
      display: "flex",
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "20px",
      justifyContent: "center",
    },
    dpad: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 48px)",
      gridTemplateRows: "repeat(3, 48px)",
      gap: "6px",
      pointerEvents: webControl ? "auto" : "none",
    },
    key: (active) => ({
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "10px",
      border: active
        ? `2px solid ${isDark ? "#90caf9" : "#1976d2"}`
        : `1px solid ${isDark ? "#ffffff25" : "#e0e0e0"}`,
      background: active
        ? isDark
          ? "#3949ab"
          : "#e3f2fd"
        : isDark
          ? "#ffffff0d"
          : "#f8f9fa",
      color: active
        ? isDark
          ? "#fff"
          : "#1565c0"
        : isDark
          ? "#9e9ec0"
          : "#666666",
      fontSize: "18px",
      fontWeight: 600,
      cursor: "pointer",
      userSelect: "none",
    }),

    // ─── Slider section (redesigned) ───────────────────────────
    sliderCol: {
      display: "flex",
      flexDirection: "column",
      gap: "18px",
      flex: 1,
      maxWidth: "260px",
      minWidth: "200px",
    },
    sliderHeader: {
      display: "flex",
      alignItems: "center",
      marginBottom: "6px",
    },
    sliderLabel: {
      fontSize: "12px",
      fontWeight: 700,
      letterSpacing: "0.8px",
      textTransform: "uppercase",
      color: isDark ? "#7d8bab" : "#5a6478",
    },
    sliderKeyBadge: (variant, color) => ({
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "3px",
      fontSize: "10px",
      fontFamily: "monospace",
      fontWeight: 800,
      letterSpacing: "0.3px",
      padding: "3px 8px",
      borderRadius: "6px",
      whiteSpace: "nowrap",
      color: variant === "max" ? color : `${color}80`,
      background: variant === "max" ? `${color}1a` : `${color}0d`,
      border:
        variant === "max" ? `1px solid ${color}55` : `1px solid ${color}25`,
      boxShadow: variant === "max" ? `0 0 6px ${color}30` : "none",
    }),

    sliderTrackCol: {
      display: "flex",
      flexDirection: "column",
      flex: 1,
      gap: "6px",
    },
    sliderLegendRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    },

    sliderTrackRow: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      pointerEvents: webControl ? "auto" : "none",
    },
    slider: (value, min, max, color) => ({
      flex: 1,
      background: `linear-gradient(to right, ${color} 0%, ${color} ${((value - min) / (max - min)) * 100}%, ${isDark ? "#ffffff15" : "#e0e0e0"} ${((value - min) / (max - min)) * 100}%, ${isDark ? "#ffffff15" : "#e0e0e0"} 100%)`,
      "--thumb-color": isDark ? "#0a0a0a" : "#ffffff",
      "--thumb-ring": color,
      "--thumb-glow": `${color}80`,
    }),
    val: {
      fontFamily: "monospace",
      fontSize: "13px",
      fontWeight: 700,
      color: isDark ? "#00e5ff" : "#007b83",
      background: isDark ? "#00e5ff12" : "#00b8c410",
      borderRadius: "6px",
      padding: "4px 8px",
      minWidth: "48px",
      textAlign: "center",
    },
    // ─────────────────────────────────────────────────────────

    cmdBar: {
      marginTop: "10px",
      fontSize: "13px",
      color: isDark ? "#9e9ec0" : "#666666",
      fontFamily: "monospace",
      background: isDark ? "#ffffff06" : "#f0f0f0",
      borderRadius: "8px",
      padding: "10px 14px",
      display: "flex",
      justifyContent: "space-between",
      fontWeight: 600,
    },
  };

  const renderVKey = (keyName, label, styleOverrides) => {
    const handlePress = (e) => {
      if (e) e.preventDefault();
      if (!webControl) return;

      if (keyName === "k") {
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
      <style>{`
        input[type="range"].tele-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 6px;
          border-radius: 3px;
          outline: none;
          cursor: pointer;
        }
        input[type="range"].tele-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--thumb-color);
          border: 3px solid var(--thumb-ring);
          box-shadow: 0 0 8px var(--thumb-glow);
          cursor: pointer;
          transition: transform 0.15s ease;
        }
        input[type="range"].tele-slider::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }
        input[type="range"].tele-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--thumb-color);
          border: 3px solid var(--thumb-ring);
          box-shadow: 0 0 8px var(--thumb-glow);
          cursor: pointer;
        }
        input[type="range"].tele-slider:disabled::-webkit-slider-thumb {
          box-shadow: none;
        }
      `}</style>

      <div style={S.titleRow}>
        <div style={S.title}>Robot Control</div>

        <div style={S.toggleWrap} onClick={() => setWebControl(!webControl)}>
          <div style={S.toggleOpt(!webControl, "#ff1744")}>
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "30%",
                background: !webControl ? "#ff1744" : "transparent",
                boxShadow: !webControl ? "0 0 8px #ff1744" : "none",
                transition: "all 0.2s",
              }}
            />
            Terminal
          </div>
          <div style={S.toggleOpt(webControl, "#00e676")}>
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "30%",
                background: webControl ? "#00e676" : "transparent",
                boxShadow: webControl ? "0 0 8px #00e676" : "none",
                transition: "all 0.2s",
              }}
            />
            UI
          </div>
        </div>
      </div>

      <div style={S.controlBody}>
        <div style={S.dpad}>
          <div /> {renderVKey("i", "I")} <div />
          {renderVKey("j", "J")}
          {renderVKey("k", "K")}
          {renderVKey("l", "L")}
          <div /> {renderVKey(",", ",")} <div />
        </div>

        <div style={S.sliderCol}>
          <div>
            <div style={S.sliderHeader}>
              <span style={S.sliderLabel}>Speed</span>
            </div>
            <div style={S.sliderTrackRow}>
              <div style={S.sliderTrackCol}>
                <input
                  type="range"
                  className="tele-slider"
                  min="0.1"
                  max="2.0"
                  step="0.1"
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  style={S.slider(
                    speed,
                    0.1,
                    2.0,
                    isDark ? "#90caf9" : "#1976d2",
                  )}
                  disabled={!webControl}
                />
                <div style={S.sliderLegendRow}>
                  <span
                    style={S.sliderKeyBadge(
                      "min",
                      isDark ? "#90caf9" : "#1976d2",
                    )}
                  >
                    X −
                  </span>
                  <span
                    style={S.sliderKeyBadge(
                      "max",
                      isDark ? "#90caf9" : "#1976d2",
                    )}
                  >
                    W +
                  </span>
                </div>
              </div>
              <span style={S.val}>{speed.toFixed(2)}</span>
            </div>
          </div>

          <div>
            <div style={S.sliderHeader}>
              <span style={S.sliderLabel}>Angle</span>
            </div>
            <div style={S.sliderTrackRow}>
              <div style={S.sliderTrackCol}>
                <input
                  type="range"
                  className="tele-slider"
                  min="0.1"
                  max="3.0"
                  step="0.1"
                  value={turnSpeed}
                  onChange={(e) => setTurnSpeed(parseFloat(e.target.value))}
                  style={S.slider(
                    turnSpeed,
                    0.1,
                    3.0,
                    isDark ? "#00e676" : "#2e7d32",
                  )}
                  disabled={!webControl}
                />
                <div style={S.sliderLegendRow}>
                  <span
                    style={S.sliderKeyBadge(
                      "min",
                      isDark ? "#00e676" : "#2e7d32",
                    )}
                  >
                    C -
                  </span>
                  <span
                    style={S.sliderKeyBadge(
                      "max",
                      isDark ? "#00e676" : "#2e7d32",
                    )}
                  >
                    E +
                  </span>
                </div>
              </div>
              <span style={S.val}>{turnSpeed.toFixed(2)}</span>
            </div>
          </div>

          <div style={S.cmdBar}>
            <span>
              X:{" "}
              <span
                style={{
                  color: webControl
                    ? isDark
                      ? "#00e5ff"
                      : "#007b83"
                    : isDark
                      ? "#9e9ec0"
                      : "#aaaaaa",
                }}
              >
                {keys["i"] && webControl
                  ? speed.toFixed(2)
                  : keys[","] && webControl
                    ? (-speed).toFixed(2)
                    : "0.00"}
              </span>
            </span>
            <span>
              Z:{" "}
              <span
                style={{
                  color: webControl
                    ? isDark
                      ? "#00e5ff"
                      : "#007b83"
                    : isDark
                      ? "#9e9ec0"
                      : "#aaaaaa",
                }}
              >
                {keys["j"] && webControl
                  ? turnSpeed.toFixed(2)
                  : keys["l"] && webControl
                    ? (-turnSpeed).toFixed(2)
                    : "0.00"}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// CustomDropdown  — defined OUTSIDE SimSelector so it never remounts
// ─────────────────────────────────────────────────────────────────────────────
function CustomDropdown({ label, value, onChange, options, isDark }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const accent = isDark ? "#90caf9" : "#1976d2";
  const border = isDark ? "#ffffff12" : "#e8eaed";
  const inputBg = isDark ? "#1a1a2e" : "#f8f9fa";
  const textSub = isDark ? "#6b7280" : "#9ca3af";
  const textMain = isDark ? "#e2e8f0" : "#1a1a2a";

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div>
      {/* Label */}
      <div
        style={{
          fontSize: "10px",
          fontWeight: 700,
          color: textSub,
          textTransform: "uppercase",
          letterSpacing: "1.2px",
          marginBottom: "6px",
        }}
      >
        {label}
      </div>

      {/* Container */}
      <div ref={ref} style={{ position: "relative" }}>
        {/* Trigger */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen((o) => !o);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 12px",
            background: open ? (isDark ? "#22223a" : "#f0f4ff") : inputBg,
            border: `1.5px solid ${open ? accent : border}`,
            boxShadow: open ? `0 0 0 3px ${accent}22` : "none",
            borderRadius: open ? "10px 10px 0 0" : "10px",
            color: textMain,
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
            userSelect: "none",
            transition: "all 0.15s",
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {selected?.label ?? "— select —"}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke={open ? accent : textSub}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              marginLeft: "8px",
              flexShrink: 0,
              pointerEvents: "none",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        {/* Options list */}
        {open && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              background: isDark ? "#1a1a2e" : "#ffffff",
              border: `1.5px solid ${accent}`,
              borderTop: "none",
              borderRadius: "0 0 10px 10px",
              boxShadow: isDark
                ? "0 8px 24px rgba(0,0,0,0.6)"
                : "0 8px 24px rgba(0,0,0,0.12)",
              zIndex: 9999,
              maxHeight: "200px",
              overflowY: "auto",
              scrollbarWidth: "thin",
              scrollbarColor: `${isDark ? "#333" : "#ccc"} transparent`,
            }}
          >
            {options.length === 0 ? (
              <div
                style={{
                  padding: "10px 14px",
                  color: textSub,
                  fontSize: "13px",
                  fontStyle: "italic",
                }}
              >
                Loading…
              </div>
            ) : (
              options.map((opt, i) => {
                const isSelected = opt.value === value;
                const isLast = i === options.length - 1;
                return (
                  <div
                    key={opt.value}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    style={{
                      padding: "10px 14px",
                      fontSize: "14px",
                      fontWeight: isSelected ? 700 : 500,
                      color: isSelected ? accent : textMain,
                      background: isSelected
                        ? isDark
                          ? `${accent}18`
                          : `${accent}12`
                        : "transparent",
                      borderBottom: !isLast ? `1px solid ${border}` : "none",
                      borderRadius: isLast ? "0 0 8px 8px" : "0",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected)
                        e.currentTarget.style.background = isDark
                          ? "#ffffff0a"
                          : "#f5f5f5";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected)
                        e.currentTarget.style.background = isSelected
                          ? isDark
                            ? `${accent}18`
                            : `${accent}12`
                          : "transparent";
                    }}
                  >
                    <div style={{ width: "16px", flexShrink: 0 }}>
                      {isSelected && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={accent}
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    {opt.label}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SimSelector  — now uses CustomDropdown as a stable external component
// ─────────────────────────────────────────────────────────────────────────────
const SimSelector = forwardRef(function SimSelector(
  { onSwitch, onStop, isDark, isWaitingOdom },
  ref,
) {
  const [robotList, setRobotList] = useState([]);
  const [worldList, setWorldList] = useState([]);
  const [selRobot, setSelRobot] = useState("");
  const [selWorld, setSelWorld] = useState("");
  const [simStatus, setSimStatus] = useState(null);
  
  const fetchRobots = async () => {
    try {
      const res = await fetch("http://localhost:3001/robots");
      const data = await res.json();
      setRobotList(data.robots ?? []);
    } catch (e) {
      console.error(e);
    }
  };
  useImperativeHandle(ref, () => ({ fetchRobots }));
  const [switching, setSwitching] = useState(false);
  const [switchMsg, setSwitchMsg] = useState("");
  const statusRef = useRef(null);
  const autoLaunched = useRef(false);

  const doSwitch = useCallback(
    async (robot, world) => {
      if (!robot || !world) return;
      setSwitching(true);
      setSwitchMsg("");
      try {
        const res = await fetch(SWITCH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ robot, world }),
        });
        const data = await res.json();
        setSwitchMsg(data.message ?? (data.ok ? "Launching…" : "Error"));

        // 🌟 ทริกเกอร์ onSwitch ทันทีเพื่อให้ isWaitingOdom = true
        // ปุ่มจะได้เข้าสู่สถานะ 'Waiting' ทันทีโดยไม่ต้องรอให้ Polling ของ Server ส่งค่ากลับมา
        if (data.ok && onSwitch) {
          onSwitch(robot, world);
        }
      } catch (err) {
        setSwitchMsg(`${err.message}`);
      } finally {
        // 🌟 หน่วงเวลาสั้นๆ ก่อนปิดสถานะ request เพื่อให้ Server เปลี่ยนสถานะเป็น launching ได้ทันเวลา
        setTimeout(() => setSwitching(false), 1500);
      }
    },
    [onSwitch],
  );

  useEffect(() => {
    const init = async () => {
      try {
        const [robotRes, worldRes, statusRes] = await Promise.all([
          fetch(ROBOTS_URL),
          fetch("http://localhost:3001/worlds"),
          fetch(STATUS_URL),
        ]);
        const robotData = await robotRes.json();
        const worldData = await worldRes.json();
        const statusData = await statusRes.json();
        const robots = robotData.robots ?? [];
        const worlds = worldData.worlds ?? [];
        setRobotList(robots);
        setWorldList(worlds);
        const defaultRobot = statusData.robot ?? robots[0]?.name ?? "";
        const defaultWorld = statusData.world ?? worlds[0]?.name ?? "";
        setSelRobot(defaultRobot);
        setSelWorld(defaultWorld);
        if (
          !autoLaunched.current &&
          statusData.status !== "running" &&
          statusData.status !== "launching" &&
          defaultRobot &&
          defaultWorld
        ) {
          autoLaunched.current = true;
          await doSwitch(defaultRobot, defaultWorld);
        }
      } catch (err) {
        setSwitchMsg(`Cannot reach server: ${err.message}`);
      }
    };
    init();
  }, [doSwitch]);

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(STATUS_URL);
        setSimStatus(await r.json());
      } catch {
        /* ignore */
      }
    };
    poll();
    statusRef.current = setInterval(poll, STATUS_INTERVAL);
    return () => clearInterval(statusRef.current);
  }, []);

  let displayStatus = simStatus?.status ?? "idle";
  if (displayStatus === "running" && isWaitingOdom) {
    displayStatus = "waiting";
  }

  // 🌟 รวมเงื่อนไขของ Animation ให้อยู่ในช่วงที่ระบบยุ่ง (Requesting, Launching, Waiting, Stopping)
  const isBusy =
    switching || ["launching", "waiting", "stopping"].includes(displayStatus);

  const statusMeta = {
    running: { color: "#00e676", label: "RUNNING", glow: "#00e67622" },
    launching: { color: "#ff9800", label: "LAUNCHING", glow: "#ff980022" },
    waiting: { color: "#29b6f6", label: "WAITING", glow: "#29b6f622" },
    stopping: { color: "#ff9800", label: "STOPPING", glow: "#ff980022" },
    error: { color: "#f44336", label: "ERROR", glow: "#f4433622" },
    idle: { color: "#555555", label: "IDLE", glow: "transparent" },
  }[displayStatus] ?? {
    color: "#555555",
    label: displayStatus.toUpperCase(),
    glow: "transparent",
  };

  const accent = isDark ? "#90caf9" : "#1976d2";
  const cardBg = isDark ? "#111118" : "#ffffff";
  const border = isDark ? "#ffffff12" : "#e8eaed";

  return (
    <div
      style={{
        background: cardBg,
        borderRadius: "16px",
        border: `1px solid ${border}`,
        boxShadow: isDark
          ? "0 4px 24px rgba(0,0,0,0.4)"
          : "0 4px 24px rgba(0,0,0,0.06)",
        overflow: "visible",
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          padding: "14px 20px",
          borderBottom: `1px solid ${border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: "15px", fontWeight: 700, color: accent }}>
          Simulation Config
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: statusMeta.glow,
            border: `1px solid ${statusMeta.color}55`,
            borderRadius: "20px",
            padding: "4px 10px",
            opacity: displayStatus === "idle" ? 0 : 1,
            transition: "opacity 0.3s",
          }}
        >
          <div
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              background: statusMeta.color,
              boxShadow: `0 0 6px ${statusMeta.color}`,
              animation: ["launching", "waiting", "stopping"].includes(
                displayStatus,
              )
                ? "simPulse 1.5s ease-in-out infinite"
                : "none",
            }}
          />
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: statusMeta.color,
              letterSpacing: "1px",
            }}
          >
            {statusMeta.label}
          </span>
        </div>
      </div>

      {/* ── Dropdowns ── */}
      <div
        style={{
          padding: "16px 20px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "12px",
        }}
      >
        <CustomDropdown
          isDark={isDark}
          label="Robot"
          value={selRobot}
          onChange={setSelRobot}
          options={robotList.map((r) => ({
            value: r.name,
            label: r.robotName || r.name.replace(/\.urdf$/i, ""),
          }))}
        />
        <CustomDropdown
          isDark={isDark}
          label="World"
          value={selWorld}
          onChange={setSelWorld}
          options={worldList.map((w) => ({
            value: w.name,
            label: w.mapName || w.name.replace(/\.json$/i, ""),
          }))}
        />
      </div>

      {/* ── Buttons ── */}
      <div style={{ padding: "0 20px 16px", display: "flex", gap: "10px" }}>
        <button
          onClick={() => doSwitch(selRobot, selWorld)}
          disabled={isBusy || !selRobot || !selWorld}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: "10px",
            border: "none",
            background: isBusy
              ? isDark
                ? "#1a237e"
                : "#bbdefb"
              : isDark
                ? "#3949ab"
                : "#1976d2",
            color: isBusy ? (isDark ? "#7986cb" : "#1565c0") : "#fff",
            fontSize: "14px",
            fontWeight: 700,
            cursor: isBusy ? "not-allowed" : "pointer",
            opacity: !selRobot || !selWorld ? 0.5 : 1,
            transition: "all 0.25s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
          }}
        >
          {isBusy ? (
            <>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ animation: "simSpin 0.9s linear infinite" }}
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              {/* 🌟 แสดงข้อความแบบ Real-time ตามสเตตัสเป๊ะๆ */}
              {displayStatus === "waiting"
                ? "Waiting Robot…"
                : displayStatus === "launching"
                  ? "Launching…"
                  : displayStatus === "stopping"
                    ? "Stopping…"
                    : "Requesting…"}
            </>
          ) : (
            <>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Launch
            </>
          )}
        </button>

        <button
          onClick={async () => {
            setSwitching(true); // เพิ่มเพื่อให้ปุ่ม Stop มีสถานะเชื่อมต่อที่เนียนขึ้น
            try {
              await fetch(STOP_URL, { method: "POST" });
              if (onStop) onStop();
            } catch (err) {
              setSwitchMsg(`${err.message}`);
            } finally {
              setTimeout(() => setSwitching(false), 1500);
            }
          }}
          disabled={displayStatus === "idle" || displayStatus === "stopping"}
          style={{
            padding: "10px 18px",
            borderRadius: "10px",
            border: "none",
            background: isDark ? "#3a0a0a" : "#ffebee",
            color: isDark ? "#ef9a9a" : "#c62828",
            fontSize: "14px",
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            transition: "all 0.2s",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
          Stop
        </button>
      </div>

      <style>{`
        @keyframes simPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes simSpin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
});

function TopicMonitor({ ros, isDark }) {
  const [topics, setTopics] = useState([]);
  const [selTopic, setSelTopic] = useState("");
  const [msgData, setMsgData] = useState(null);
  const subRef = useRef(null);

  const refreshTopics = useCallback(() => {
    if (!ros) return;
    ros.getTopics((result) => {
      const list = result.topics.map((t, i) => ({
        name: t,
        type: result.types[i],
      }));
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
    const t = topics.find((x) => x.name === selTopic);
    if (!t) return;

    const listener = new ROSLIB.Topic({
      ros: ros,
      name: t.name,
      messageType: Array.isArray(t.type) ? t.type[0] : t.type,
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
      background: isDark ? "#151525f0" : "#fffffffa",
      border: `1px solid ${isDark ? "#ffffff30" : "#e0e0e0"}`,
      borderRadius: "16px",
      padding: "20px",
      backdropFilter: "blur(12px)",
      boxShadow: isDark
        ? "0 16px 40px rgba(0,0,0,0.5)"
        : "0 16px 40px rgba(0,0,0,0.15)",
      display: "flex",
      flexDirection: "column",
      gap: "14px",
    },
    title: {
      fontSize: "18px",
      fontWeight: 600,
      color: isDark ? "#90caf9" : "#1976d2",
      textAlign: "center",
    },
    select: {
      width: "100%",
      padding: "10px",
      borderRadius: "8px",
      background: isDark ? "#ffffff10" : "#f5f5f5",
      color: isDark ? "#e0e0e0" : "#333",
      border: `1px solid ${isDark ? "#ffffff20" : "#ccc"}`,
      fontSize: "14px",
      outline: "none",
      cursor: "pointer",
      fontWeight: 500,
      colorScheme: isDark ? "dark" : "light",
    },
    dataBox: {
      height: "240px",
      overflowY: "auto",
      padding: "12px",
      background: isDark ? "#00000088" : "#f8f9fa",
      border: `1px solid ${isDark ? "#ffffff15" : "#eee"}`,
      borderRadius: "8px",
      fontSize: "12px",
      fontFamily: "monospace",
      color: isDark ? "#a5d6ff" : "#005b9f",
    },
  };

  return (
    <div style={S.wrap}>
      <div style={S.title}>Topic Monitor</div>
      <select
        style={S.select}
        value={selTopic}
        onChange={(e) => setSelTopic(e.target.value)}
      >
        <option
          value=""
          style={{
            background: isDark ? "#1a1a1a" : "#ffffff",
            color: isDark ? "#e0e0e0" : "#333",
          }}
        >
          -- Select a topic --
        </option>
        {topics.map((t) => (
          <option
            key={t.name}
            value={t.name}
            style={{
              background: isDark ? "#1a1a1a" : "#ffffff",
              color: isDark ? "#e0e0e0" : "#333",
            }}
          >
            {t.name}
          </option>
        ))}
      </select>
      <div style={S.dataBox}>
        {selTopic ? (
          msgData !== null ? (
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {JSON.stringify(msgData, null, 2)}
            </pre>
          ) : (
            "Waiting for data..."
          )
        ) : (
          "No topic selected"
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App (Main - No Scroll Layout)
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardView() {
  const {
    rosStatus: status,
    setRosStatus: setStatus,
    pose,
    setPose,
    mapData,
    setMapData,
    mapName,
    setMapName,
    mapStatus,
    setMapStatus,
    urdf,
    setUrdf,
    activeWorld,
    setActiveWorld,
    activeRobot,
    setActiveRobot,
    rosObj,
    setRosObj,
    showMonitor,
    setShowMonitor,
    isDark,
    setIsDark,
    isWaitingOdom,
    setIsWaitingOdom,
  } = useAppStore();
  const simSelectorRef = useRef(null);
  const [appVersion, setAppVersion] = useState("0.0.0");
  const [updateInfo, setUpdateInfo] = useState(null);
  const [isSpinningUpdate, setIsSpinningUpdate] = useState(false);
  const [showStatusToast, setShowStatusToast] = useState(false);
  const toastTimerRef = useRef(null);

  const triggerUpdateCheck = () => {
    setIsSpinningUpdate(true);
    setTimeout(() => setIsSpinningUpdate(false), 1200);

    setShowStatusToast(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setShowStatusToast(false);
    }, 10000);

    if (window.electronAPI) {
      window.electronAPI.checkForUpdates();
    } else {
      setUpdateInfo({ status: "checking", message: "Checking for updates..." });
      setTimeout(() => {
        setUpdateInfo({ status: "latest", message: "No update available." });
      }, 1500);
    }
  };

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getAppVersion().then((v) => {
        if (v) setAppVersion(v);
      });
      const unsubscribe = window.electronAPI.onUpdateStatus((info) => {
        setUpdateInfo(info);
        setShowStatusToast(true);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => {
          setShowStatusToast(false);
        }, 10000);
      });
      return () => unsubscribe && unsubscribe();
    }
  }, []);

  const mapWrapRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ w: 400, h: 300 });

  useEffect(() => {
    const updateSize = () => {
      if (mapWrapRef.current) {
        setCanvasSize({
          w: mapWrapRef.current.clientWidth,
          h: mapWrapRef.current.clientHeight,
        });
      }
    };
    updateSize();
    setTimeout(updateSize, 100);
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const rosRef = useRef(null);
  const odomRef = useRef(null);
  const fetchRef = useRef(null);

  useEffect(() => {
    let retryTimer = null;
    const connect = () => {
      const ros = new ROSLIB.Ros({ url: ROSBRIDGE_URL });
      rosRef.current = ros;

      ros.on("connection", () => {
        setStatus("Connected to ROS 2");
        setRosObj(ros);
      });
      ros.on("error", () => {
        setStatus("Connection error");
        setRosObj(null);
        retryTimer = setTimeout(connect, 3000);
      });
      ros.on("close", () => {
        setStatus("Disconnected");
        setRosObj(null);
        retryTimer = setTimeout(connect, 3000);
      });
    };
    connect();
    return () => {
      clearTimeout(retryTimer);
      rosRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!rosObj) return;
    const odom = new ROSLIB.Topic({
      ros: rosObj,
      name: "/odom",
      messageType: "nav_msgs/msg/Odometry",
      qos_profile: {
        reliability: "reliable",
        durability: "volatile",
        history: "keep_last",
        depth: 10,
      },
    });
    odom.subscribe((msg) => {
      const x = msg.pose.pose.position.x;
      const y = msg.pose.pose.position.y;
      const q_z = msg.pose.pose.orientation.z;
      const q_w = msg.pose.pose.orientation.w;
      const theta = 2.0 * Math.atan2(q_z, q_w);

      setPose({
        x: x.toFixed(2),
        y: y.toFixed(2),
        theta: ((theta * 180) / Math.PI).toFixed(1),
      });

      if (Math.abs(x) <= 0.05 && Math.abs(y) <= 0.05) {
        setIsWaitingOdom(false);
      }
    });
    odomRef.current = odom;
    return () => {
      odom.unsubscribe();
      odomRef.current = null;
    };
  }, [rosObj]);

  const fetchMap = useCallback(async (mapFile) => {
    const file = mapFile ?? activeWorld;
    setMapStatus("loading");
    try {
      const res = await fetch(`${MAP_SERVER_URL}?file=${file}`);
      if (!res.ok) throw new Error();
      const raw = await res.json();
      setMapName(raw._meta?.mapName ?? raw.name ?? "Unknown");
      setMapData(normaliseMap(raw));
      setMapStatus("ok");
    } catch (err) {
      setMapStatus("error");
    }
  }, [activeWorld]);

  useEffect(() => {
    fetchMap();
    fetchRef.current = setInterval(() => fetchMap(), FETCH_INTERVAL);
    return () => clearInterval(fetchRef.current);
  }, [fetchMap]);

  const fetchUrdf = useCallback(
    async (robotFile) => {
      const file = robotFile ?? activeRobot;
      try {
        const res = await fetch(`${URDF_SERVER_URL}?file=${file}`);
        if (!res.ok) throw new Error();
        const xml = await res.text();
        setUrdf(parseURDF(xml));
      } catch (err) {
        /* ignore */
      }
    },
    [activeRobot],
  );

  useEffect(() => {
    fetchUrdf();
  }, [fetchUrdf]);

  const handleSwitch = useCallback(
    (robot, world) => {
      setIsWaitingOdom(true);
      setPose({ x: "-", y: "-", theta: "-" });
      setActiveRobot(robot);
      setActiveWorld(world);
      fetchUrdf(robot);
      fetchMap(world);
    },
    [fetchUrdf, fetchMap],
  );

  const [winSize, setWinSize] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  });

  useEffect(() => {
    const onResize = () =>
      setWinSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isNarrow = winSize.w < 900; // stack vertically
  const isShort = winSize.h < 600; // compress padding

  const rosConnected = status.includes("Connected");
  const mapBadgeText =
    mapStatus === "ok"
      ? "Loaded"
      : mapStatus === "loading"
        ? "Loading"
        : mapStatus === "error"
          ? "Error"
          : "Waiting";

  const S = {
    app: {
      flex: 1,
      width: "100%",
      height: "100%",
      overflow: "hidden",
      display: "flex",
      justifyContent: "center",
      padding: isShort ? "8px" : isNarrow ? "12px" : "20px",
      boxSizing: "border-box",
    },

    wrap: {
      width: "100%",
      maxWidth: "1600px",
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0,
      overflow: "hidden",
    },

    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: isShort ? "8px" : "20px",
      flexShrink: 0,
      flexWrap: "wrap", // ← wrap when narrow
      gap: "8px",
    },

    titleBox: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      flexWrap: "wrap",
    },

    h1: {
      fontSize: isNarrow ? "18px" : "24px",
      fontWeight: 700,
      margin: 0,
      color: isDark ? "#fff" : "#111",
      whiteSpace: "nowrap",
    },

    statusBox: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      background: isDark ? "#121212" : "#ffffff",
      padding: "6px 12px",
      borderRadius: "10px",
      fontSize: isNarrow ? "12px" : "14px",
      border: `1px solid ${isDark ? "#333" : "#ddd"}`,
      fontWeight: 500,
      whiteSpace: "nowrap",
    },

    dot: (on) => ({
      width: "10px",
      height: "10px",
      borderRadius: "50%",
      background: on
        ? isDark
          ? "#4caf50"
          : "#388e3c"
        : isDark
          ? "#f44336"
          : "#d32f2f",
      boxShadow: on ? `0 0 8px ${isDark ? "#4caf50" : "#388e3c"}` : "none",
      flexShrink: 0,
    }),

    btnGroup: {
      display: "flex",
      gap: "8px",
      flexWrap: "wrap", // ← wrap buttons when narrow
    },

    topBtn: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      background: isDark ? "#121212" : "#ffffff",
      border: `1px solid ${isDark ? "#333" : "#ccc"}`,
      color: isDark ? "#90caf9" : "#1976d2",
      borderRadius: "10px",
      padding: isNarrow ? "6px 10px" : "8px 16px",
      fontSize: isNarrow ? "12px" : "14px",
      fontWeight: 600,
      cursor: "pointer",
      whiteSpace: "nowrap",
      transition: "all 0.2s",
    },

    topBtnActive: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      background: isDark ? "#1a237e" : "#e3f2fd",
      border: `1px solid ${isDark ? "#3949ab" : "#90caf9"}`,
      color: isDark ? "#ffffff" : "#1565c0",
      borderRadius: "10px",
      padding: isNarrow ? "6px 10px" : "8px 16px",
      fontSize: isNarrow ? "12px" : "14px",
      fontWeight: 600,
      cursor: "pointer",
      whiteSpace: "nowrap",
      transition: "all 0.2s",
    },

    // ── KEY CHANGE: single column when narrow ────────────────────────────────
    mainContent: {
      display: "grid",
      gridTemplateColumns: isNarrow ? "1fr" : "minmax(0, 2.5fr) minmax(0, 1fr)",
      gridTemplateRows: "minmax(0, 1fr)",
      gap: "12px",
      flex: 1,
      minHeight: 0,
      overflow: isNarrow ? "auto" : "hidden", // ← scroll when stacked
    },

    mapCard: {
      display: "flex",
      flexDirection: "column",
      background: isDark ? "#121212" : "#ffffff",
      border: `1px solid ${isDark ? "#333333" : "#e0e0e0"}`,
      borderRadius: "16px",
      padding: "16px",
      boxSizing: "border-box",
      boxShadow: isDark ? "none" : "0 6px 16px rgba(0,0,0,0.04)",
      minWidth: 0,
      minHeight: 0,
      height: isNarrow ? "55vh" : "100%", // ← fixed height when stacked
    },

    mapHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "12px",
      flexShrink: 0,
      flexWrap: "wrap",
      gap: "8px",
    },

    mapCanvasWrap: {
      flex: 1,
      minHeight: 0,
      background: isDark ? "#0d0d1a" : "#e6e9ec",
      borderRadius: "10px",
      border: `1px solid ${isDark ? "#ffffff15" : "#cccccc"}`,
      overflow: "hidden",
    },

    // ── KEY CHANGE: right panel scrolls instead of clipping ─────────────────
    rightPanel: {
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      height: "100%",
      minHeight: 0,
      minWidth: 0,
      overflowY: "auto", // ← KEY: scroll instead of clip
      overflowX: "hidden",
      paddingRight: "2px",
      // Thin scrollbar
      scrollbarWidth: "thin",
      scrollbarColor: `${isDark ? "#333" : "#ccc"} transparent`,
    },

    poseCard: {
      background: isDark ? "#121212" : "#ffffff",
      border: `1px solid ${isDark ? "#333333" : "#e0e0e0"}`,
      borderRadius: "16px",
      padding: isNarrow ? "10px" : isShort ? "12px" : "20px", // ← tighter padding
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      boxShadow: isDark ? "none" : "0 6px 16px rgba(0,0,0,0.04)",
      overflow: "hidden",
    },

    poseGrid: {
      display: "flex",
      gap: "10px",
      alignItems: "stretch",
      minWidth: 0,
    },

    poseItem: {
      background: isDark ? "#ffffff08" : "#f8f9fa",
      border: `1px solid ${isDark ? "#ffffff10" : "#eeeeee"}`,
      borderRadius: "10px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      flex: "1 1 0",
      minWidth: 0,
      padding: "clamp(10px, 1.5vw, 20px) 5px",
      overflow: "hidden",
    },
    poseLabel: {
      fontSize: "clamp(11px, 1.2vw, 14px)",
      fontWeight: 700,
      color: isDark ? "#9e9ec0" : "#666",
      textTransform: "uppercase",
      marginBottom: "8px",
      letterSpacing: "1px",
      textAlign: "center",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      maxWidth: "100%",
    },
    poseVal: {
      fontSize: "clamp(16px, 2.2vw, 32px)",
      fontWeight: 700,
      color: isDark ? "#00e5ff" : "#007b83",
      fontFamily: "monospace",
      whiteSpace: "nowrap",
    },

    popupWrap2: {
      position: "fixed",
      top: "75px",
      right: "20px",
      width: isNarrow ? "calc(100vw - 40px)" : "380px",
      zIndex: 1000,
      display: showMonitor ? "block" : "none",
    },
  };

  return (
    <>
      <style>{`
        body, html, #root {
          margin: 0 !important; padding: 0 !important;
          width: 100% !important; height: 100% !important;
          background-color: ${isDark ? "#08080c" : "#f0f2f5"} !important;
          overflow: hidden;
        }
        * { box-sizing: border-box; }

        /* Thin scrollbar for right panel */
        .right-panel::-webkit-scrollbar       { width: 4px; }
        .right-panel::-webkit-scrollbar-track { background: transparent; }
        .right-panel::-webkit-scrollbar-thumb {
          background: ${isDark ? "#333" : "#ccc"};
          border-radius: 4px;
        }
      `}</style>

      <div style={S.app}>
        {showStatusToast && updateInfo && (
          <div
            style={{
              position: "fixed",
              top: "16px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              gap: "10px",
              background:
                updateInfo.status === "available" ||
                updateInfo.status === "downloaded"
                  ? isDark
                    ? "#1b5e20"
                    : "#e8f5e9"
                  : updateInfo.status === "downloading"
                    ? isDark
                      ? "#0d47a1"
                      : "#e3f2fd"
                    : updateInfo.status === "error"
                      ? isDark
                        ? "#b71c1c"
                        : "#ffebee"
                      : isDark
                        ? "#333"
                        : "#fff",
              color:
                updateInfo.status === "available" ||
                updateInfo.status === "downloaded"
                  ? isDark
                    ? "#81c784"
                    : "#2e7d32"
                  : updateInfo.status === "downloading"
                    ? isDark
                      ? "#64b5f6"
                      : "#1565c0"
                    : updateInfo.status === "error"
                      ? isDark
                        ? "#e57373"
                        : "#c62828"
                      : isDark
                        ? "#ccc"
                        : "#666",
              border: `1px solid ${
                updateInfo.status === "available" ||
                updateInfo.status === "downloaded"
                  ? "#4caf50"
                  : updateInfo.status === "downloading"
                    ? "#2196f3"
                    : isDark
                      ? "#444"
                      : "#ddd"
              }`,
              padding: "8px 18px",
              borderRadius: "24px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            <span>
              {updateInfo.status === "checking"
                ? "Checking for updates..."
                : updateInfo.status === "available"
                  ? "Update available! Downloading..."
                  : updateInfo.status === "downloading"
                    ? `Downloading: ${updateInfo.progress}%`
                    : updateInfo.status === "downloaded"
                      ? "Update ready. Restarting..."
                      : updateInfo.status === "error"
                        ? `Error: ${updateInfo.message}`
                        : updateInfo.message || "No Update Available"}
            </span>
            <button
              onClick={() => setShowStatusToast(false)}
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                padding: 0,
                marginLeft: "8px",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        )}

        {showMonitor && (
          <div style={S.popupWrap2}>
            <TopicMonitor ros={rosObj} isDark={isDark} />
          </div>
        )}

        <div style={S.wrap}>
            <div style={S.mainContent}>
              <div style={S.mapCard}>
                <div style={S.mapHeader}>
                  <div
                    style={{
                      fontSize: "18px",
                      fontWeight: 600,
                      color: isDark ? "#90caf9" : "#1976d2",
                    }}
                  >
                    Map:{" "}
                    <span style={{ color: isDark ? "#fff" : "#111" }}>
                      {mapName || "Loading..."}
                    </span>
                    <span
                      style={{
                        padding: "3px 8px",
                        fontSize: "12px",
                        borderRadius: "6px",
                        border: "1px solid",
                        marginLeft: "12px",
                        background: isDark ? "#1b5e2033" : "#e8f5e9",
                        color: isDark ? "#81c784" : "#2e7d32",
                        borderColor: isDark ? "#4caf5055" : "#81c784",
                      }}
                    >
                      {mapBadgeText}
                    </span>
                  </div>
                  <button
                    style={{
                      background: "transparent",
                      border: "none",
                      color: isDark ? "#90caf9" : "#1976d2",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: 600,
                    }}
                    onClick={fetchMap}
                  >
                    ↻ REFRESH
                  </button>
                </div>

                <div style={S.mapCanvasWrap} ref={mapWrapRef}>
                  <WorldMap
                    mapData={mapData}
                    pose={pose}
                    urdf={urdf}
                    width={canvasSize.w}
                    height={canvasSize.h}
                    isDark={isDark}
                  />
                </div>
              </div>

              <div style={S.rightPanel} className="right-panel">
                <div style={S.poseCard}>
                  <div
                    style={{
                      fontSize: isNarrow ? "13px" : "18px", // ← scales down
                      fontWeight: 600,
                      color: isDark ? "#90caf9" : "#1976d2",
                      marginBottom: isNarrow ? "8px" : "16px", // ← tighter gap
                      textAlign: "center",
                    }}
                  >
                    Odometry
                  </div>
                  <div style={S.poseGrid}>
                    {[
                      { label: "X", value: pose.x, unit: "[m]" },
                      { label: "Y", value: pose.y, unit: "[m]" },
                      {
                        label: "Angle",
                        value: pose.theta === "-" ? "-" : `${pose.theta}°`,
                        unit: "[degrees]",
                      },
                    ].map(({ label, value, unit }) => (
                      <div key={label} style={S.poseItem}>
                        <div style={S.poseLabel}>{label}</div>
                        <div style={S.poseVal}>{value}</div>
                        <div
                          style={{
                            fontSize: "clamp(10px, 1vw, 13px)",
                            fontWeight: 600,
                            color: isDark ? "#7a7a9e" : "#999999",
                            marginTop: "8px",
                            letterSpacing: "0.5px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {unit}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <SimSelector
                  ref={simSelectorRef}
                  onSwitch={handleSwitch}
                  onStop={() => setIsWaitingOdom(false)}
                  isDark={isDark}
                  isWaitingOdom={isWaitingOdom}
                />

                <KeyboardController ros={rosObj} isDark={isDark} />
              </div>
            </div>
          </div>
        </div>
    </>
  );
}
