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
import UpdateProgressModal from '../ui/UpdateProgressModal';

const HOST = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
const MAP_SERVER_URL = `http://${HOST}:3001/map`;
const URDF_SERVER_URL = `http://${HOST}:3001/urdf`;
const ROBOTS_URL = `http://${HOST}:3001/robots`;
const STATUS_URL = `http://${HOST}:3001/status`;
const SWITCH_URL = `http://${HOST}:3001/switch`;
const STOP_URL = `http://${HOST}:3001/stop`;
const STATUS_INTERVAL = 1500;
// Stop the sim if the robot hasn't moved for this long, then wait for the
// user to Launch again. Guards against a dashboard left running overnight
// pinning a CPU core on the 20 Hz /odom render loop.
const IDLE_STOP_MS = 60 * 60 * 1000;
const IDLE_CHECK_MS = 60 * 1000;
const IDLE_MOVE_EPS_M = 0.02;   // metres
const IDLE_MOVE_EPS_DEG = 1.0;  // degrees

import { parseURDF, drawRobot, normaliseMap, buildTransform } from '../../utils/robot';

function getFollowPan(pose, mapData, width, height, view) {
  if (!pose || pose.x === "-" || !mapData?.map_info) return { panX: view.panX, panY: view.panY };
  const { scale, offsetX, offsetY } = buildTransform(mapData.map_info, width, height);
  const { origin_x, origin_y } = mapData.map_info;
  const worldX = typeof pose.x === "string" ? parseFloat(pose.x) : pose.x;
  const worldY = typeof pose.y === "string" ? parseFloat(pose.y) : pose.y;
  const rx = width - offsetX - (worldY - origin_y) * scale;
  const ry = height - offsetY - (worldX - origin_x) * scale;
  const dx = rx - width / 2;
  const dy = ry - height / 2;
  const cos = Math.cos(view.rotation);
  const sin = Math.sin(view.rotation);
  return {
    panX: -view.zoom * (dx * cos - dy * sin),
    panY: -view.zoom * (dx * sin + dy * cos),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WorldMap Component
// ─────────────────────────────────────────────────────────────────────────────
const WorldMap = React.memo(forwardRef(function WorldMap({ mapData, poseRef, steeringRef, urdf, width = 560, height = 560, isDark, effectActive, effectStartTime, effectEndTime, collisionActive }, ref) {
  const canvasRef = useRef(null);
  const drawRef = useRef(null);
  const fpsLimit = useAppStore((s) => s.fpsLimit);

  const needsRedrawRef = useRef(true);
  const effectActiveRef = useRef(effectActive);
  const collisionActiveRef = useRef(collisionActive);

  // /odom (20 Hz) and /joint_states write their refs and call this instead of
  // setting React state, so a moving robot never reconciles the view tree.
  useImperativeHandle(ref, () => ({
    markDirty: () => { needsRedrawRef.current = true; },
  }), []);

  useEffect(() => {
    if (fpsLimit === 0) {
      // Unlimited: pure rAF
      let frame;
      const loop = () => {
        frame = requestAnimationFrame(loop);
        needsRedrawRef.current = false;
        if (drawRef.current) drawRef.current();
      };
      frame = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(frame);
    } else {
      // Capped FPS: setInterval fires exactly N times/s, no wasted rAF callbacks
      // ponytail: setInterval drifts ~1ms/tick vs rAF's vsync precision; fine for 20/60fps canvas
      const timer = setInterval(() => {
        const lowPowerMode = fpsLimit === 20;
        if (lowPowerMode && !needsRedrawRef.current && !effectActiveRef.current && !collisionActiveRef.current) return;
        needsRedrawRef.current = false;
        if (drawRef.current) drawRef.current();
      }, 1000 / fpsLimit);
      return () => clearInterval(timer);
    }
  }, [fpsLimit]);

  const [debugStats, setDebugStats] = useState({ fps: 0, rtf: "1.00" });
  const frameDeltasRef = useRef([]);
  const lastFrameTimeRef = useRef(0); // seeded on the first frame
  const lastUiUpdateRef = useRef(0);
  const odomSamplesRef = useRef([]);

  const [view, setView] = useState({ zoom: 1, rotation: 0, panX: 0, panY: 0 });
  const [followRobot, setFollowRobot] = useState(false);

  // Mark dirty whenever a visual input that lives in React changes. Pose and
  // steering angle are refs now -- they signal redraw via markDirty().
  // followRobot must be here: toggling it with a stationary robot changes
  // nothing else, but the view still needs to recentre.
  useEffect(() => {
    needsRedrawRef.current = true;
    effectActiveRef.current = effectActive;
    collisionActiveRef.current = collisionActive;
  }, [effectActive, collisionActive, mapData, urdf, isDark, view, followRobot, width, height]);

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
      if (followRobot) {
        setFollowRobot(false);
        const { panX, panY } = getFollowPan(poseRef.current, mapData, width, height, view);
        setView((v) => ({ ...v, panX, panY }));
      }
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
    setFollowRobot(false);
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


  // RTF (real-time factor) sampling: was a [pose] effect, now sampled in the
  // draw loop off the pose ref -- one sample per new /odom stamp.
  const lastSampledStampRef = useRef(null);
  const sampleRtf = (pose) => {
    if (!pose || pose.x === "-") return;
    const stampSec = pose.stampSec ?? null;
    if (stampSec !== null && stampSec === lastSampledStampRef.current) return;
    lastSampledStampRef.current = stampSec;
    const nowWall = performance.now() / 1000;
    const samples = odomSamplesRef.current;
    samples.push({
      sim: stampSec !== null && stampSec > 0 ? stampSec : (samples.length > 0 ? samples[samples.length - 1].sim + 0.05 : nowWall),
      wall: nowWall,
    });
    if (samples.length > 40) samples.shift();
  };

  // Assigned in an effect, not during render: the frame loop only ever reads
  // drawRef.current, so it is enough that this lands before the next tick.
  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pose = poseRef.current;
    const steeringAngle = steeringRef.current;
    sampleRtf(pose);
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

    const { scale, offsetX, offsetY, toCanvas } = buildTransform(
      mapData.map_info,
      width,
      height,
    );
    const { origin_x, origin_y, width: mw, height: mh } = mapData.map_info;

    ctx.save();
    if (followRobot && pose && pose.x !== "-") {
      const worldX = typeof pose.x === "string" ? parseFloat(pose.x) : pose.x;
      const worldY = typeof pose.y === "string" ? parseFloat(pose.y) : pose.y;
      const rx = width - offsetX - (worldY - origin_y) * scale;
      const ry = height - offsetY - (worldX - origin_x) * scale;

      ctx.translate(width / 2, height / 2);
      ctx.scale(view.zoom, view.zoom);
      ctx.rotate(view.rotation);
      ctx.translate(-rx, -ry);
    } else {
      ctx.translate(width / 2 + view.panX, height / 2 + view.panY);
      ctx.scale(view.zoom, view.zoom);
      ctx.rotate(view.rotation);
      ctx.translate(-width / 2, -height / 2);
    }

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
      const worldX = typeof pose.x === 'string' ? parseFloat(pose.x) : pose.x;
      const worldY = typeof pose.y === 'string' ? parseFloat(pose.y) : pose.y;
      const thetaRad = typeof pose.theta === 'string' ? (parseFloat(pose.theta) * Math.PI) / 180 : (pose.theta * Math.PI) / 180;
      // Use precise sub-pixel coordinates to prevent lateral judder when moving diagonally
      const rx = width - offsetX - (worldY - origin_y) * scale;
      const ry = height - offsetY - (worldX - origin_x) * scale;
      drawRobot(
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
        pose.vx,
        pose.w,
        effectActive,
        effectStartTime,
        effectEndTime,
        collisionActive,
        steeringAngle ?? null
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

    ctx.restore(); // close the axis-widget transform opened above

    // Scale bar -- screen-aligned in the bottom-left corner. Must be drawn
    // after the restore above, or it inherits the widget's rotation (and the
    // unbalanced save() leaked one canvas state per frame).
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

    const now = performance.now();
    const frameDelta = now - lastFrameTimeRef.current;
    lastFrameTimeRef.current = now;
    if (frameDelta > 0 && frameDelta < 1000) {
      frameDeltasRef.current.push(frameDelta);
      if (frameDeltasRef.current.length > 60) frameDeltasRef.current.shift();
    }

    if (now - lastUiUpdateRef.current >= 300) {
      lastUiUpdateRef.current = now;
      const deltas = frameDeltasRef.current;
      const avgDelta = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
      const calculatedFps = avgDelta > 0 ? Math.round(1000 / avgDelta) : 0;

      const samples = odomSamplesRef.current;
      let calculatedRtf = 1.0;
      if (samples.length >= 2) {
        const first = samples[0];
        const last = samples[samples.length - 1];
        const dSim = last.sim - first.sim;
        const dWall = last.wall - first.wall;
        if (dWall > 0.05) {
          calculatedRtf = Math.min(9.99, Math.max(0.0, dSim / dWall));
        }
      }

      setDebugStats({
        fps: calculatedFps,
        rtf: calculatedRtf.toFixed(2),
      });
    }
  };

  // No dep array: `draw` closes over view/followRobot/mapData/..., so the loop
  // must always be handed the newest one.
  useEffect(() => {
    drawRef.current = draw;
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        style={{
          position: "absolute",
          top: "16px",
          left: "16px",
          fontSize: "11px",
          fontFamily: "monospace",
          color: isDark ? "rgba(248, 250, 252, 0.75)" : "rgba(15, 23, 42, 0.75)",
          background: isDark
            ? "rgba(15, 23, 42, 0.65)"
            : "rgba(255, 255, 255, 0.75)",
          backdropFilter: "blur(6px)",
          border: isDark
            ? "1px solid rgba(255, 255, 255, 0.12)"
            : "1px solid rgba(15, 23, 42, 0.12)",
          borderRadius: "8px",
          padding: "5px 9px",
          pointerEvents: "none",
          zIndex: 5,
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          lineHeight: "1.3",
        }}
      >
        <div>FPS: {debugStats.fps}</div>
        <div>RTF: {debugStats.rtf}</div>
      </div>
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
      <button
        type="button"
        onClick={() => {
          setFollowRobot((prev) => {
            if (prev) {
              const { panX, panY } = getFollowPan(poseRef.current, mapData, width, height, view);
              setView((v) => ({ ...v, panX, panY }));
            }
            return !prev;
          });
        }}
        style={{
          position: "absolute",
          top: "16px",
          right: "16px",
          background: followRobot
            ? "#2563eb"
            : isDark
              ? "rgba(15, 23, 42, 0.88)"
              : "rgba(255, 255, 255, 0.95)",
          color: followRobot ? "#ffffff" : isDark ? "#f8fafc" : "#0f172a",
          border: followRobot
            ? "1.5px solid #60a5fa"
            : isDark
              ? "1.5px solid rgba(255, 255, 255, 0.25)"
              : "1.5px solid rgba(15, 23, 42, 0.2)",
          borderRadius: "10px",
          padding: "8px 14px",
          fontSize: "13px",
          fontWeight: 700,
          cursor: "pointer",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          boxShadow: followRobot
            ? "0 4px 16px rgba(37, 99, 235, 0.45)"
            : "0 4px 12px rgba(0, 0, 0, 0.2)",
          transition: "all 0.2s ease",
          zIndex: 5,
        }}
      >
        <span style={{ fontSize: "14px" }}>🎯</span>
        <span style={{ letterSpacing: "0.2px" }}>
          {followRobot ? "Following Robot" : "Follow Robot"}
        </span>
        {followRobot && (
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#4ade80",
              boxShadow: "0 0 8px #4ade80",
            }}
          />
        )}
      </button>
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
}));

const ArrowSvg = ({ angle = 0 }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${angle}deg)` }}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
const CircleSvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <circle cx="12" cy="12" r="10" />
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────
// KeyboardController
// ─────────────────────────────────────────────────────────────────────────────
function KeyboardController({ ros, isDark, isNarrow, isShort }) {
  const cmdPubRef = useRef(null);
  const [keys, setKeys] = useState({});
  const [speed, setSpeed] = useState(0.5);
  const [turnSpeed, setTurnSpeed] = useState(1.0);
  const [webControl, setWebControl] = useState(true);
  const [isHolonomic, setIsHolonomic] = useState(false);
  const [watchdogEnabled, setWatchdogEnabled] = useState(false);

  const toggleWatchdog = (enabled) => {
    setWatchdogEnabled(enabled);
    if (enabled) setKeys({});
    if (!ros) return;
    const svc = new ROSLIB.Service({
      ros,
      name: '/amr_simulator/set_parameters',
      serviceType: 'rcl_interfaces/srv/SetParameters',
    });
    svc.callService(
      {
        parameters: [{
          name: 'enable_watchdog',
          value: { type: 1, bool_value: enabled },  // type 1 = PARAMETER_BOOL
        }],
      },
      () => { },
      (err) => console.warn('watchdog toggle failed:', err)
    );
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!webControl) return;

      if (e.key === "Shift") {
        setIsHolonomic(true);
        return;
      }

      const k = e.key;
      const lower = k.toLowerCase();

      if (lower === "k") {
        e.preventDefault();
        setKeys({});
      } else if (["u", "i", "o", "j", "l", "m", ",", ".", "U", "I", "O", "J", "L", "M", "<", ">"].includes(k)) {
        e.preventDefault();
        setKeys({ [k]: true });
      } else if (lower === "w") {
        setSpeed((s) => Math.min(2.0, s * 1.1));
      } else if (lower === "x") {
        setSpeed((s) => Math.max(0.1, s * 0.9));
      } else if (lower === "e") {
        setTurnSpeed((t) => Math.min(3.0, t * 1.1));
      } else if (lower === "c") {
        setTurnSpeed((t) => Math.max(0.1, t * 0.9));
      } else if (lower === "q") {
        setSpeed((s) => Math.min(2.0, s * 1.1));
        setTurnSpeed((t) => Math.min(3.0, t * 1.1));
      } else if (lower === "z") {
        setSpeed((s) => Math.max(0.1, s * 0.9));
        setTurnSpeed((t) => Math.max(0.1, t * 0.9));
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === "Shift") {
        setIsHolonomic(false);
      }

      const k = e.key;
      if (["u", "i", "o", "j", "l", "m", ",", ".", "U", "I", "O", "J", "L", "M", "<", ">"].includes(k)) {
        if (watchdogEnabled) {
          setKeys((prev) => {
            const next = { ...prev };
            delete next[k];
            return next;
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [webControl, watchdogEnabled]);

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

      let lx = 0, ly = 0, az = 0;
      let moving = false;

      // Terminal mode is "commanding zero", not "publishing nothing": bailing
      // out here left the last twist latched, so switching to Terminal while
      // the robot was driving kept it driving (forever, with the watchdog off).
      // Falling through sends the 10 stop messages below, then goes quiet so
      // it never fights a teleop node running in a shell.
      if (webControl) {
        // Non-Holonomic
        if (keys["u"]) { lx = speed; az = turnSpeed; moving = true; }
        if (keys["i"]) { lx = speed; az = 0; moving = true; }
        if (keys["o"]) { lx = speed; az = -turnSpeed; moving = true; }
        if (keys["j"]) { lx = 0; az = turnSpeed; moving = true; }
        if (keys["l"]) { lx = 0; az = -turnSpeed; moving = true; }
        if (keys["m"]) { lx = -speed; az = -turnSpeed; moving = true; }
        if (keys[","]) { lx = -speed; az = 0; moving = true; }
        if (keys["."]) { lx = -speed; az = turnSpeed; moving = true; }

        // Holonomic
        if (keys["U"]) { lx = speed; ly = speed; moving = true; }
        if (keys["I"]) { lx = speed; ly = 0; moving = true; }
        if (keys["O"]) { lx = speed; ly = -speed; moving = true; }
        if (keys["J"]) { lx = 0; ly = speed; moving = true; }
        if (keys["L"]) { lx = 0; ly = -speed; moving = true; }
        if (keys["M"]) { lx = -speed; ly = speed; moving = true; }
        if (keys["<"]) { lx = -speed; ly = 0; moving = true; }
        if (keys[">"]) { lx = -speed; ly = -speed; moving = true; }
      }

      if (moving) {
        zeroCount = 0;
        cmdPubRef.current.publish({
          linear: { x: lx, y: ly, z: 0.0 },
          angular: { x: 0.0, y: 0.0, z: az },
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
  }, [keys, speed, turnSpeed, webControl, watchdogEnabled]);

  const S = {
    wrap: {
      background: isDark ? "#121212" : "#ffffff",
      border: `1px solid ${isDark ? "#333333" : "#e0e0e0"}`,
      borderRadius: "16px",
      padding: isShort ? "8px" : "16px",
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
      flexWrap: "wrap",
      gap: "8px",
      marginBottom: isShort ? "8px" : "20px",
    },
    title: {
      fontSize: isShort || isNarrow ? "15px" : "18px",
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
      gap: isShort ? "12px" : "20px",
      justifyContent: "center",
    },
    dpad: {
      display: "grid",
      gridTemplateColumns: isShort ? "repeat(3, 36px)" : "repeat(3, 44px)",
      gridTemplateRows: isShort ? "repeat(3, 36px)" : "repeat(3, 44px)",
      gap: isShort ? "4px" : "6px",
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

  const renderVKey = (baseKey, icon, styleOverrides) => {
    let actualKey = isHolonomic ? baseKey.toUpperCase() : baseKey.toLowerCase();
    if (isHolonomic && baseKey === ',') actualKey = '<';
    if (isHolonomic && baseKey === '.') actualKey = '>';

    const handlePress = (e) => {
      if (e) e.preventDefault();
      if (!webControl) return;

      if (baseKey === "k") {
        setKeys({});
      } else {
        setKeys({ [actualKey]: true });
      }
    };

    const handleRelease = (e) => {
      if (e) e.preventDefault();
      if (baseKey === "k" || !webControl) return;
      if (!watchdogEnabled) return;
      setKeys((prev) => {
        const next = { ...prev };
        delete next[actualKey];
        return next;
      });
    };

    return (
      <div
        style={{ ...S.key(!!keys[actualKey] && webControl), position: 'relative', ...styleOverrides }}
        onMouseDown={handlePress}
        onMouseUp={handleRelease}
        onMouseLeave={handleRelease}
        onTouchStart={handlePress}
        onTouchEnd={handleRelease}
      >
        <div style={{ fontSize: baseKey === 'k' ? '12px' : '22px' }}>
          {icon}
        </div>
        <div style={{
          position: 'absolute', top: '4px', right: '6px',
          fontSize: '11px', fontWeight: 700,
          color: isDark ? '#B4B2A9' : '#666666',
          background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          padding: '1px 4px', borderRadius: '4px',
          fontFamily: 'monospace', lineHeight: 1
        }}>
          {isHolonomic ? actualKey : baseKey}
        </div>
      </div>
    );
  };

  const triggerActuator = () => {
    if (!ros) return;
    const svc = new ROSLIB.Service({
      ros,
      name: '/actuate_effect',
      serviceType: 'std_srvs/srv/Trigger',
    });
    svc.callService({}, () => { });
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

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px',
        background: isDark ? '#1e1e2d' : '#f5f5f5', padding: '6px 12px', borderRadius: '12px', marginBottom: isShort ? '8px' : '16px',
        border: `1px solid ${isDark ? '#333' : '#e0e0e0'}`
      }}>
        {/* Watchdog toggle */}
        <div
          title={watchdogEnabled ? 'Watchdog ON — click to disable' : 'Watchdog OFF — click to enable'}
          onClick={() => toggleWatchdog(!watchdogEnabled)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '6px 12px', borderRadius: '20px', cursor: 'pointer',
            fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px',
            userSelect: 'none', transition: 'all 0.2s', height: '28px',
            background: watchdogEnabled ? '#00e67625' : (isDark ? '#ffffff0d' : '#e0e0e0'),
            color: watchdogEnabled ? '#00e676' : (isDark ? '#888' : '#666'),
          }}
        >
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: watchdogEnabled ? '#00e676' : (isDark ? '#555' : '#aaa'),
            boxShadow: watchdogEnabled ? '0 0 6px #00e676' : 'none',
            transition: 'all 0.2s',
          }} />
          WATCHDOG
        </div>

        {/* Web/Terminal toggle */}
        <div style={{ ...S.toggleWrap, margin: 0 }} onClick={() => {
          // Drop the latched keys on the way out, so handing control back to
          // the UI later doesn't silently resume the command it was holding.
          if (webControl) setKeys({});
          setWebControl(!webControl);
        }}>
          <div style={S.toggleOpt(!webControl, "#ff1744")}>
            <div style={{ width: "8px", height: "8px", borderRadius: "30%", background: !webControl ? "#ff1744" : "transparent", boxShadow: !webControl ? "0 0 8px #ff1744" : "none", transition: "all 0.2s" }} />
            Terminal
          </div>
          <div style={S.toggleOpt(webControl, "#00e676")}>
            <div style={{ width: "8px", height: "8px", borderRadius: "30%", background: webControl ? "#00e676" : "transparent", boxShadow: webControl ? "0 0 8px #00e676" : "none", transition: "all 0.2s" }} />
            UI
          </div>
        </div>
      </div>

      <div style={S.titleRow}>
        <div style={S.title}>Robot Control</div>
      </div>

      <div style={S.controlBody}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: isShort ? '8px' : '16px' }}>
          {/* Holonomic Toggle */}
          <div
            onClick={() => {
              if (!webControl) return;
              setIsHolonomic(!isHolonomic);
            }}
            title={!webControl ? "Enable UI control first" : "Toggle Holonomic Mode"}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              fontSize: '11px', fontWeight: 800, padding: '6px 14px', borderRadius: '20px',
              background: isHolonomic ? (isDark ? '#00e67625' : '#e8f5e9') : (isDark ? '#ffffff10' : '#f0f0f0'),
              color: isHolonomic ? '#00e676' : (isDark ? '#aaaaaa' : '#888888'),
              border: `1px solid ${isHolonomic ? '#00e67688' : (isDark ? '#444' : '#ddd')}`,
              userSelect: 'none', transition: 'all 0.2s',
              cursor: webControl ? 'pointer' : 'not-allowed',
              opacity: webControl ? 1 : 0.5
            }}
          >
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: isHolonomic ? '#00e676' : (isDark ? '#666' : '#aaa'),
              boxShadow: isHolonomic ? '0 0 6px #00e676' : 'none',
              transition: 'all 0.2s'
            }} />
            HOLONOMIC: {isHolonomic ? 'ON' : 'OFF'}
          </div>

          <div style={S.dpad}>
            {renderVKey("u", <ArrowSvg angle={-45} />)}
            {renderVKey("i", <ArrowSvg angle={0} />)}
            {renderVKey("o", <ArrowSvg angle={45} />)}
            {renderVKey("j", <ArrowSvg angle={-90} />)}
            {renderVKey("k", <CircleSvg />)}
            {renderVKey("l", <ArrowSvg angle={90} />)}
            {renderVKey("m", <ArrowSvg angle={-135} />)}
            {renderVKey(",", <ArrowSvg angle={180} />)}
            {renderVKey(".", <ArrowSvg angle={135} />)}
          </div>
        </div>

        {/* Movement Scale Sub-panel */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: isShort ? '8px' : '12px',
          background: isDark ? '#ffffff05' : '#f8f9fa',
          border: `1px solid ${isDark ? '#ffffff15' : '#e0e0e0'}`,
          borderRadius: '12px', padding: isShort ? '10px' : '16px',
          flex: 1
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: isDark ? '#aaa' : '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            Movement Scale
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ width: '40px', fontSize: '13px', fontWeight: 600, color: isDark ? '#ccc' : '#444' }}>Speed</span>
            <button
              title="Decrease Speed (X)"
              onClick={() => webControl && setSpeed(Math.max(0.1, speed - 0.1))}
              style={{ width: '28px', height: '28px', borderRadius: '6px', border: 'none', background: isDark ? '#333' : '#e0e0e0', color: isDark ? '#fff' : '#000', cursor: webControl ? 'pointer' : 'not-allowed', position: 'relative' }}>
              −<span style={{ position: 'absolute', top: '2px', left: '2px', fontSize: '8px', opacity: 0.5 }}>X</span>
            </button>
            <input
              type="range" className="tele-slider" min="0.1" max="2.0" step="0.1"
              value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))}
              style={{ ...S.slider(speed, 0.1, 2.0, isDark ? "#85B7EB" : "#1a3a8f"), flex: 1 }}
              disabled={!webControl}
            />
            <button
              title="Increase Speed (W)"
              onClick={() => webControl && setSpeed(Math.min(2.0, speed + 0.1))}
              style={{ width: '28px', height: '28px', borderRadius: '6px', border: 'none', background: isDark ? '#333' : '#e0e0e0', color: isDark ? '#fff' : '#000', cursor: webControl ? 'pointer' : 'not-allowed', position: 'relative' }}>
              +<span style={{ position: 'absolute', top: '2px', right: '2px', fontSize: '8px', opacity: 0.5 }}>W</span>
            </button>
            <span style={{ width: '32px', textAlign: 'right', fontSize: '13px', fontWeight: 600, color: isDark ? '#85B7EB' : '#1a3a8f' }}>{speed.toFixed(2)}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ width: '40px', fontSize: '13px', fontWeight: 600, color: isDark ? '#ccc' : '#444' }}>Angle</span>
            <button
              title="Decrease Angle (C)"
              onClick={() => webControl && setTurnSpeed(Math.max(0.1, turnSpeed - 0.1))}
              style={{ width: '28px', height: '28px', borderRadius: '6px', border: 'none', background: isDark ? '#333' : '#e0e0e0', color: isDark ? '#fff' : '#000', cursor: webControl ? 'pointer' : 'not-allowed', position: 'relative' }}>
              −<span style={{ position: 'absolute', top: '2px', left: '2px', fontSize: '8px', opacity: 0.5 }}>C</span>
            </button>
            <input
              type="range" className="tele-slider" min="0.1" max="3.0" step="0.1"
              value={turnSpeed} onChange={(e) => setTurnSpeed(parseFloat(e.target.value))}
              style={{ ...S.slider(turnSpeed, 0.1, 3.0, isDark ? "#85B7EB" : "#1a3a8f"), flex: 1 }}
              disabled={!webControl}
            />
            <button
              title="Increase Angle (E)"
              onClick={() => webControl && setTurnSpeed(Math.min(3.0, turnSpeed + 0.1))}
              style={{ width: '28px', height: '28px', borderRadius: '6px', border: 'none', background: isDark ? '#333' : '#e0e0e0', color: isDark ? '#fff' : '#000', cursor: webControl ? 'pointer' : 'not-allowed', position: 'relative' }}>
              +<span style={{ position: 'absolute', top: '2px', right: '2px', fontSize: '8px', opacity: 0.5 }}>E</span>
            </button>
            <span style={{ width: '32px', textAlign: 'right', fontSize: '13px', fontWeight: 600, color: isDark ? '#85B7EB' : '#1a3a8f' }}>{turnSpeed.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'center', gap: '24px', marginTop: isShort ? '8px' : '16px',
        background: isDark ? '#00000033' : '#e0e0e055',
        padding: isShort ? '8px 16px' : '12px 24px', borderRadius: '8px',
        fontFamily: 'monospace', fontSize: '14px', fontWeight: 600,
        border: `1px solid ${isDark ? '#333' : '#ccc'}`
      }}>
        <span>
          X: <span style={{ color: webControl ? (isDark ? "#85B7EB" : "#1a3a8f") : (isDark ? "#555" : "#aaa") }}>
            {keys["i"] && webControl ? speed.toFixed(2) : keys[","] && webControl ? (-speed).toFixed(2) : "0.00"}
          </span>
        </span>
        <span>
          Z: <span style={{ color: webControl ? (isDark ? "#85B7EB" : "#1a3a8f") : (isDark ? "#555" : "#aaa") }}>
            {keys["j"] && webControl ? turnSpeed.toFixed(2) : keys["l"] && webControl ? (-turnSpeed).toFixed(2) : "0.00"}
          </span>
        </span>
      </div>

      <button
        title="Trigger Mission Actuator"
        onClick={triggerActuator}
        style={{
          width: '100%',
          marginTop: isShort ? '8px' : '12px',
          padding: isShort ? '8px' : '12px',
          background: isDark ? '#2e7d32' : '#4caf50',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          fontWeight: 700,
          cursor: 'pointer',
          letterSpacing: '1px',
          boxShadow: isDark ? '0 0 10px #4caf5033' : '0 4px 6px rgba(0,0,0,0.1)',
          transition: 'all 0.2s'
        }}
        onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.15)'}
        onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
        onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
        onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
      >
        🚀 ACTUATE EFFECT
      </button>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// CustomDropdown  — defined OUTSIDE SimSelector so it never remounts
// ─────────────────────────────────────────────────────────────────────────────
function CustomDropdown({ label, value, onChange, options, onDelete, isDark }) {
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
                      justifyContent: "space-between",
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
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden", flex: 1 }}>
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
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {opt.label}
                      </span>
                    </div>
                    {onDelete && (
                      <button
                        title={`Delete ${opt.label}`}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          onDelete(opt);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: isDark ? "#ef4444" : "#dc2626",
                          cursor: "pointer",
                          padding: "2px 4px",
                          borderRadius: "4px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: 0.7,
                          transition: "opacity 0.2s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    )}
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
      const res = await fetch(ROBOTS_URL);
      const data = await res.json();
      setRobotList(data.robots ?? []);
    } catch (e) {
      console.error(e);
    }
  };
  useImperativeHandle(ref, () => ({ fetchRobots }));
  const [switching, setSwitching] = useState(false);
  // Errors only. This used to hold the success text too ("Switching → ...",
  // straight from the server), which just restated the status pill above and
  // then sat on screen until the next launch.
  const [switchError, setSwitchError] = useState("");
  const statusRef = useRef(null);
  const autoLaunched = useRef(false);

  const [deleteTarget, setDeleteTarget] = useState(null);

  const handleDeleteRobot = (robotOpt) => {
    setDeleteTarget({ type: 'robot', opt: robotOpt });
  };

  const handleDeleteWorld = (worldOpt) => {
    setDeleteTarget({ type: 'world', opt: worldOpt });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { type, opt } = deleteTarget;
    setDeleteTarget(null);
    try {
      if (type === 'robot') {
        const res = await fetch(`http://${HOST}:3001/api/robots/${opt.value}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to delete robot");
        const updatedList = robotList.filter((r) => r.name !== opt.value);
        setRobotList(updatedList);
        if (selRobot === opt.value) {
          setSelRobot(updatedList[0]?.name ?? "");
        }
      } else {
        const res = await fetch(`http://${HOST}:3001/api/worlds/${opt.value}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to delete world");
        const updatedList = worldList.filter((w) => w.name !== opt.value);
        setWorldList(updatedList);
        if (selWorld === opt.value) {
          setSelWorld(updatedList[0]?.name ?? "");
        }
      }
    } catch (err) {
      alert(`Error deleting ${type}: ${err.message}`);
    }
  };

  const doSwitch = useCallback(
    async (robot, world) => {
      if (!robot || !world) return;
      const { envData, setShowEnvModal } = useAppStore.getState();
      if (envData && !envData.allReady) {
        setShowEnvModal(true);
        return;
      }
      setSwitching(true);
      setSwitchError("");
      try {
        const res = await fetch(SWITCH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ robot, world }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          // A rejected launch answers { error }, not { message } -- report the
          // reason ("Robot file not found: x.urdf") rather than a bare "Error".
          setSwitchError(data.error ?? data.message ?? `map server returned ${res.status}`);
        } else if (onSwitch) {
          // 🌟 ทริกเกอร์ onSwitch ทันทีเพื่อให้ isWaitingOdom = true
          // ปุ่มจะได้เข้าสู่สถานะ 'Waiting' ทันทีโดยไม่ต้องรอให้ Polling ของ Server ส่งค่ากลับมา
          onSwitch(robot, world);
        }
      } catch (err) {
        setSwitchError(`${err.message}`);
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
          fetch(`http://${HOST}:3001/worlds`),
          fetch(STATUS_URL),
        ]);
        const robotData = await robotRes.json();
        const worldData = await worldRes.json();
        const statusData = await statusRes.json();
        const robots = robotData.robots ?? [];
        const worlds = worldData.worlds ?? [];
        setRobotList(robots);
        setWorldList(worlds);
        const defaultRobot = statusData.robot || robots.find(r => r.name === 'amr.urdf')?.name || robots[0]?.name || "";
        const defaultWorld = statusData.world || worlds[0]?.name || "";
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
        setSwitchError(`Cannot reach server: ${err.message}`);
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
          onDelete={handleDeleteRobot}
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
          onDelete={handleDeleteWorld}
          options={worldList.map((w) => ({
            value: w.name,
            label: w.mapName || w.name.replace(/\.json$/i, ""),
          }))}
        />
      </div>

      {/* ── Buttons ── */}
      <div style={{ padding: "0 20px 16px", display: "flex", gap: "10px" }}>
        <button
          onClick={() => {
            doSwitch(selRobot, selWorld);
          }}
          disabled={isBusy || !selRobot || !selWorld}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: "10px",
            border: "none",
            background: isBusy
              ? isDark
                ? "#1b5e20"
                : "#c8e6c9"
              : isDark
                ? "#2e7d32"
                : "#16a34a",
            color: isBusy ? (isDark ? "#81c784" : "#1b5e20") : "#fff",
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
              setSwitchError("");
              await fetch(STOP_URL, { method: "POST" });
              if (onStop) onStop();
            } catch (err) {
              setSwitchError(`${err.message}`);
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

      {/* Every failure path -- "Cannot reach server", /switch and /stop
          errors -- used to be collected and then never rendered, so the card
          just sat there looking idle. A successful launch shows nothing here;
          the status pill in the header already says LAUNCHING / RUNNING. */}
      {switchError && (
        <div
          style={{
            padding: "0 20px 14px",
            fontSize: "12px",
            lineHeight: 1.4,
            color: "#ef5350",
            wordBreak: "break-word",
          }}
        >
          {switchError}
        </div>
      )}

      <style>{`
        @keyframes simPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes simSpin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>

      {/* ── Custom Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            style={{
              background: isDark ? "#1e1e2d" : "#fff",
              padding: "32px",
              borderRadius: "16px",
              width: "320px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
              border: `1px solid ${border}`,
              color: isDark ? "#fff" : "#1a1a2a",
              textAlign: "center",
            }}
          >
            <h3 style={{ margin: "0 0 16px 0", fontSize: "22px", fontWeight: 700 }}>
              Delete {deleteTarget.type === 'robot' ? 'Robot' : 'World'}?
            </h3>
            <p style={{ margin: "0 0 24px 0", fontSize: "18px", color: isDark ? "#ccc" : "#444" }}>
              <strong>{deleteTarget.opt.label}</strong>
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button
                onClick={() => setDeleteTarget(null)}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: "8px",
                  border: `1px solid ${border}`,
                  background: "transparent",
                  color: isDark ? "#fff" : "#333",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "16px",
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: "8px",
                  border: "none",
                  background: "#dc2626",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "16px",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
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

  // Depend on the resolved message type (a string), not on `topics` -- that
  // array is rebuilt every 5 s by refreshTopics, and having it in the deps
  // below tore the subscription down and rebuilt it on every refresh.
  const rawType = topics.find((x) => x.name === selTopic)?.type;
  const selTopicType = Array.isArray(rawType) ? rawType[0] : rawType;

  useEffect(() => {
    if (!selTopic || !ros || !selTopicType) return;

    const listener = new ROSLIB.Topic({
      ros: ros,
      name: selTopic,
      messageType: selTopicType,
    });

    listener.subscribe((m) => {
      setMsgData(m);
    });
    subRef.current = listener;

    return () => {
      listener.unsubscribe();
      if (subRef.current === listener) subRef.current = null;
    };
  }, [selTopic, ros, selTopicType]);

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
        onChange={(e) => {
          // Clear here rather than in the subscribe effect: the panel should
          // blank when the user picks a different topic, not on every reconnect.
          setMsgData(null);
          setSelTopic(e.target.value);
        }}
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
// NotificationModal Component
// ─────────────────────────────────────────────────────────────────────────────
function NotificationModal({ notification, onClose, isDark }) {
  if (!notification) return null;
  const { title, message, type = "info", onConfirm } = notification;

  const typeMeta = {
    success: { icon: "✅", color: "#22c55e", bg: "rgba(34, 197, 94, 0.12)", border: "rgba(34, 197, 94, 0.3)" },
    error: { icon: "❌", color: "#ef4444", bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.3)" },
    warning: { icon: "⚠️", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.3)" },
    info: { icon: "ℹ️", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.3)" },
  }[type] || { icon: "ℹ️", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.3)" };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
      }}
    >
      <div
        style={{
          width: "420px",
          maxWidth: "90vw",
          background: isDark ? "#12121c" : "#ffffff",
          border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.1)"}`,
          borderRadius: "16px",
          padding: "24px",
          boxShadow: isDark ? "0 20px 50px rgba(0, 0, 0, 0.8)" : "0 20px 50px rgba(0, 0, 0, 0.15)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "12px",
              background: typeMeta.bg,
              border: `1px solid ${typeMeta.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "20px",
              flexShrink: 0,
            }}
          >
            {typeMeta.icon}
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: isDark ? "#f8fafc" : "#0f172a" }}>
              {title}
            </h3>
          </div>
        </div>

        <div style={{ fontSize: "13.5px", lineHeight: "1.5", color: isDark ? "#cbd5e1" : "#475569", whiteSpace: "pre-wrap" }}>
          {message}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
          <button
            type="button"
            onClick={() => {
              if (onConfirm) onConfirm();
              onClose();
            }}
            style={{
              padding: "10px 24px",
              borderRadius: "10px",
              border: "none",
              background: typeMeta.color,
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "14px",
              cursor: "pointer",
              boxShadow: `0 4px 14px ${typeMeta.color}55`,
              transition: "transform 0.15s",
            }}
            onMouseOver={(e) => (e.currentTarget.style.transform = "scale(1.02)")}
            onMouseOut={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Odometry number panel. Its own store subscription + memo so the throttled
// pose updates never re-render DashboardView.
// ─────────────────────────────────────────────────────────────────────────────
const PoseReadout = React.memo(function PoseReadout({ poseRef, isDark }) {
  // Polls the live pose ref a few times a second -- only this small component
  // re-renders, never the dashboard.
  // Seeded with the placeholder rather than poseRef.current -- reading a ref
  // during render is not allowed, and the first poll 150 ms later fills it in.
  const [pose, setPose] = useState({ x: "-", y: "-", theta: "-" });
  useEffect(() => {
    // null, not poseRef.current: the first tick must sync even for a robot
    // that is already parked and will never change the ref again.
    let prev = null;
    const iv = setInterval(() => {
      if (poseRef.current !== prev) {
        prev = poseRef.current;
        setPose(prev);
      }
    }, 150);
    return () => clearInterval(iv);
  }, [poseRef]);
  const fmt = (v, d) => (typeof v === "number" ? v.toFixed(d) : v);
  const items = [
    { label: "X", value: fmt(pose.x, 2), unit: "[m]" },
    { label: "Y", value: fmt(pose.y, 2), unit: "[m]" },
    { label: "Angle", value: pose.theta === "-" ? "-" : `${fmt(pose.theta, 1)}°`, unit: "[degrees]" },
  ];
  return (
    <div style={{ display: "flex", gap: "10px", alignItems: "stretch", minWidth: 0 }}>
      {items.map(({ label, value, unit }) => (
        <div
          key={label}
          style={{
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
          }}
        >
          <div
            style={{
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
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: "clamp(16px, 2.2vw, 32px)",
              fontWeight: 700,
              color: isDark ? "#00e5ff" : "#007b83",
              fontFamily: "monospace",
              whiteSpace: "nowrap",
            }}
          >
            {value}
          </div>
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
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// App (Main - No Scroll Layout)
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardView() {
  const {
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
    showMonitor,
    isDark,
    isWaitingOdom,
    setIsWaitingOdom,
  } = useAppStore();
  const simSelectorRef = useRef(null);
  const [appVersion, setAppVersion] = useState("0.0.0");
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showStatusToast, setShowStatusToast] = useState(false);
  const toastTimerRef = useRef(null);

  const [notification, setNotification] = useState(null);
  const [effectActive, setEffectActive] = useState(false);
  const effectActiveRef = useRef(false);
  const [effectStartTime, setEffectStartTime] = useState(0);
  const [effectEndTime, setEffectEndTime] = useState(0);

  const [collisionActive, setCollisionActive] = useState(false);
  const collisionActiveRef = useRef(false);
  const [showCollisionToast, setShowCollisionToast] = useState(false);
  const collisionToastTimerRef = useRef(null);

  // Live robot state consumed by the canvas at frame rate. NOT React state:
  // /odom and /joint_states arrive at 20 Hz and must not reconcile the view.
  const poseRef = useRef({ x: "-", y: "-", theta: "-" });
  const steeringRef = useRef(null);
  const worldMapRef = useRef(null);

  // Idle watchdog: stop the sim after IDLE_STOP_MS without robot movement.
  const [idleStopped, setIdleStopped] = useState(false);
  const lastMoveRef = useRef(0);
  const lastPoseRef = useRef(null);
  const idleStopFiredRef = useRef(false);

  const markActive = useCallback(() => {
    lastMoveRef.current = Date.now();
    idleStopFiredRef.current = false;
    setIdleStopped(false); // no-op re-render if already false
  }, []);

  // Seed the idle clock on mount. markActive() would do it, but it also calls
  // setIdleStopped, and a setState straight from an effect body is a cascading
  // render -- the refs are all this needs.
  useEffect(() => {
    lastMoveRef.current = Date.now();
    idleStopFiredRef.current = false;
  }, []);

  // Movement detector, called from the /odom handler -- a stationary robot
  // still streams /odom, so compare successive poses, not message arrival.
  const noteMovement = useCallback((x, y, deg) => {
    const prev = lastPoseRef.current;
    if (
      !prev ||
      Math.hypot(x - prev.x, y - prev.y) > IDLE_MOVE_EPS_M ||
      Math.abs(deg - prev.th) > IDLE_MOVE_EPS_DEG
    ) {
      lastPoseRef.current = { x, y, th: deg };
      markActive();
    }
  }, [markActive]);

  // Watchdog tick. idleStopFiredRef makes this fire /stop at most once per
  // idle stretch; markActive() re-arms it on the next launch or movement.
  useEffect(() => {
    const iv = setInterval(async () => {
      if (idleStopFiredRef.current || !lastMoveRef.current) return;
      if (Date.now() - lastMoveRef.current < IDLE_STOP_MS) return;
      try {
        const st = await fetch(STATUS_URL).then((r) => r.json());
        if (st?.status !== "running") return;
        idleStopFiredRef.current = true;
        await fetch(STOP_URL, { method: "POST" });
        setIdleStopped(true);
        setIsWaitingOdom(false);
      } catch {
        /* map-server unreachable -- try again next tick */
      }
    }, IDLE_CHECK_MS);
    return () => clearInterval(iv);
  }, [setIsWaitingOdom]);

  // The manual update check lives in Header (its own handleUpdate); the copy
  // that used to sit here was never wired to anything. Update toasts still
  // arrive through the onUpdateStatus subscription below.

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getAppVersion().then((v) => {
        if (v) setAppVersion(v);
      });
      const unsubscribe = window.electronAPI.onUpdateStatus((info) => {
        setUpdateInfo(info);
        setShowStatusToast(true);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        if (info.status !== 'downloading') {
          toastTimerRef.current = setTimeout(() => {
            setShowStatusToast(false);
          }, 10000);
        }
      });
      return () => unsubscribe && unsubscribe();
    }
  }, []);

  const mapWrapRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ w: 400, h: 300 });

  useEffect(() => {
    let timeoutId;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          setCanvasSize({
            w: entry.contentRect.width,
            h: entry.contentRect.height,
          });
        }, 16);
      }
    });
    if (mapWrapRef.current) observer.observe(mapWrapRef.current);
    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, []);

  const odomRef = useRef(null);



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
      const vx = msg.twist?.twist?.linear?.x ?? 0;
      const w = msg.twist?.twist?.angular?.z ?? 0;

      if (!isNaN(x) && !isNaN(y) && !isNaN(theta)) {
        const deg = (theta * 180) / Math.PI;
        const stampSec = (msg.header?.stamp?.sec ?? 0) + (msg.header?.stamp?.nanosec ?? 0) * 1e-9;

        // Live pose -> ref only. A parked robot still streams /odom at 20 Hz;
        // give poseRef a fresh object (and redraw the canvas) only when the
        // pose actually changed, so an idle sim costs nothing.
        const p = poseRef.current;
        const poseChanged =
          p.x === "-" ||
          Math.abs(x - p.x) > 1e-4 ||
          Math.abs(y - p.y) > 1e-4 ||
          Math.abs(deg - p.theta) > 1e-3;
        if (poseChanged) {
          poseRef.current = { x, y, theta: deg, vx, w, stampSec };
          worldMapRef.current?.markDirty();
        }
        noteMovement(x, y, deg);

        if (useAppStore.getState().isWaitingOdom) setIsWaitingOdom(false);
      }
    });
    odomRef.current = odom;

    const effectTopic = new ROSLIB.Topic({
      ros: rosObj,
      name: "/effect_active",
      messageType: "std_msgs/msg/Bool",
    });
    effectTopic.subscribe((msg) => {
      const currentActive = effectActiveRef.current;
      if (msg.data && !currentActive) {
        setEffectStartTime(Date.now());
      } else if (!msg.data && currentActive) {
        setEffectEndTime(Date.now());
      }
      effectActiveRef.current = msg.data;
      setEffectActive(msg.data);
    });

    const collisionTopic = new ROSLIB.Topic({
      ros: rosObj,
      name: "/collision",
      messageType: "std_msgs/msg/Bool",
    });
    collisionTopic.subscribe((msg) => {
      const wasActive = collisionActiveRef.current;
      if (msg.data && !wasActive) {
        // Rising edge only -- avoid spamming a toast every tick while the
        // robot stays pinned against a wall.
        setShowCollisionToast(true);
        if (collisionToastTimerRef.current) clearTimeout(collisionToastTimerRef.current);
        collisionToastTimerRef.current = setTimeout(() => setShowCollisionToast(false), 2500);
      }
      collisionActiveRef.current = msg.data;
      setCollisionActive(msg.data);
    });

    const jointStatesTopic = new ROSLIB.Topic({
      ros: rosObj,
      name: "/joint_states",
      messageType: "sensor_msgs/msg/JointState",
    });
    jointStatesTopic.subscribe((msg) => {
      const i = msg.name?.indexOf("virtual_wheel_fl") ?? -1;
      if (i >= 0 && Math.abs(msg.position[i] - (steeringRef.current ?? 0)) > 1e-3) {
        steeringRef.current = msg.position[i];
        worldMapRef.current?.markDirty();
      }
    });

    return () => {
      odom.unsubscribe();
      odomRef.current = null;
      effectTopic.unsubscribe();
      collisionTopic.unsubscribe();
      jointStatesTopic.unsubscribe();
    };
  }, [rosObj, noteMovement, setIsWaitingOdom]);

  // Both fetchers take the file explicitly and depend on nothing, so their
  // identity is stable. They used to fall back to activeWorld/activeRobot,
  // which put those in the deps -- that rippled out through handleSwitch into
  // SimSelector, whose mount-only bootstrap effect then re-ran after every
  // launch and reset the robot/world the user had picked.
  const fetchMap = useCallback(async (file) => {
    if (!file) return;
    setMapStatus("loading");
    try {
      const res = await fetch(`${MAP_SERVER_URL}?file=${file}`);
      if (!res.ok) throw new Error(`map server returned ${res.status}`);
      const raw = await res.json();
      setMapName(raw._meta?.mapName ?? raw.name ?? "Unknown");
      setMapData(normaliseMap(raw));
      setMapStatus("ok");
    } catch (err) {
      console.warn(`Could not load world "${file}":`, err.message);
      setMapStatus("error");
    }
  }, [setMapStatus, setMapName, setMapData]);

  useEffect(() => {
    fetchMap(activeWorld);
  }, [fetchMap, activeWorld]);

  const fetchUrdf = useCallback(
    async (file) => {
      if (!file) return;
      try {
        const res = await fetch(`${URDF_SERVER_URL}?file=${file}`);
        if (!res.ok) throw new Error(`urdf server returned ${res.status}`);
        const xml = await res.text();
        setUrdf(parseURDF(xml));
      } catch (err) {
        // Swallowing this used to leave the canvas with no robot at all and no
        // hint why. Clear the model so drawRobot falls back to its placeholder,
        // and say what happened.
        console.warn(`Could not load robot "${file}":`, err.message);
        setUrdf(null);
      }
    },
    [setUrdf],
  );

  useEffect(() => {
    fetchUrdf(activeRobot);
  }, [fetchUrdf, activeRobot]);

  // Setting activeRobot/activeWorld is enough -- the two effects above refetch.
  const handleSwitch = useCallback(
    (robot, world) => {
      setIsWaitingOdom(true);
      poseRef.current = { x: "-", y: "-", theta: "-" };
      steeringRef.current = null;
      setActiveRobot(robot);
      setActiveWorld(world);
      lastPoseRef.current = null;
      markActive();
    },
    [markActive, setIsWaitingOdom, setActiveRobot, setActiveWorld],
  );

  const [winSize, setWinSize] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  });

  useEffect(() => {
    let timeoutId;
    const onResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setWinSize({ w: window.innerWidth, h: window.innerHeight });
      }, 16);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const isNarrow = winSize.w < 900; // stack vertically
  const isShort = winSize.h < 600; // compress padding

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
      gap: "8px",
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
      padding: isNarrow ? "8px" : isShort ? "8px" : "12px", // tighter padding
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      boxShadow: isDark ? "none" : "0 6px 16px rgba(0,0,0,0.04)",
      overflow: "hidden",
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
        {showStatusToast && updateInfo && updateInfo.status !== 'downloading' && updateInfo.status !== 'downloaded' && (
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
              border: `1px solid ${updateInfo.status === "available" ||
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
                    ? `Downloading: ${updateInfo.percent ?? updateInfo.progress ?? 0}%`
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

        {showCollisionToast && (
          <div
            style={{
              position: "fixed",
              top: "60px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              gap: "10px",
              background: isDark ? "#b71c1c" : "#ffebee",
              color: isDark ? "#ffcdd2" : "#c62828",
              border: `1px solid ${isDark ? "#ef5350" : "#ef9a9a"}`,
              padding: "8px 18px",
              borderRadius: "24px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            <span>⚠️ Collision detected</span>
            <button
              onClick={() => setShowCollisionToast(false)}
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

        {idleStopped && (
          <div
            style={{
              position: "fixed",
              top: "60px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              gap: "10px",
              background: isDark ? "#3a2c05" : "#fff8e1",
              color: isDark ? "#ffe082" : "#8d6e00",
              border: `1px solid ${isDark ? "#ffb300" : "#ffe082"}`,
              padding: "8px 18px",
              borderRadius: "24px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            <span>⏸️ Simulation stopped — robot idle for 1 h. Press Launch to resume.</span>
          </div>
        )}

        <UpdateProgressModal
          updateInfo={updateInfo}
          appVersion={appVersion}
          onClose={() => setUpdateInfo(null)}
        />

        <NotificationModal
          notification={notification}
          onClose={() => setNotification(null)}
          isDark={isDark}
        />

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
                  World:{" "}
                  <span style={{ color: isDark ? "#fff" : "#111" }}>
                    {mapStatus === "error"
                      ? (activeWorld || "unknown")
                      : mapName || "Loading..."}
                  </span>
                  {mapStatus === "error" && (
                    <span
                      title="The map server could not load this world"
                      style={{
                        marginLeft: "8px",
                        fontSize: "11px",
                        fontWeight: 700,
                        letterSpacing: "0.5px",
                        color: "#ef5350",
                        border: "1px solid #ef535066",
                        background: "#ef535015",
                        borderRadius: "6px",
                        padding: "2px 7px",
                        verticalAlign: "middle",
                      }}
                    >
                      LOAD FAILED
                    </span>
                  )}
                </div>
                <button
                  onClick={() => {
                    console.log('[ResetPose] rosObj:', rosObj);
                    if (!rosObj) { console.warn('[ResetPose] no rosObj'); return; }
                    const svc = new ROSLIB.Service({
                      ros: rosObj,
                      name: '/reset_pose',
                      serviceType: 'std_srvs/srv/Trigger',
                    });
                    svc.callService(
                      {},
                      (res) => console.log('[ResetPose] OK:', res),
                      (err) => console.error('[ResetPose] Failed:', err)
                    );
                  }}
                  title="Reset robot to origin (0, 0)"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "7px 14px",
                    background: "linear-gradient(135deg, #ef4444, #b91c1c)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: "13px",
                    letterSpacing: "0.5px",
                    boxShadow: "0 2px 8px rgba(239,68,68,0.4)",
                    transition: "all 0.15s ease",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = "scale(1.05)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <path d="M3 3v5h5"/>
                  </svg>
                  Reset Pose
                </button>
              </div>

              <div style={S.mapCanvasWrap} ref={mapWrapRef}>
                <WorldMap
                  ref={worldMapRef}
                  mapData={mapData}
                  poseRef={poseRef}
                  steeringRef={steeringRef}
                  urdf={urdf}
                  width={canvasSize.w}
                  height={canvasSize.h}
                  isDark={isDark}
                  effectActive={effectActive}
                  effectStartTime={effectStartTime}
                  effectEndTime={effectEndTime}
                  collisionActive={collisionActive}
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "0.5px",
                    marginBottom: isNarrow ? "8px" : "16px",
                    color: collisionActive
                      ? (isDark ? "#ef5350" : "#c62828")
                      : (isDark ? "#66bb6a" : "#2e7d32"),
                  }}
                >
                  {collisionActive ? "⚠️ Collision: DETECTED" : "✅ Collision: OK"}
                </div>
                <PoseReadout poseRef={poseRef} isDark={isDark} />
              </div>

              <SimSelector
                ref={simSelectorRef}
                onSwitch={handleSwitch}
                onStop={() => setIsWaitingOdom(false)}
                isDark={isDark}
                isWaitingOdom={isWaitingOdom}
              />

              <KeyboardController ros={rosObj} isDark={isDark} isNarrow={isNarrow} isShort={isShort} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
