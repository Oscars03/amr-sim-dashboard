import useAppStore from '../../store/useAppStore';
import React, {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useNavigate } from "react-router-dom";
import * as ROSLIB from "roslib";
import UpdateProgressModal from '../ui/UpdateProgressModal';
import ShortcutModal from '../ui/ShortcutModal';
import CommandPalette from '../ui/CommandPalette';
import CoachTour from '../ui/CoachTour';

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

import { parseURDF, drawRobot, normaliseMap, buildTransform, easePose } from '../../utils/robot';
import { makeFrameGate } from '../../utils/frameGate';

// Pan that reproduces the current follow view, for handing over when follow is
// released. Pass the same eased pose the follow camera draws from (not the raw
// /odom pose) so the view doesn't jump at the moment the user grabs it.
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
const WorldMap = React.memo(forwardRef(function WorldMap({ mapData, poseRef, steeringRef, urdf, width = 560, height = 560, isDark, effectActive, effectStartTime, effectEndTime, collisionActive, onFollowChange, onFpsSample }, ref) {
  const canvasRef = useRef(null);
  const drawRef = useRef(null);
  const fpsLimit = useAppStore((s) => s.fpsLimit);

  const needsRedrawRef = useRef(true);
  const effectActiveRef = useRef(effectActive);
  const collisionActiveRef = useRef(collisionActive);

  const [view, setView] = useState({ zoom: 1, rotation: 0, panX: 0, panY: 0 });
  const [followRobot, setFollowRobot] = useState(false);
  // Robot pose actually drawn: eased toward the 20 Hz /odom sample once per
  // frame (easePose) so a 60 fps canvas doesn't step the robot at 20 Hz. World
  // space -- zoom/pan/resize don't disturb it -- and shared by the robot marker
  // and the follow camera so the two never disagree. Null = no sample yet.
  const renderPoseRef = useRef(null);
  const lastDrawTsRef = useRef(0);

  // Single source of truth for the toolbar's highlight.
  //
  // The button used to flip its own boolean alongside calling toggleFollow(),
  // so anything that turned follow off in here -- resetView, a middle-drag pan --
  // left the button still lit while the camera had stopped following. Report the
  // real state instead of asking the caller to mirror it.
  useEffect(() => {
    onFollowChange?.(followRobot);
  }, [followRobot, onFollowChange]);

  // /odom (20 Hz) and /joint_states write their refs and call this instead of
  // setting React state, so a moving robot never reconciles the view tree.
  useImperativeHandle(ref, () => ({
    markDirty: () => { needsRedrawRef.current = true; },
    resetView: () => {
      setFollowRobot(false);
      setView({ zoom: 1, rotation: 0, panX: 0, panY: 0 });
    },
    // Zoom and rotate leave follow alone. The follow branch of draw() applies
    // view.zoom and view.rotation itself, so there is nothing to conflict with,
    // and the scroll wheel never cancelled follow -- so the toolbar buttons and
    // the wheel used to disagree about what zooming means. Only panning
    // genuinely conflicts, because follow owns the translation.
    zoomIn: () => {
      setView((v) => ({ ...v, zoom: Math.min(v.zoom * 1.25, 10) }));
    },
    zoomOut: () => {
      setView((v) => ({ ...v, zoom: Math.max(v.zoom / 1.25, 0.1) }));
    },
    rotateLeft: () => {
      setView((v) => ({ ...v, rotation: v.rotation - Math.PI / 12 }));
    },
    rotateRight: () => {
      setView((v) => ({ ...v, rotation: v.rotation + Math.PI / 12 }));
    },
    toggleFollow: () => {
      setFollowRobot((f) => !f);
    },
  }), []);

  const fpsCounterRef = useRef({ frames: 0, t0: 0 });

  // One rAF loop for every mode, paced against the frame clock.
  //
  // The capped modes used setInterval(1000/fps): unaligned with vsync, so a
  // callback that missed a boundary showed up on the next one and frame spacing
  // alternated 16.7/33.3 ms -- judder that reads as a slow simulator.
  // requestAnimationFrame is already vsync-aligned; makeFrameGate() decides
  // which ticks to draw on. Its pacing (2 ms slack, overshoot carried rather
  // than snapped to now) is what stops a "20" cap reading 14 and a "60" reading
  // 48 -- see frameGate.js.
  useEffect(() => {
    let frame;
    const shouldDraw = makeFrameGate(fpsLimit);
    const loop = (now) => {
      frame = requestAnimationFrame(loop);
      if (!shouldDraw(now)) return;
      // Only the 20 fps mode skips idle frames; 60 and unlimited redraw every
      // tick, which is what makes motion smooth at the cost of CPU.
      const lowPowerMode = fpsLimit === 20;
      if (lowPowerMode && !needsRedrawRef.current && !effectActiveRef.current && !collisionActiveRef.current) return;
      needsRedrawRef.current = false;
      if (drawRef.current) drawRef.current();
      fpsCounterRef.current.frames += 1;
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [fpsLimit]);

  // Measured draw rate, so the readout reports what is happening rather than
  // what was asked for. Sampled once a second off the same counter the loop
  // increments; a ref plus one setState per second keeps it off the draw path.
  const [measuredFps, setMeasuredFps] = useState(0);
  useEffect(() => {
    fpsCounterRef.current.t0 = performance.now();
    const iv = setInterval(() => {
      const c = fpsCounterRef.current;
      const now = performance.now();
      const dt = (now - c.t0) / 1000;
      if (dt > 0) setMeasuredFps(Math.round(c.frames / dt));
      c.frames = 0;
      c.t0 = now;
    }, 1000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => { onFpsSample?.(measuredFps); }, [measuredFps, onFpsSample]);

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
      // Chromium starts its autoscroll widget on a middle press unless the
      // event is cancelled, which fights the pan drag.
      e.preventDefault();
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
        const { panX, panY } = getFollowPan(renderPoseRef.current, mapData, width, height, view);
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


  // Assigned in an effect, not during render: the frame loop only ever reads
  // drawRef.current, so it is enough that this lands before the next tick.
  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pose = poseRef.current;
    const steeringAngle = steeringRef.current;
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

    // Ease the drawn robot pose toward the latest /odom sample once per frame,
    // so a 60 fps canvas doesn't render a 20 Hz robot in steps (a smooth map
    // with a stuttering robot). Shared by the marker and the follow camera so
    // the two stay in sync.
    let render = null;
    if (pose && pose.x !== "-") {
      const nowTs = performance.now();
      const dtMs = lastDrawTsRef.current ? nowTs - lastDrawTsRef.current : NaN;
      lastDrawTsRef.current = nowTs;
      const tx = typeof pose.x === "string" ? parseFloat(pose.x) : pose.x;
      const ty = typeof pose.y === "string" ? parseFloat(pose.y) : pose.y;
      const tth = ((typeof pose.theta === "string" ? parseFloat(pose.theta) : pose.theta) * Math.PI) / 180;
      render = easePose(renderPoseRef.current, { x: tx, y: ty, th: tth }, dtMs);
      renderPoseRef.current = render;
      // The 20 fps low-power loop only draws on a dirty frame, but easing needs a
      // few frames to catch up after the last pose change -- keep it awake until
      // the marker has actually settled, or it stops a pixel short.
      const dth = Math.atan2(Math.sin(tth - render.th), Math.cos(tth - render.th));
      if (Math.hypot(tx - render.x, ty - render.y) > 2e-3 || Math.abs(dth) > 2e-3) {
        needsRedrawRef.current = true;
      }
    } else {
      renderPoseRef.current = null;
      lastDrawTsRef.current = 0;
    }

    ctx.save();
    if (followRobot && render) {
      // Camera centres on the eased pose -- no separate smoothing, easePose
      // already did it (and its snap-on-teleport covers /reset_pose between runs).
      const rx = width - offsetX - (render.y - origin_y) * scale;
      const ry = height - offsetY - (render.x - origin_x) * scale;
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

    if (render) {
      const worldX = render.x;
      const worldY = render.y;
      const thetaRad = render.th;
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
  };

  // No dep array: `draw` closes over view/followRobot/mapData/..., so the loop
  // must always be handed the newest one.
  useEffect(() => {
    drawRef.current = draw;
  });

  // Repaint synchronously when the canvas is resized. Changing a canvas'
  // width/height attribute wipes its bitmap to transparent; without an
  // immediate redraw the wrapper's dark background shows through for up to
  // one frame-interval, which reads as a black flash while the inspector
  // slides open/closed. A layout effect runs before the browser paints.
  useLayoutEffect(() => {
    drawRef.current = draw;
    drawRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

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
          // matches the draw()'s bgFill -- if the bitmap is ever momentarily
          // cleared (canvas resize), this shows instead of the dark wrapper.
          background: isDark ? "#d3d3d3" : "#222222",
        }}
      />
    </div>
  );
}));

const ArrowSvg = ({ angle = 0 }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${angle}deg)` }}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
// Stop key: square (not a filled circle)
const StopSquareSvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <rect x="4" y="4" width="16" height="16" rx="3" />
  </svg>
);

// ─── SparkLine ────────────────────────────────────────────────────────────────
// 10-second ring buffer sampled from poseRef at 150ms. Pure SVG polyline.
// UI-only — does NOT add ROS topics. Zero React state churn (uses ref + RAF).
const SPARK_PTS = 60; // 60 × 150ms = 9s window
function SparkLine({ poseRef, field, isAngle, color = '#22d3ee', height = 32 }) {
  const svgRef = useRef(null);
  const buf = useRef(Array(SPARK_PTS).fill(null));
  const prev = useRef(null);

  useEffect(() => {
    let frame;
    const tick = () => {
      const p = poseRef.current;
      if (p !== prev.current) {
        prev.current = p;
        let raw = p?.[field];
        if (typeof raw === 'number') {
          if (isAngle) raw = raw * 180 / Math.PI; // convert to degrees for display
          buf.current.push(raw);
          if (buf.current.length > SPARK_PTS) buf.current.shift();
        }
      }
      const pts = buf.current.filter(v => v !== null);
      if (pts.length >= 2 && svgRef.current) {
        const mn = Math.min(...pts), mx = Math.max(...pts);
        const range = mx - mn || 1;
        const w = svgRef.current.clientWidth || 260;
        const h = height;
        const points = pts.map((v, i) => {
          const x = (i / (SPARK_PTS - 1)) * w;
          const y = h - ((v - mn) / range) * (h - 4) - 2;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        const poly = svgRef.current.querySelector('polyline');
        if (poly) poly.setAttribute('points', points);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [poseRef, field, isAngle, height]);

  return (
    <svg ref={svgRef} width="100%" height={height} style={{ display: 'block', overflow: 'visible' }}>
      <polyline points="" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// KeyboardController
// ─────────────────────────────────────────────────────────────────────────────
// isShort defaults on: this only ever renders inside the ~300px inspector, which
// is always tight. Pass isShort={false} to get the roomy layout back.
function KeyboardController({ ros, isDark, isShort = true }) {
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
    const typingInField = () => {
      const t = document.activeElement?.tagName?.toLowerCase();
      return t === "input" || t === "textarea" || t === "select";
    };
    const handleKeyDown = (e) => {
      if (!webControl || typingInField()) return;

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
      if (typingInField()) return;
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
      opacity: webControl ? 1 : 0.6,
      transition: "opacity 0.3s",
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box",
      flexShrink: 0,
      overflow: "hidden",
    },
    toggleWrap: {
      display: "flex",
      alignItems: "center",
      background: isDark ? "#161c25" : "#f1f5f9",
      borderRadius: "20px",
      padding: "4px",
      cursor: "pointer",
      border: `1px solid ${isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)"}`,
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
      color: active ? color : isDark ? "#94a3b8" : "#475569",
      background: active ? `${color}20` : "transparent",
      border: active ? `1px solid ${color}` : "1px solid transparent",
      transition: "all 0.2s ease-in-out",
    }),
    controlBody: {
      // Column-only: this always lives in the ~300px inspector now, so the
      // dpad and the slider panel stack instead of overflowing side by side.
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: isShort ? "12px" : "20px",
      minWidth: 0,
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
        ? `2px solid ${isDark ? "#22d3ee" : "#0284c7"}`
        : `1.5px solid ${isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.15)"}`,
      background: active
        ? isDark
          ? "rgba(34, 211, 238, 0.25)"
          : "#e0f2fe"
        : isDark
          ? "#161c25"
          : "#ffffff",
      color: active
        ? isDark
          ? "#ffffff"
          : "#0284c7"
        : isDark
          ? "#ffffff"
          : "#0f172a",
      fontSize: "18px",
      fontWeight: 700,
      cursor: "pointer",
      userSelect: "none",
      boxShadow: active ? "0 0 12px rgba(34,211,238,0.4), inset 0 0 8px rgba(34,211,238,0.15)" : "none",
      transform: active ? "scale(0.96)" : "scale(1)",
      transition: "transform 0.1s ease, box-shadow 0.15s ease, border 0.1s ease",
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
      color: isDark ? "#ffffff" : "#0f172a",
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
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px',
        marginBottom: isShort ? '10px' : '14px',
      }}>
        {/* Watchdog toggle */}
        <div
          title={watchdogEnabled ? 'Watchdog ON — click to disable' : 'Watchdog OFF — click to enable'}
          onClick={() => toggleWatchdog(!watchdogEnabled)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '6px 12px', borderRadius: '20px', cursor: 'pointer',
            fontSize: '12px', fontWeight: 700, letterSpacing: '0.4px',
            userSelect: 'none', transition: 'all 0.2s', height: '28px',
            background: watchdogEnabled ? '#00e67625' : (isDark ? '#ffffff0d' : '#e0e0e0'),
            color: watchdogEnabled ? '#00e676' : 'var(--c-text-2)',
          }}
        >
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: watchdogEnabled ? '#00e676' : (isDark ? '#64748b' : '#94a3b8'),
            boxShadow: watchdogEnabled ? '0 0 6px #00e676' : 'none',
            transition: 'all 0.2s',
          }} />
          WATCHDOG <span style={{ fontWeight: 800 }}>{watchdogEnabled ? 'ON' : 'OFF'}</span>
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

      <div style={S.controlBody}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: isShort ? '8px' : '16px' }}>
          {/* Holonomic — animated ON/OFF switch */}
          <div
            onClick={() => { if (!webControl) return; setIsHolonomic(!isHolonomic); }}
            title={!webControl ? "Enable UI control first" : "Toggle Holonomic Mode"}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              fontSize: '12px', fontWeight: 800, letterSpacing: '0.4px',
              userSelect: 'none', cursor: webControl ? 'pointer' : 'not-allowed',
              opacity: webControl ? 1 : 0.5,
            }}
          >
            <span style={{ color: isHolonomic ? '#00e676' : 'var(--c-text-2)' }}>
              HOLONOMIC
            </span>
            {/* Track */}
            <div style={{
              width: 36, height: 20, borderRadius: 10, position: 'relative',
              background: isHolonomic ? '#00e676' : (isDark ? '#334155' : '#cbd5e1'),
              border: `1px solid ${isHolonomic ? '#00e676' : (isDark ? '#475569' : '#94a3b8')}`,
              transition: 'background 0.22s ease, border-color 0.22s ease',
              boxShadow: isHolonomic ? '0 0 8px #00e67655' : 'none',
              flexShrink: 0,
            }}>
              {/* Thumb */}
              <div style={{
                position: 'absolute', top: 2, left: isHolonomic ? 18 : 2,
                width: 14, height: 14, borderRadius: '50%',
                background: '#fff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                transition: 'left 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
              }} />
            </div>
            <span style={{ color: isHolonomic ? '#00e676' : 'var(--c-text-2)', fontWeight: 700 }}>
              {isHolonomic ? 'ON' : 'OFF'}
            </span>
          </div>

          <div style={S.dpad}>
            {renderVKey("u", <ArrowSvg angle={-45} />)}
            {renderVKey("i", <ArrowSvg angle={0} />)}
            {renderVKey("o", <ArrowSvg angle={45} />)}
            {renderVKey("j", <ArrowSvg angle={-90} />)}
            {renderVKey("k", <StopSquareSvg />)}
            {renderVKey("l", <ArrowSvg angle={90} />)}
            {renderVKey("m", <ArrowSvg angle={-135} />)}
            {renderVKey(",", <ArrowSvg angle={180} />)}
            {renderVKey(".", <ArrowSvg angle={135} />)}
          </div>
        </div>

        {/* Movement Scale */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: isShort ? '8px' : '10px',
          alignSelf: 'stretch', width: '100%', minWidth: 0, boxSizing: 'border-box',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--c-text-2)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Movement Scale
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <span style={{ width: '40px', flexShrink: 0, fontSize: '13px', fontWeight: 600, color: 'var(--c-text-2)' }}>Speed</span>
            <button
              title="Decrease Speed (X)"
              onClick={() => webControl && setSpeed(Math.max(0.1, speed - 0.1))}
              style={{ width: '28px', height: '28px', flexShrink: 0, borderRadius: '6px', border: 'none', background: isDark ? '#333' : '#e0e0e0', color: isDark ? '#fff' : '#000', cursor: webControl ? 'pointer' : 'not-allowed', position: 'relative' }}>
              −<span style={{ position: 'absolute', top: '2px', left: '2px', fontSize: '8px', opacity: 0.5 }}>X</span>
            </button>
            <input
              type="range" className="tele-slider" min="0.1" max="2.0" step="0.1"
              value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))}
              style={{ ...S.slider(speed, 0.1, 2.0, isDark ? "#85B7EB" : "#1a3a8f"), flex: 1, minWidth: 0 }}
              disabled={!webControl}
            />
            <button
              title="Increase Speed (W)"
              onClick={() => webControl && setSpeed(Math.min(2.0, speed + 0.1))}
              style={{ width: '28px', height: '28px', flexShrink: 0, borderRadius: '6px', border: 'none', background: isDark ? '#333' : '#e0e0e0', color: isDark ? '#fff' : '#000', cursor: webControl ? 'pointer' : 'not-allowed', position: 'relative' }}>
              +<span style={{ position: 'absolute', top: '2px', right: '2px', fontSize: '8px', opacity: 0.5 }}>W</span>
            </button>
            <span style={{ width: '38px', flexShrink: 0, textAlign: 'right', fontSize: '14px', fontWeight: 700, color: 'var(--c-text-1)' }}>{speed.toFixed(2)}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <span style={{ width: '40px', flexShrink: 0, fontSize: '13px', fontWeight: 600, color: 'var(--c-text-2)' }}>Angle</span>
            <button
              title="Decrease Angle (C)"
              onClick={() => webControl && setTurnSpeed(Math.max(0.1, turnSpeed - 0.1))}
              style={{ width: '28px', height: '28px', flexShrink: 0, borderRadius: '6px', border: 'none', background: isDark ? '#333' : '#e0e0e0', color: isDark ? '#fff' : '#000', cursor: webControl ? 'pointer' : 'not-allowed', position: 'relative' }}>
              −<span style={{ position: 'absolute', top: '2px', left: '2px', fontSize: '8px', opacity: 0.5 }}>C</span>
            </button>
            <input
              type="range" className="tele-slider" min="0.1" max="3.0" step="0.1"
              value={turnSpeed} onChange={(e) => setTurnSpeed(parseFloat(e.target.value))}
              style={{ ...S.slider(turnSpeed, 0.1, 3.0, isDark ? "#85B7EB" : "#1a3a8f"), flex: 1, minWidth: 0 }}
              disabled={!webControl}
            />
            <button
              title="Increase Angle (E)"
              onClick={() => webControl && setTurnSpeed(Math.min(3.0, turnSpeed + 0.1))}
              style={{ width: '28px', height: '28px', flexShrink: 0, borderRadius: '6px', border: 'none', background: isDark ? '#333' : '#e0e0e0', color: isDark ? '#fff' : '#000', cursor: webControl ? 'pointer' : 'not-allowed', position: 'relative' }}>
              +<span style={{ position: 'absolute', top: '2px', right: '2px', fontSize: '8px', opacity: 0.5 }}>E</span>
            </button>
            <span style={{ width: '38px', flexShrink: 0, textAlign: 'right', fontSize: '14px', fontWeight: 700, color: 'var(--c-text-1)' }}>{turnSpeed.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* /cmd_vel live command */}
      <div style={{
        marginTop: isShort ? '8px' : '12px',
        display: 'flex', justifyContent: 'center', gap: '22px',
        background: 'var(--c-panel-2)', borderRadius: 'var(--r-md)', padding: '8px 14px',
        fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700,
        color: 'var(--c-text-3)',
      }}>
        <span>X <span style={{ color: 'var(--c-text-1)' }}>
          {keys["i"] && webControl ? speed.toFixed(2) : keys[","] && webControl ? (-speed).toFixed(2) : "0.00"}
        </span></span>
        <span>Z <span style={{ color: 'var(--c-text-1)' }}>
          {keys["j"] && webControl ? turnSpeed.toFixed(2) : keys["l"] && webControl ? (-turnSpeed).toFixed(2) : "0.00"}
        </span></span>
      </div>

      <button
        title="Trigger Mission Actuator"
        onClick={triggerActuator}
        style={{
          width: '100%', boxSizing: 'border-box',
          marginTop: isShort ? '8px' : '12px',
          padding: isShort ? '8px 12px' : '12px',
          background: isDark ? '#2e7d32' : '#4caf50',
          color: '#fff', border: 'none', borderRadius: '8px',
          fontWeight: 700, cursor: 'pointer', letterSpacing: '1px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          boxShadow: isDark ? '0 0 10px #4caf5033' : '0 4px 6px rgba(0,0,0,0.1)',
          transition: 'all 0.2s',
        }}
        onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.15)'}
        onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
        onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
        onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        ACTUATE EFFECT
      </button>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// CustomDropdown  — defined OUTSIDE SimSelector so it never remounts
// ─────────────────────────────────────────────────────────────────────────────
function CustomDropdown({ label, value, onChange, options, onDelete, isDark, align = "left" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const accent = isDark ? "var(--c-accent)" : "var(--c-accent)";
  const border = isDark ? "rgba(255, 255, 255, 0.16)" : "rgba(0, 0, 0, 0.15)";
  const inputBg = isDark ? "#161c25" : "#f8fafc";
  const textSub = isDark ? "#cbd5e1" : "#475569";
  const textMain = isDark ? "#ffffff" : "#0f172a";

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
          fontSize: "12px",
          fontWeight: 700,
          color: textSub,
          textTransform: "uppercase",
          letterSpacing: "0.4px",
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
            background: open ? (isDark ? "#1e2633" : "#f0f9ff") : inputBg,
            border: `1.5px solid ${open ? accent : border}`,
            boxShadow: open ? `0 0 0 3px ${accent}33` : "none",
            // Stays fully rounded when open. The panel is no longer the same
            // width as the trigger, so squaring these corners to "join" it left
            // a seam that only drew attention to the mismatch.
            borderRadius: "10px",
            color: textMain,
            fontSize: "14px",
            fontWeight: 700,
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
              // Anchored on one edge, not both. `left: 0; right: 0` locked the
              // panel to the trigger's width, and the trigger is half a narrow
              // sidebar column -- so "Square Room" and "amr_lite" arrived as
              // "Squar..." and "amr...". A dropdown panel is allowed to be wider
              // than the control that opens it.
              //
              // Which edge is anchored decides which way it grows: the Robot
              // column is on the left so it grows right, the World column is on
              // the right so it grows left. Growing the wrong way just moves the
              // clipping to the sidebar edge.
              ...(align === "right" ? { right: 0, left: "auto" } : { left: 0, right: "auto" }),
              minWidth: "100%",
              width: "max-content",
              maxWidth: "min(320px, 90vw)",
              background: isDark ? "#161c25" : "#ffffff",
              border: `1.5px solid ${accent}`,
              // A complete rounded card offset from the trigger, rather than a
              // bottom-half glued to it. Once the panel can be wider than the
              // trigger the glued look cannot line up on both edges, and a seam
              // that nearly meets reads as a bug; a floating menu reads as
              // intended. The shadow does the work of showing it is above.
              borderRadius: "10px",
              marginTop: "6px",
              boxShadow: isDark
                ? "0 12px 30px rgba(0,0,0,0.7)"
                : "0 12px 30px rgba(0,0,0,0.15)",
              zIndex: 9999,
              maxHeight: "200px",
              overflowY: "auto",
              scrollbarWidth: "thin",
              scrollbarColor: `${isDark ? "#334155" : "#cbd5e1"} transparent`,
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
                      fontWeight: isSelected ? 700 : 600,
                      color: isSelected ? accent : textMain,
                      background: isSelected
                        ? isDark
                          ? "rgba(34, 211, 238, 0.15)"
                          : "rgba(2, 132, 199, 0.12)"
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
                          ? "#1e2633"
                          : "#f1f5f9";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = "transparent";
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
                      {/* title so a name past the 320px cap is still readable
                          on hover rather than only ever "Squar...". */}
                      <span
                        title={opt.label}
                        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
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
                          color: isDark ? "#f87171" : "#dc2626",
                          cursor: "pointer",
                          padding: "2px 4px",
                          borderRadius: "4px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: 0.8,
                          transition: "opacity 0.2s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.8")}
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
  { onSwitch, onStop, isDark, isWaitingOdom, poseRef },
  ref,
) {
  const [robotList, setRobotList] = useState([]);
  const [worldList, setWorldList] = useState([]);
  const [selRobot, setSelRobot] = useState("");
  const [selWorld, setSelWorld] = useState("");
  const [simStatus, setSimStatus] = useState(null);
  const { spawnPose, setSpawnPose } = useAppStore();

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
    async (robot, world, customSpawn) => {
      if (!robot || !world) return;
      const { envData, setShowEnvModal, spawnPose: storeSpawn } = useAppStore.getState();
      if (envData && !envData.allReady) {
        setShowEnvModal(true);
        return;
      }
      const targetSpawn = customSpawn ?? storeSpawn ?? { x: 0, y: 0, yaw: 0 };
      setSwitching(true);
      setSwitchError("");
      try {
        const res = await fetch(SWITCH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ robot, world, spawnPose: targetSpawn }),
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

  const border = "var(--c-border)";

  return (
    <div
      style={{
        overflow: "visible",
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          padding: "0 0 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--c-text-2)" }}>
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
          padding: "12px 0 0",
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
          // World sits in the right-hand column, so its panel grows leftward;
          // anchored on the left it would widen off the edge of the sidebar.
          align="right"
          options={worldList.map((w) => ({
            value: w.name,
            label: w.mapName || w.name.replace(/\.json$/i, ""),
          }))}
        />
      </div>

      {/* ── Spawn Pose Config ── */}
      <div
        style={{
          // Pushed down and given room to breathe: the sidebar is tall and
          // mostly empty below this, so the space is free and the block was
          // crowding the dropdowns above it.
          padding: "18px 0 14px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: "12px",
              fontWeight: 800,
              color: isDark ? "#ffffff" : "#0f172a",
              textTransform: "uppercase",
              letterSpacing: "0.4px",
            }}
          >
            Spawn Pose (Initial)
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => {
                if (poseRef?.current) {
                  const p = poseRef.current;
                  const x = typeof p.x === "number" ? parseFloat(p.x.toFixed(2)) : 0;
                  const y = typeof p.y === "number" ? parseFloat(p.y.toFixed(2)) : 0;
                  const yaw = typeof p.theta === "number" ? parseFloat((p.theta * 180 / Math.PI).toFixed(1)) : 0;
                  setSpawnPose({ x, y, yaw });
                }
              }}
              title="Use current live pose of the robot"
              style={{
                background: "transparent", border: "none",
                color: "var(--c-text-2)", fontSize: "12px", fontWeight: 700,
                cursor: "pointer", padding: "2px 4px", borderRadius: "4px",
                display: "flex", alignItems: "center", gap: "4px",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" /><line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
              </svg>
              Use Current
            </button>
          </div>
        </div>

        <div
          style={{
            // One field per row. Squeezed onto a single line the three inputs
            // were narrow enough that a two-decimal value crowded its unit, and
            // the sidebar has vertical space going unused below this block.
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: "8px",
          }}
        >
          {/* X Input */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: isDark ? "#161c25" : "#f8fafc",
              border: `1.5px solid ${isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.15)"}`,
              borderRadius: "8px",
              padding: "6px 8px",
              gap: "4px",
            }}
          >
            <span
              style={{
                fontSize: "13px",
                fontWeight: 800,
                color: "var(--c-accent)",
              }}
            >
              X:
            </span>
            <input
              type="number"
              step="0.1"
              value={spawnPose?.x ?? 0}
              onChange={(e) =>
                setSpawnPose({ ...spawnPose, x: parseFloat(e.target.value) || 0 })
              }
              className="num-bare"
              style={{
                width: "100%",
                minWidth: 0,
                background: "transparent",
                border: "none",
                color: isDark ? "#ffffff" : "#0f172a",
                fontSize: "15px",
                fontWeight: 700,
                outline: "none",
              }}
              placeholder="0.0"
            />
            <span style={{ fontSize: "12px", fontWeight: 700, color: isDark ? "#cbd5e1" : "#475569" }}>m</span>
          </div>

          {/* Y Input */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: isDark ? "#161c25" : "#f8fafc",
              border: `1.5px solid ${isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.15)"}`,
              borderRadius: "8px",
              padding: "6px 8px",
              gap: "4px",
            }}
          >
            <span
              style={{
                fontSize: "13px",
                fontWeight: 800,
                color: "var(--c-accent)",
              }}
            >
              Y:
            </span>
            <input
              type="number"
              step="0.1"
              value={spawnPose?.y ?? 0}
              onChange={(e) =>
                setSpawnPose({ ...spawnPose, y: parseFloat(e.target.value) || 0 })
              }
              className="num-bare"
              style={{
                width: "100%",
                minWidth: 0,
                background: "transparent",
                border: "none",
                color: isDark ? "#ffffff" : "#0f172a",
                fontSize: "15px",
                fontWeight: 700,
                outline: "none",
              }}
              placeholder="0.0"
            />
            <span style={{ fontSize: "12px", fontWeight: 700, color: isDark ? "#cbd5e1" : "#475569" }}>m</span>
          </div>

          {/* Yaw Input — third column, alongside X and Y */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: isDark ? "#161c25" : "#f8fafc",
              border: `1.5px solid ${isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.15)"}`,
              borderRadius: "8px",
              padding: "6px 8px",
              gap: "4px",
            }}
          >
            <span
              style={{
                fontSize: "13px",
                fontWeight: 800,
                color: "var(--c-accent)",
              }}
            >
              Yaw:
            </span>
            <input
              type="number"
              step="5"
              value={spawnPose?.yaw ?? 0}
              onChange={(e) =>
                setSpawnPose({ ...spawnPose, yaw: parseFloat(e.target.value) || 0 })
              }
              className="num-bare"
              style={{
                width: "100%",
                minWidth: 0,
                background: "transparent",
                border: "none",
                color: isDark ? "#ffffff" : "#0f172a",
                fontSize: "15px",
                fontWeight: 700,
                outline: "none",
              }}
              placeholder="0"
            />
            <span style={{ fontSize: "12px", fontWeight: 700, color: isDark ? "#cbd5e1" : "#475569" }}>°</span>
          </div>
        </div>

        {/* Reset sits under the fields it clears, right-aligned so it lands
            below Yaw. It was next to "Use Current" in the header, where the two
            read as a pair despite doing opposite things. */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => setSpawnPose({ x: 0, y: 0, yaw: 0 })}
            title="Reset spawn coordinates to (0, 0, 0°)"
            style={{
              background: "transparent", border: "none",
              color: "var(--c-accent)", fontSize: "12px", fontWeight: 700,
              cursor: "pointer", padding: "2px 4px", borderRadius: "4px",
              display: "flex", alignItems: "center", gap: "4px",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
            </svg>
            Reset
          </button>
        </div>
      </div>

      {/* ── Buttons ── */}
      <div style={{ padding: "0 0 16px", display: "flex", gap: "10px" }}>
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
          title={displayStatus === "idle" || displayStatus === "stopping" ? "Not running" : "Stop simulation"}
          style={{
            padding: "10px 18px",
            borderRadius: "10px",
            border: "none",
            background: isDark ? "#3a0a0a" : "#ffebee",
            color: isDark ? "#ef9a9a" : "#c62828",
            fontSize: "14px",
            fontWeight: 700,
            cursor: (displayStatus === "idle" || displayStatus === "stopping") ? "not-allowed" : "pointer",
            opacity: (displayStatus === "idle" || displayStatus === "stopping") ? 0.4 : 1,
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
            padding: "0 0 14px",
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
      display: "flex",
      flexDirection: "column",
      gap: "10px",
    },
    title: {
      fontSize: "12px",
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.4px",
      color: "var(--c-text-2)",
      fontFamily: "var(--font-ui)",
    },
    select: {
      width: "100%",
      boxSizing: "border-box",
      padding: "8px 10px",
      borderRadius: "var(--r-md)",
      background: "var(--c-panel-2)",
      color: "var(--c-text-1)",
      border: "1px solid var(--c-border)",
      fontSize: "14px",
      outline: "none",
      cursor: "pointer",
      fontWeight: 600,
      colorScheme: isDark ? "dark" : "light",
    },
    dataBox: {
      height: "240px",
      overflowY: "auto",
      padding: "10px",
      background: "var(--c-panel-2)",
      border: "1px solid var(--c-border)",
      borderRadius: "var(--r-md)",
      fontSize: "13px",
      lineHeight: 1.5,
      fontFamily: "var(--font-mono)",
      color: "var(--c-text-1)",
    },
  };

  return (
    <div style={S.wrap}>
      <div style={S.title}>Topic Monitor</div>
      <select
        style={S.select}
        value={selTopic}
        onChange={(e) => {
          setMsgData(null);
          setSelTopic(e.target.value);
        }}
      >
        <option value="" style={{ background: isDark ? "#1a1a1a" : "#ffffff", color: isDark ? "#e0e0e0" : "#333" }}>
          -- Select a topic --
        </option>
        {(() => {
          // Group topics by type-prefix for cleaner optgroups
          const groups = { cmd: [], odom: [], sensor: [], map: [], other: [] };
          topics.forEach(t => {
            const n = t.name;
            if (n.startsWith('/cmd')) groups.cmd.push(t);
            else if (n.startsWith('/odom') || n.includes('odom')) groups.odom.push(t);
            else if (n.startsWith('/scan') || n.startsWith('/laser') || n.startsWith('/imu') || n.startsWith('/sensor')) groups.sensor.push(t);
            else if (n.startsWith('/map') || n.startsWith('/cost')) groups.map.push(t);
            else groups.other.push(t);
          });
          const optStyle = { background: isDark ? "#1a1a1a" : "#ffffff", color: isDark ? "#e0e0e0" : "#333" };
          const renderOpts = list => list.map(t => (
            <option key={t.name} value={t.name} style={optStyle}>{t.name}</option>
          ));
          return Object.entries({ 'cmd': groups.cmd, 'odom/pose': groups.odom, 'sensor': groups.sensor, 'map': groups.map, 'other': groups.other })
            .filter(([, list]) => list.length > 0)
            .map(([label, list]) => (
              <optgroup key={label} label={label.toUpperCase()}>
                {renderOpts(list)}
              </optgroup>
            ));
        })()}
      </select>
      <div style={S.dataBox}>
        {selTopic ? (
          msgData !== null ? (
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {JSON.stringify(msgData, null, 2)}
            </pre>
          ) : (
            "Waiting for data..."
          )
        ) : (
          /* Empty state — centered SVG + helper text */
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100%', gap: 10, userSelect: 'none',
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={isDark ? "#334155" : "#cbd5e1"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 16 12 13 15 11 15 8 12 2 12" />
              <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#475569' : '#94a3b8' }}>
              No topic selected
            </span>
            <span style={{ fontSize: 11, color: isDark ? '#334155' : '#cbd5e1', textAlign: 'center', lineHeight: 1.4 }}>
              Pick a topic above to<br />inspect messages.
            </span>
          </div>
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
// ─────────────────────────────────────────────────────────────────────────────
// PoseSingle — single-field readout used in inspector tabs
// ─────────────────────────────────────────────────────────────────────────────
const PoseSingle = React.memo(function PoseSingle({ poseRef, field, unit, isAngle, compact }) {
  const [val, setVal] = React.useState(null);
  React.useEffect(() => {
    let prev = null;
    const iv = setInterval(() => {
      if (poseRef.current !== prev) { prev = poseRef.current; setVal(prev); }
    }, 150);
    return () => clearInterval(iv);
  }, [poseRef]);
  const raw = val?.[field];
  const fmt = typeof raw === 'number' ? (isAngle ? raw.toFixed(1) : raw.toFixed(2)) : '-';
  const disp = typeof raw === 'number' && isAngle ? `${fmt}°` : fmt;
  if (compact) return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--c-accent)' }}>{field.toUpperCase()} <strong style={{ fontWeight: 800 }}>{disp}</strong>{unit !== '°' && !isAngle ? unit : ''}</span>
  );
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 800, color: 'var(--c-accent)' }}>{disp}<span style={{ fontSize: 13, marginLeft: 4, color: 'var(--c-text-2)', fontWeight: 600 }}>{isAngle ? '' : unit}</span></span>
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
    isDark,
    setIsDark,
    isWaitingOdom,
    setIsWaitingOdom,
  } = useAppStore();
  const simSelectorRef = useRef(null);
  const [appVersion, setAppVersion] = useState("0.0.0");
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showStatusToast, setShowStatusToast] = useState(false);
  const [isFollowingRobot, setIsFollowingRobot] = useState(false);
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
        }, 40);
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

  const inspectorCollapsed = winSize.w < 1280;

  // RTF ref for status bar — updated at 1 Hz inside WorldMap, lifted via callback
  const rtfRef = useRef('1.00');
  const [statusRtf, setStatusRtf] = useState('1.00');
  // Frames actually drawn per second, reported by WorldMap. The readout used
  // to show only the requested cap, which said nothing about whether the
  // renderer was keeping up.
  const [actualFps, setActualFps] = useState(0);
  // 1 Hz RTF pull for status bar (avoids 20Hz setState)
  useEffect(() => {
    const iv = setInterval(() => {
      setStatusRtf(rtfRef.current);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Env popover (single merged dot)
  const [showEnvPopover, setShowEnvPopover] = useState(false);
  const envPopoverRef = useRef(null);
  useEffect(() => {
    if (!showEnvPopover) return;
    const onDown = (e) => {
      if (!envPopoverRef.current?.contains(e.target)) setShowEnvPopover(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showEnvPopover]);
  const { rosStatus, envData, fpsLimit, setFpsLimit, setShowEnvModal, showShortcuts, setShowShortcuts } = useAppStore();
  const rosConnected = rosStatus === 'Connected to ROS2' || rosStatus === 'Connected';
  const envReady = envData?.allReady;
  // Merged ROS2+Env state
  const rosEnvState = rosConnected && envReady ? 'ready'
    : envReady ? 'offline'
    : envData ? 'setup'
    : 'unknown';
  const rosEnvMeta = {
    ready:   { color: 'var(--c-success)', label: 'ROS2 Ready' },
    offline: { color: 'var(--c-danger)',  label: 'ROS2 Offline' },
    setup:   { color: 'var(--c-warn)',    label: 'ROS2 Setup' },
    unknown: { color: 'var(--c-text-3)', label: 'ROS2 ...' },
  }[rosEnvState];

  // ── Inspector tab state (persisted in localStorage)
  const [activeTab, setActiveTab] = useState(() => {
    try { return localStorage.getItem('inspector-tab') || 'telemetry'; } catch { return 'telemetry'; }
  });
  const setTab = (t) => {
    setActiveTab(t);
    try { localStorage.setItem('inspector-tab', t); } catch { /* ignore storage errors */ }
  };
  const [inspOpen, setInspOpen] = useState(() => {
    try { return localStorage.getItem('inspector-open') !== 'false'; } catch { return true; }
  });
  const toggleInsp = () => {
    setInspOpen(o => {
      const next = !o;
      try { localStorage.setItem('inspector-open', String(next)); } catch { /* ignore storage errors */ }
      return next;
    });
  };

  const TAB_ICONS = {
    telemetry: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    setup: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
    drive: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 7.5V2H9v5.5l3 3 3-3z" /><path d="M7.5 9H2v6h5.5l3-3-3-3z" />
        <path d="M16.5 9l-3 3 3 3H22V9h-5.5z" /><path d="M9 16.5V22h6v-5.5l-3-3-3 3z" />
      </svg>
    ),
    console: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  };

  const navigate = useNavigate();
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  // Global shortcuts listener for ? and Ctrl+K / Cmd+K
  useEffect(() => {
    const handleGlobalKey = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
        return;
      }

      if (e.key === '?' && !isInput) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [setShowShortcuts]);

  const paletteActions = useMemo(() => [
    {
      id: 'reset-pose',
      label: 'Reset Robot Pose',
      desc: 'Publish initialpose to reset robot to spawn location',
      shortcut: 'Alt+R',
      run: () => {
        if (!rosObj) return;
        const { spawnPose: curSpawn } = useAppStore.getState();
        const sx = Number(curSpawn?.x) || 0;
        const sy = Number(curSpawn?.y) || 0;
        const syawDeg = Number(curSpawn?.yaw) || 0;
        const syawRad = (syawDeg * Math.PI) / 180;
        const qz = Math.sin(syawRad / 2);
        const qw = Math.cos(syawRad / 2);
        const initPoseTopic = new ROSLIB.Topic({
          ros: rosObj,
          name: '/initialpose',
          messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped',
        });
        initPoseTopic.publish({
          header: { frame_id: 'map' },
          pose: {
            pose: {
              position: { x: sx, y: sy, z: 0.0 },
              orientation: { x: 0.0, y: 0.0, z: qz, w: qw },
            },
            covariance: new Array(36).fill(0),
          },
        });
      },
    },
    {
      id: 'tab-telemetry',
      label: 'Switch to Telemetry Tab',
      desc: 'View live robot odometry and collision status',
      run: () => { setTab('telemetry'); if (!inspOpen) setInspOpen(true); },
    },
    {
      id: 'tab-setup',
      label: 'Switch to Setup Tab',
      desc: 'Configure robot, map, and spawn coordinates',
      run: () => { setTab('setup'); if (!inspOpen) setInspOpen(true); },
    },
    {
      id: 'tab-drive',
      label: 'Switch to Drive Tab',
      desc: 'Teleoperate robot using 3x3 directional keypad',
      run: () => { setTab('drive'); if (!inspOpen) setInspOpen(true); },
    },
    {
      id: 'tab-console',
      label: 'Switch to Console Tab',
      desc: 'Inspect ROS 2 topics and raw JSON streams',
      run: () => { setTab('console'); if (!inspOpen) setInspOpen(true); },
    },
    {
      id: 'toggle-theme',
      label: `Switch to ${isDark ? 'Light' : 'Dark'} Mode`,
      desc: 'Toggle application color theme',
      run: () => setIsDark(!isDark),
    },
    {
      id: 'env-check',
      label: 'Environment Check',
      desc: 'Check ROS 2, rosbridge_server, and amr_2dsim packages',
      run: () => setShowEnvModal(true),
    },
    {
      id: 'create-robot',
      label: 'Create / Edit Robot',
      desc: 'Open visual URDF robot builder',
      run: () => navigate('/create-robot'),
    },
    {
      id: 'create-world',
      label: 'Create / Edit World',
      desc: 'Open 2D grid world map editor',
      run: () => navigate('/create-world'),
    },
    {
      id: 'shortcuts',
      label: 'Keyboard Shortcuts Guide',
      desc: 'Show all keyboard shortcuts for simulator',
      shortcut: '?',
      run: () => setShowShortcuts(true),
    },
  ], [rosObj, inspOpen, isDark, setIsDark, setShowEnvModal, setShowShortcuts, navigate]);

  return (
    <>
      {/* ── Modals & Palettes ────────────────────────────────────────────── */}
      <ShortcutModal isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} isDark={isDark} />
      <CommandPalette isOpen={showCommandPalette} onClose={() => setShowCommandPalette(false)} isDark={isDark} actions={paletteActions} />
      <CoachTour isDark={isDark} />
      {/* ── Toasts ──────────────────────────────────────────────────────── */}
      {showStatusToast && updateInfo && updateInfo.status !== 'downloading' && updateInfo.status !== 'downloaded' && (
        <div style={{
          position: 'fixed', top: '64px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, display: 'flex', alignItems: 'center', gap: '10px',
          background: isDark ? '#1b5e20' : '#e8f5e9', color: isDark ? '#81c784' : '#2e7d32',
          border: '1px solid #4caf50', padding: '8px 18px', borderRadius: '24px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', fontSize: '13px', fontWeight: 600,
        }}>
          <span>{updateInfo.status === 'checking' ? 'Checking for updates...' : updateInfo.status === 'available' ? 'Update available!' : updateInfo.status === 'error' ? `Error: ${updateInfo.message}` : updateInfo.message || 'No update available'}</span>
          <button onClick={() => setShowStatusToast(false)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      )}
      {showCollisionToast && (
        <div style={{
          position: 'fixed', top: '64px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, display: 'flex', alignItems: 'center', gap: '10px',
          background: isDark ? '#b71c1c' : '#ffebee', color: isDark ? '#ffcdd2' : '#c62828',
          border: `1px solid ${isDark ? '#ef5350' : '#ef9a9a'}`, padding: '8px 18px',
          borderRadius: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', fontSize: '13px', fontWeight: 600,
        }}>
          <span>Collision detected</span>
          <button onClick={() => setShowCollisionToast(false)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      )}
      {idleStopped && (
        <div style={{
          position: 'fixed', top: '64px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, display: 'flex', alignItems: 'center', gap: '10px',
          background: isDark ? '#3a2c05' : '#fff8e1', color: isDark ? '#ffe082' : '#8d6e00',
          border: `1px solid ${isDark ? '#ffb300' : '#ffe082'}`, padding: '8px 18px',
          borderRadius: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', fontSize: '13px', fontWeight: 600,
        }}>
          <span>Simulation stopped — idle 1 h. Press Launch to resume.</span>
        </div>
      )}

      <UpdateProgressModal updateInfo={updateInfo} appVersion={appVersion} onClose={() => setUpdateInfo(null)} />
      <NotificationModal notification={notification} onClose={() => setNotification(null)} isDark={isDark} />


      {/* ── Main shell: canvas | inspector ──────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }}>
        {/* Content row */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', position: 'relative' }}>

          {/* ── Canvas full-bleed ──────────────────────────────────── */}
          <div style={{ flex: 1, position: 'relative', minWidth: 0, background: isDark ? 'var(--c-canvas)' : 'var(--c-canvas)' }} ref={mapWrapRef}>
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
              onFollowChange={setIsFollowingRobot}
              onFpsSample={setActualFps}
            />

            {/* HUD top-left: World name + Reset Pose */}
            <div style={{
              position: 'absolute', top: 12, left: 12,
              background: isDark ? 'rgba(17,22,29,0.85)' : 'rgba(255,255,255,0.90)',
              backdropFilter: 'blur(8px)', borderRadius: 'var(--r-lg)',
              border: '1px solid var(--c-border)', padding: '10px 14px',
              display: 'flex', flexDirection: 'column', gap: 8, zIndex: 5, minWidth: 140,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: isDark ? 'var(--c-text-1)' : 'var(--c-text-1)', whiteSpace: 'nowrap' }}>
                {mapStatus === 'error' ? (activeWorld || 'unknown') : (mapName || 'Loading…')}
                {mapStatus === 'error' && (
                  <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--c-danger)', background: 'var(--c-danger-bg)', borderRadius: 'var(--r-sm)', padding: '1px 6px', border: '1px solid var(--c-danger)', verticalAlign: 'middle' }}>LOAD FAILED</span>
                )}
              </div>
              <button
                onClick={() => {
                  if (!rosObj) { console.warn('[ResetPose] no rosObj'); return; }
                  const { spawnPose: curSpawn } = useAppStore.getState();
                  const sx = Number(curSpawn?.x) || 0;
                  const sy = Number(curSpawn?.y) || 0;
                  const syawDeg = Number(curSpawn?.yaw) || 0;
                  const syawRad = (syawDeg * Math.PI) / 180;
                  const qz = Math.sin(syawRad / 2);
                  const qw = Math.cos(syawRad / 2);

                  const initPoseTopic = new ROSLIB.Topic({
                    ros: rosObj,
                    name: '/initialpose',
                    messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped',
                  });
                  initPoseTopic.publish({
                    header: { frame_id: 'map' },
                    pose: {
                      pose: {
                        position: { x: sx, y: sy, z: 0.0 },
                        orientation: { x: 0.0, y: 0.0, z: qz, w: qw },
                      },
                      covariance: new Array(36).fill(0),
                    },
                  });
                }}
                title="Reset robot to configured spawn pose"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 'var(--r-md)', border: 'none',
                  background: 'linear-gradient(135deg, var(--c-danger), #b91c1c)',
                  color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(239,68,68,0.35)', transition: 'transform 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
                </svg>
                Reset Pose
              </button>
            </div>

            {/* HUD top-right: Interactive View Tools */}
            <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, zIndex: 5 }}>
              <div style={{
                background: isDark ? 'rgba(17,22,29,0.88)' : 'rgba(255,255,255,0.92)',
                backdropFilter: 'blur(8px)', borderRadius: 'var(--r-lg)',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
                padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 3,
                boxShadow: 'var(--shadow-sm)',
              }}>
                {/* Rotate Left */}
                <button
                  onClick={() => { worldMapRef.current?.rotateLeft(); setIsFollowingRobot(false); }}
                  title="Rotate Left 15° (or Left-click drag)"
                  style={{
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 'var(--r-md)', border: 'none', background: 'transparent',
                    color: 'var(--c-text-1)', cursor: 'pointer', fontWeight: 700,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = isDark ? '#1e2633' : '#f1f5f9'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                </button>

                {/* Rotate Right */}
                <button
                  onClick={() => { worldMapRef.current?.rotateRight(); setIsFollowingRobot(false); }}
                  title="Rotate Right 15° (or Left-click drag)"
                  style={{
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 'var(--r-md)', border: 'none', background: 'transparent',
                    color: 'var(--c-text-1)', cursor: 'pointer', fontWeight: 700,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = isDark ? '#1e2633' : '#f1f5f9'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>

                <div style={{ width: 1, height: 16, background: 'var(--c-border)', margin: '0 2px' }} />

                {/* Zoom In */}
                <button
                  onClick={() => { worldMapRef.current?.zoomIn(); setIsFollowingRobot(false); }}
                  title="Zoom In (Scroll up)"
                  style={{
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 'var(--r-md)', border: 'none', background: 'transparent',
                    color: 'var(--c-text-1)', cursor: 'pointer', fontWeight: 700, fontSize: 16,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = isDark ? '#1e2633' : '#f1f5f9'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>

                {/* Zoom Out */}
                <button
                  onClick={() => { worldMapRef.current?.zoomOut(); setIsFollowingRobot(false); }}
                  title="Zoom Out (Scroll down)"
                  style={{
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 'var(--r-md)', border: 'none', background: 'transparent',
                    color: 'var(--c-text-1)', cursor: 'pointer', fontWeight: 700, fontSize: 16,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = isDark ? '#1e2633' : '#f1f5f9'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>

                <div style={{ width: 1, height: 16, background: 'var(--c-border)', margin: '0 2px' }} />

                {/* Reset View -> Center */}
                <button
                  onClick={() => { worldMapRef.current?.resetView(); setIsFollowingRobot(false); }}
                  title="Center Camera: 100% Zoom & Default Position (Double-click canvas)"
                  style={{
                    padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4,
                    borderRadius: 'var(--r-md)', border: 'none', background: 'transparent',
                    color: 'var(--c-text-1)', cursor: 'pointer', fontWeight: 700, fontSize: 12,
                    fontFamily: 'var(--font-ui)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = isDark ? '#1e2633' : '#f1f5f9'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
                  </svg>
                  <span>Center</span>
                </button>

                <div style={{ width: 1, height: 16, background: 'var(--c-border)', margin: '0 2px' }} />

                {/* Follow Robot Toggle */}
                <button
                  onClick={() => worldMapRef.current?.toggleFollow()}
                  // Without a map there is no WorldMap mounted, so the ref is
                  // null and toggleFollow() is a no-op -- the button looked live
                  // and did nothing. Say so instead.
                  disabled={!mapData}
                  title={mapData
                    ? "Follow Robot: auto-center viewport on moving robot"
                    : "Follow Robot: unavailable until a world is loaded"}
                  style={{
                    padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6,
                    borderRadius: 'var(--r-md)', border: isFollowingRobot ? '1px solid var(--c-accent)' : '1px solid transparent',
                    background: isFollowingRobot ? 'var(--c-accent-bg)' : 'transparent',
                    color: !mapData ? 'var(--c-text-3)' : (isFollowingRobot ? 'var(--c-accent)' : 'var(--c-text-1)'),
                    cursor: mapData ? 'pointer' : 'not-allowed',
                    opacity: mapData ? 1 : 0.5,
                    fontWeight: 700, fontSize: 12,
                    fontFamily: 'var(--font-ui)',
                    transition: 'all 0.15s',
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="22" y1="12" x2="18" y2="12" /><line x1="6" y1="12" x2="2" y2="12" />
                    <line x1="12" y1="6" x2="12" y2="2" /><line x1="12" y1="22" x2="12" y2="18" />
                  </svg>
                  <span>Follow</span>
                </button>
              </div>

              {/* Mouse Controls Hint */}
              <div style={{
                fontSize: 11,
                color: isDark ? '#cbd5e1' : '#334155',
                background: isDark ? 'rgba(17,22,29,0.88)' : 'rgba(255,255,255,0.92)',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
                backdropFilter: 'blur(8px)',
                borderRadius: 'var(--r-pill)',
                padding: '3px 10px',
                fontWeight: 600,
                fontFamily: 'var(--font-ui)',
                userSelect: 'none',
                letterSpacing: '0.2px',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
                <span>🖱️</span>
                <span>Left: Rotate • Mid: Pan • Scroll: Zoom</span>
              </div>
            </div>
          </div>

          {/* ── Right Inspector ────────────────────────────────────── */}
          <div style={{
            width: inspOpen ? (inspectorCollapsed ? 'min(80vw,340px)' : '340px') : '40px',
            flexShrink: 0, overflow: 'hidden', position: 'relative',
            transition: 'width 250ms cubic-bezier(0.16, 1, 0.3, 1)',
            borderLeft: '1px solid var(--c-border)',
            background: 'var(--c-panel)', zIndex: 10,
            contain: 'paint',
          }}>
            <div style={{
              position: 'absolute', top: 0, bottom: 0, right: 0, width: 340,
              display: 'flex', flexDirection: 'row', height: '100%', overflow: 'hidden',
            }}>

              {/* Tab content */}
              <div style={{
                width: 300, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                opacity: inspOpen ? 1 : 0, pointerEvents: inspOpen ? 'auto' : 'none',
                transition: 'opacity 180ms ease-out',
              }}>
                {/* Tab header — slim overline (11px); rail already shows context */}
                <div style={{
                  padding: '6px 16px 5px', fontFamily: 'var(--font-ui)', fontSize: 10,
                  fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase',
                  color: 'var(--c-text-3)', borderBottom: '1px solid var(--c-border)', flexShrink: 0,
                }}>
                  {activeTab}
                </div>

                {/* Scrollable content */}
                <div className="scrollable" style={{ flex: 1, overflow: 'hidden auto', padding: '12px 16px' }}>

                  {/* ── TELEMETRY ────────────── */}
                  {activeTab === 'telemetry' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* X card */}
                      <div style={{ borderRadius: 12, overflow: 'hidden', background: isDark ? '#161c25' : '#f8fafc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px' }}>
                          <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--c-text-3)' }}>X</span>
                          <PoseSingle poseRef={poseRef} field="x" unit="m" />
                        </div>
                      </div>
                      {/* Y card */}
                      <div style={{ borderRadius: 12, overflow: 'hidden', background: isDark ? '#161c25' : '#f8fafc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px' }}>
                          <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--c-text-3)' }}>Y</span>
                          <PoseSingle poseRef={poseRef} field="y" unit="m" />
                        </div>
                      </div>
                      {/* Angle card */}
                      <div style={{ borderRadius: 12, overflow: 'hidden', background: isDark ? '#161c25' : '#f8fafc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px' }}>
                          <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--c-text-3)' }}>ANGLE</span>
                          <PoseSingle poseRef={poseRef} field="theta" unit="°" isAngle />
                        </div>
                      </div>
                      {/* Collision chip */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                        borderRadius: 12, border: `1px solid ${collisionActive ? 'var(--c-danger)' : 'var(--c-success)'}`,
                        background: collisionActive ? 'var(--c-danger-bg)' : 'var(--c-success-bg)',
                        fontSize: 12, fontWeight: 800,
                        color: collisionActive ? 'var(--c-danger)' : 'var(--c-success)',
                      }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                          background: collisionActive ? 'var(--c-danger)' : 'var(--c-success)',
                          boxShadow: `0 0 6px ${collisionActive ? 'var(--c-danger)' : 'var(--c-success)'}`,
                        }} />
                        {collisionActive ? 'Collision Detected' : 'Collision OK'}
                      </div>
                    </div>
                  )}

                  {/* ── SETUP ────────────────── */}
                  {/* Kept mounted on every tab: SimSelector's init effect fetches
                      the robot/world lists and auto-launches the sim, so gating
                      it on the tab meant nothing launched until you opened Setup. */}
                  <div style={{ display: activeTab === 'setup' ? 'block' : 'none' }}>
                    <SimSelector
                      ref={simSelectorRef}
                      onSwitch={handleSwitch}
                      onStop={() => setIsWaitingOdom(false)}
                      isDark={isDark}
                      isWaitingOdom={isWaitingOdom}
                      poseRef={poseRef}
                    />
                  </div>

                  {/* ── DRIVE ─────────────────── */}
                  {/* Kept mounted on every tab so keyboard teleop keeps working
                      when the inspector is on Setup / Telemetry / Console. */}
                  <div style={{ display: activeTab === 'drive' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>
                    {/* Compact odom strip */}
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--c-panel-2)', borderRadius: 'var(--r-md)', padding: '8px 10px',
                      display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center',
                    }}>
                      <PoseSingle poseRef={poseRef} field="x" unit="m" compact />
                      <span style={{ color: 'var(--c-border-2)' }}>|</span>
                      <PoseSingle poseRef={poseRef} field="y" unit="m" compact />
                      <span style={{ color: 'var(--c-border-2)' }}>|</span>
                      <PoseSingle poseRef={poseRef} field="theta" unit="°" isAngle compact />
                    </div>
                    <KeyboardController ros={rosObj} isDark={isDark} />
                  </div>

                  {/* ── CONSOLE ─────────────── */}
                  {activeTab === 'console' && (
                    <TopicMonitor ros={rosObj} isDark={isDark} />
                  )}

                </div>
              </div>

              {/* Icon tab rail (always visible on the right edge) */}
              <div style={{
                width: 40, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
                borderLeft: '1px solid var(--c-border)', padding: '8px 0', gap: 4,
                background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
              }}>
                {Object.entries(TAB_ICONS).map(([tab, icon]) => (
                  <button
                    key={tab}
                    onClick={() => {
                      setTab(tab);
                      if (!inspOpen) setInspOpen(true);
                    }}
                    title={tab.charAt(0).toUpperCase() + tab.slice(1)}
                    style={{
                      width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 'var(--r-md)', border: 'none', cursor: 'pointer',
                      color: (activeTab === tab && inspOpen) ? 'var(--c-accent)' : 'var(--c-text-2)',
                      background: (activeTab === tab && inspOpen) ? 'var(--c-accent-bg)' : 'transparent',
                      transition: 'all var(--dur-fast) var(--ease-out)',
                    }}
                  >
                    {icon}
                  </button>
                ))}
                {/* Collapse / Expand toggle at bottom */}
                <div style={{ flex: 1 }} />
                <button
                  onClick={toggleInsp}
                  title={inspOpen ? 'Collapse inspector' : 'Open inspector'}
                  style={{
                    width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 'var(--r-md)', border: 'none', cursor: 'pointer',
                    color: 'var(--c-text-2)', background: 'transparent',
                    transition: 'all var(--dur-fast) var(--ease-out)',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points={inspOpen ? '9 18 15 12 9 6' : '15 18 9 12 15 6'} />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Bottom Status Bar ──────────────────────────────────────── */}
        <div style={{
          height: 'var(--status-bar-h, 28px)', flexShrink: 0,
          display: 'flex', alignItems: 'center',
          borderTop: '1px solid var(--c-border)',
          background: isDark ? '#0B0F14' : '#F1F5F9',
          // no overflow clip here -- it used to hide the env popover (positioned
          // bottom:100%, above the bar). Horizontal spill is caught by the shell.
          padding: '0 12px', gap: 0,
          fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-2)',
          position: 'relative', zIndex: 20,
        }}>

          {/* ROS2 + Env merged dot */}
          <div ref={envPopoverRef} style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => setShowEnvPopover(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
              height: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--c-text-2)', fontFamily: 'var(--font-mono)', fontSize: 11,
              transition: 'background var(--dur-fast)',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--c-panel-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: rosEnvMeta.color,
              animation: rosEnvState === 'ready' ? 'none' : 'pulse-dot 2s ease-in-out infinite',
            }} />
            {rosEnvMeta.label}
          </button>

          {/* Env popover */}
          {showEnvPopover && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
              background: isDark ? 'var(--c-panel)' : 'var(--c-panel)',
              border: '1px solid var(--c-border)', borderRadius: 'var(--r-lg)',
              padding: '12px 16px', minWidth: 240, zIndex: 50,
              boxShadow: 'var(--shadow-lg)', animation: 'fade-in 0.15s var(--ease-out)',
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-text-1)', marginBottom: 8, fontFamily: 'var(--font-ui)' }}>Environment Status</div>
              {envData ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { key: 'ros2', label: 'ROS 2' },
                    { key: 'rosbridge', label: 'rosbridge_server' },
                    { key: 'robotStatePublisher', label: 'robot_state_publisher' },
                    { key: 'workspace', label: 'amr_2dsim' },
                  ].map(({ key, label }) => {
                    const ok = envData.checks?.[key]?.ready;
                    return (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                      <span style={{ color: 'var(--c-text-2)' }}>{label}</span>
                      <span style={{ color: ok ? 'var(--c-success)' : 'var(--c-danger)', fontWeight: 700 }}>
                        {ok ? '✓ OK' : '✗ Missing'}
                      </span>
                    </div>
                    );
                  })}
                  <div style={{ marginTop: 8, borderTop: '1px solid var(--c-border)', paddingTop: 8 }}>
                    <button onClick={() => { setShowEnvModal(true); setShowEnvPopover(false); }} style={{
                      fontSize: 11, fontFamily: 'var(--font-ui)', color: 'var(--c-accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600,
                    }}>Open Environment Check →</button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>Checking…</div>
              )}
            </div>
          )}
          </div>

          <div style={{ width: 1, height: 14, background: 'var(--c-border)', margin: '0 2px' }} />

          {/* FPS toggle */}
          <button
            onClick={() => { if (fpsLimit === 20) setFpsLimit(60); else if (fpsLimit === 60) setFpsLimit(0); else setFpsLimit(20); }}
            title={`Measured ${actualFps} fps against a ${fpsLimit === 0 ? "no" : fpsLimit + " fps"} cap. Click to cycle 20 / 60 / unlimited.`}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px',
              height: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--c-text-3)', fontFamily: 'var(--font-mono)', fontSize: 11,
              transition: 'background var(--dur-fast)',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--c-panel-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {fpsLimit === 0
              ? `FPS ${actualFps} / ∞`
              : `FPS ${actualFps} / ${fpsLimit}`}
          </button>

          <div style={{ width: 1, height: 14, background: 'var(--c-border)', margin: '0 2px' }} />

          {/* RTF (1 Hz update) */}
          <span style={{ padding: '0 10px' }}>RTF {statusRtf}</span>
        </div>
      </div>
    </>
  );
}
