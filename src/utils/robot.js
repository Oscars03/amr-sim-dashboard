// ─────────────────────────────────────────────────────────────────────────────
// parseURDF
// ─────────────────────────────────────────────────────────────────────────────
export function parseURDF(xmlString) {
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

    // Build map: childLinkName → cumulative {x, y} offset in base_link frame
    // Only follows fixed joints; wheel/continuous joints kept as-is (still visualised).
    const jointOffset = {}; // { linkName: {x, y} }
    xml.querySelectorAll("joint").forEach((j) => {
      const child = j.querySelector("child")?.getAttribute("link");
      if (!child) return;
      const origin = j.querySelector("origin");
      const xyz = origin?.getAttribute("xyz")?.split(" ").map(Number) ?? [0, 0, 0];
      // Accumulate: parent's offset + this joint's xyz (x,y only for top-down)
      const parent = j.querySelector("parent")?.getAttribute("link") ?? "";
      const parentOff = jointOffset[parent] ?? { x: 0, y: 0 };
      jointOffset[child] = { x: parentOff.x + xyz[0], y: parentOff.y + xyz[1] };
    });

    xml.querySelectorAll("link").forEach((link) => {
      const linkName = link.getAttribute("name") ?? "";
      const jOff = jointOffset[linkName] ?? { x: 0, y: 0 };

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

        // Bake joint offset into visual origin (top-down: x,y only)
        const ox = jOff.x + xyz[0];
        const oy = jOff.y + xyz[1];

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
            ox,
            oy,
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
            ox,
            oy,
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
            ox,
            oy,
            oz: xyz[2],
            color: hexColor,
          });
        }
      });
    });

    let extractedConfig = null;
    const simConfig = xml.querySelector("amr_sim_config");
    if (simConfig) {
      const kinematicModel = simConfig.querySelector("kinematic_model")?.textContent?.trim() ?? "diff_drive";
      const wheelBase = parseFloat(simConfig.querySelector("wheel_base")?.textContent ?? "0.5");
      const axleTrack = parseFloat(simConfig.querySelector("axle_track")?.textContent ?? "0.4");
      const wheelRadius = parseFloat(simConfig.querySelector("wheel_radius")?.textContent ?? "0.1");
      const wheelWidth = parseFloat(simConfig.querySelector("wheel_width")?.textContent ?? "0.05");
      const maxSteeringAngle = parseFloat(simConfig.querySelector("max_steering_angle")?.textContent ?? "30");
      const driveAxleNode = simConfig.querySelector("drive_axle_x");
      const driveAxleX = driveAxleNode ? parseFloat(driveAxleNode.textContent) : null;
      const wheelColor = "#222222"; // Dark gray

      extractedConfig = { kinematicModel, wheelBase, axleTrack, wheelRadius, wheelWidth, maxSteeringAngle, driveAxleX };

      const addWheel = (ox, oy, linkName = "virtual_wheel") => {
        shapes.push({
          link: linkName, type: "box", w: wheelRadius * 2, d: wheelWidth, h: wheelRadius * 2,
          ox, oy, oz: wheelRadius, yaw: 0, color: wheelColor,
        });
      };

      if (kinematicModel === "diff_drive") {
        const ax = driveAxleX !== null ? driveAxleX : 0;
        addWheel(ax, axleTrack / 2, "virtual_wheel_rl");
        addWheel(ax, -axleTrack / 2, "virtual_wheel_rr");
      } else if (kinematicModel === "ackermann") {
        const rearX = driveAxleX !== null ? driveAxleX : -wheelBase / 2;
        const frontX = rearX + wheelBase;
        addWheel(rearX, axleTrack / 2, "virtual_wheel_rl");
        addWheel(rearX, -axleTrack / 2, "virtual_wheel_rr");
        addWheel(frontX, axleTrack / 2, "virtual_wheel_fl");
        addWheel(frontX, -axleTrack / 2, "virtual_wheel_fr");
      } else if (kinematicModel === "mecanum") {
        const rearX = driveAxleX !== null ? driveAxleX : -wheelBase / 2;
        const frontX = rearX + wheelBase;
        addWheel(frontX, axleTrack / 2, "virtual_wheel_fl");
        addWheel(frontX, -axleTrack / 2, "virtual_wheel_fr");
        addWheel(rearX, axleTrack / 2, "virtual_wheel_rl");
        addWheel(rearX, -axleTrack / 2, "virtual_wheel_rr");
      } else if (kinematicModel === "omni") {
        const radius = parseFloat(simConfig.querySelector("robot_radius")?.textContent ?? "0.3");
        addWheel(0, radius, "virtual_wheel_fl");
        addWheel(radius * Math.cos(Math.PI / 6), -radius * Math.sin(Math.PI / 6), "virtual_wheel_fr");
        addWheel(-radius * Math.cos(Math.PI / 6), -radius * Math.sin(Math.PI / 6), "virtual_wheel_rl");
      }
    }

    let maxR = 0.2;
    shapes.forEach((s) => {
      if (s.type === "box") maxR = Math.max(maxR, Math.abs(s.ox) + s.w / 2, Math.abs(s.oy) + s.d / 2);
      else maxR = Math.max(maxR, Math.abs(s.ox) + s.radius, Math.abs(s.oy) + s.radius);
    });

    const robotName = xml.querySelector("robot")?.getAttribute("name") || "";

    return { shapes, maxR, config: extractedConfig, name: robotName };
  } catch (err) {
    console.error("URDF parse error:", err);
    return { shapes: [], maxR: 0.2, config: null, name: "" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// drawRobot
// ─────────────────────────────────────────────────────────────────────────────
export function drawRobot(
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
  vx = 0,
  w = 0,
  effectActive = false,
  effectStartTime = 0,
  effectEndTime = 0,
  collisionActive = false,
  steeringAngle = null
) {
  const { shapes, maxR, config } = urdf ?? { shapes: [], maxR: 0.2, config: null };
  const labelR = Math.max(10, maxR * scale);
  const kinematicModel = config?.kinematicModel ?? "diff_drive";

  const textColor = isDark ? "#000000" : "#ffffff";
  const lineColor = isDark ? "#000000" : "#ffffff";
  const coordColor = isDark ? "#000652" : "#3ed6fc";

  ctx.save();
  ctx.translate(rx, ry);

  ctx.rotate(-Math.PI / 2 - thetaRad);

  if (shapes.length === 0) {
    ctx.restore();
    return;
  }
    // 5. DROP SHADOW: Cached radial gradient black fading to transparent underneath
    const shadowR = maxR * scale * 1.25;
    const shadowCacheKey = `${shadowR.toFixed(1)}`;
    if (urdf._shadowCacheKey !== shadowCacheKey) {
      urdf._shadowCacheKey = shadowCacheKey;
      const shadowGrad = ctx.createRadialGradient(0, 0, shadowR * 0.1, 0, 0, shadowR);
      shadowGrad.addColorStop(0, "rgba(0, 0, 0, 0.35)");
      shadowGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      urdf._shadowGrad = shadowGrad;
    }
    ctx.fillStyle = urdf._shadowGrad;
    ctx.beginPath();
    ctx.arc(0, 0, shadowR, 0, Math.PI * 2);
    ctx.fill();

    shapes.forEach((s) => {
      const sx = s.ox * scale;
      const sy = -s.oy * scale;
      ctx.save();
      ctx.translate(sx, sy);

      let finalYaw = s.yaw || 0;
      if (s.link === "virtual_wheel_fl" || s.link === "virtual_wheel_fr") {
        if (config?.kinematicModel === "ackermann") {
          if (steeringAngle !== null) {
            // Real angle from /joint_states -- tracks the steering input at
            // any speed, including standing still (unlike the old vx-gated
            // atan(w*L/vx) estimate below, which could only show anything
            // once the robot was already moving).
            finalYaw = steeringAngle;
          } else if (Math.abs(vx) > 1e-4) {
            const maxSteer = (config?.maxSteeringAngle ?? 30) * (Math.PI / 180);
            const rawSteer = Math.atan((w * (config?.wheelBase ?? 0.5)) / vx);
            finalYaw = Math.max(-maxSteer, Math.min(maxSteer, rawSteer));
          }
        }
      }
      if (finalYaw) ctx.rotate(-finalYaw);

      const isWheel = Boolean(s.link && s.link.toLowerCase().includes("wheel"));
      const isLidar = !isWheel && Boolean(s.link && (s.link.toLowerCase().includes("laser") || s.link.toLowerCase().includes("lidar") || s.link.toLowerCase().includes("sensor")));

      if (isWheel) {
        // --- 2. WHEELS (Upright rectangular housing) ---
        const w = s.w ?? (s.radius ? s.radius * 2 : 0.08);
        const d = s.d ?? (s.length ? s.length : (s.radius ? s.radius * 2 : 0.04));
        const hw = Math.max(1, (w / 2) * scale);
        const hd = Math.max(1, (d / 2) * scale);
        const wheelRadius = 2;

        const wheelCacheKey = `${hw.toFixed(1)}_${hd.toFixed(1)}_${kinematicModel}`;
        if (s._wheelCacheKey !== wheelCacheKey) {
          s._wheelCacheKey = wheelCacheKey;

          const maxDist = Math.hypot(hw, hd);
          const wheelGrad = ctx.createRadialGradient(hw * 0.3, hd * 0.3, 0, 0, 0, maxDist);
          wheelGrad.addColorStop(0, "#6a6d72");
          wheelGrad.addColorStop(0.5, "#2c2e32");
          wheelGrad.addColorStop(1, "#111214");
          s._cachedWheelGrad = wheelGrad;

          const wp = new Path2D();
          if (wp.roundRect) {
            wp.roundRect(-hw, -hd, hw * 2, hd * 2, wheelRadius);
          } else {
            wp.rect(-hw, -hd, hw * 2, hd * 2);
          }
          s._cachedWheelPath = wp;

          if (kinematicModel === "mecanum") {
            const isSameSign = (s.ox * s.oy) >= 0;
            const dir = isSameSign ? 1 : -1;
            const numLines = 4;
            const step = (hw * 2 + hd * 2) / numLines;
            const mp = new Path2D();
            for (let i = -numLines; i <= numLines; i++) {
              const offset = i * (step * 0.5);
              if (dir === 1) {
                mp.moveTo(-hw + offset - hd, -hd);
                mp.lineTo(-hw + offset + hd, hd);
              } else {
                mp.moveTo(-hw + offset + hd, -hd);
                mp.lineTo(-hw + offset - hd, hd);
              }
            }
            s._cachedMecanumRollerPath = mp;
          }
        }

        ctx.fillStyle = s._cachedWheelGrad;
        ctx.fill(s._cachedWheelPath);
        ctx.strokeStyle = "#4a4d52";
        ctx.lineWidth = 1;
        ctx.stroke(s._cachedWheelPath);

        if (kinematicModel === "mecanum") {
          // --- 2b. MECANUM WHEELS: cached diagonal roller lines clipped to upright wheel rect ---
          ctx.save();
          ctx.clip(s._cachedWheelPath);
          ctx.strokeStyle = "#54575c";
          ctx.lineWidth = 2;
          ctx.stroke(s._cachedMecanumRollerPath);
          ctx.restore();
        } else {
          // --- 2a. STANDARD WHEELS: centered vertical tread strip ---
          ctx.fillStyle = "rgba(69, 72, 77, 0.60)";
          const stripWidth = Math.max(1, hd * 0.4);
          ctx.fillRect(-hw, -stripWidth / 2, hw * 2, stripWidth);
        }
      } else if (isLidar) {
        // --- 3. LIDAR / SENSOR PUCK ---
        const pr = Math.max(1.5, (s.radius || 0.05) * scale);
        const lidarCacheKey = `${pr.toFixed(1)}`;
        if (s._lidarCacheKey !== lidarCacheKey) {
          s._lidarCacheKey = lidarCacheKey;
          const laserGrad = ctx.createRadialGradient(pr * 0.3, pr * 0.3, 0, 0, 0, pr);
          laserGrad.addColorStop(0, "#e8eaed");
          laserGrad.addColorStop(0.5, "#c3c6cb");
          laserGrad.addColorStop(1, "#8f9296");
          s._cachedLidarGrad = laserGrad;
        }

        ctx.fillStyle = s._cachedLidarGrad;
        ctx.beginPath();
        ctx.arc(0, 0, pr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#4a4d52";
        ctx.lineWidth = 1;
        ctx.stroke();

        const innerR = Math.max(1, pr * 0.5);
        ctx.fillStyle = "#2c2e32";
        ctx.beginPath();
        ctx.arc(0, 0, innerR, 0, Math.PI * 2);
        ctx.fill();

        const dotR = Math.max(0.5, innerR * 0.3);
        ctx.fillStyle = "rgba(232, 234, 237, 0.50)";
        ctx.beginPath();
        ctx.arc(innerR * 0.3, innerR * 0.3, dotR, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.type === "box") {
        // --- 1. BODY (Rectangular chassis driving gradient from configured color) ---
        const w = s.w ?? 0.3;
        const d = s.d ?? 0.3;
        const hw = Math.max(2, (w / 2) * scale);
        const hd = Math.max(2, (d / 2) * scale);
        const cornerRadius = Math.min(hw, hd) * 0.15;
        const baseColor = s.color || "#1a4dcc";

        const bodyCacheKey = `${hw.toFixed(1)}_${hd.toFixed(1)}_${baseColor}`;
        if (s._bodyCacheKey !== bodyCacheKey) {
          s._bodyCacheKey = bodyCacheKey;

          // Linear gradient derived from base color: top (lightened +15%), mid (+5%), bottom (darkened -20%)
          const bodyGrad = ctx.createLinearGradient(hw, 0, -hw, 0);
          bodyGrad.addColorStop(0, `color-mix(in srgb, ${baseColor}, white 15%)`);
          bodyGrad.addColorStop(0.5, `color-mix(in srgb, ${baseColor}, white 5%)`);
          bodyGrad.addColorStop(1, `color-mix(in srgb, ${baseColor}, black 20%)`);
          s._cachedBodyGrad = bodyGrad;

          const bp = new Path2D();
          if (bp.roundRect) {
            bp.roundRect(-hw, -hd, hw * 2, hd * 2, cornerRadius);
          } else {
            bp.rect(-hw, -hd, hw * 2, hd * 2);
          }
          s._cachedBodyPath = bp;

          const barInset = Math.max(1, hw * 0.1);
          const barThickness = Math.max(1, hw * 0.06);
          const barWidth = Math.max(2, hd * 1.4);
          const hp = new Path2D();
          if (hp.roundRect) {
            hp.roundRect(hw - barInset - barThickness, -barWidth / 2, barThickness, barWidth, 1);
          } else {
            hp.rect(hw - barInset - barThickness, -barWidth / 2, barThickness, barWidth);
          }
          s._cachedHighlightPath = hp;
        }

        ctx.fillStyle = s._cachedBodyGrad;
        ctx.fill(s._cachedBodyPath);

        // Thin semi-transparent highlight bar
        ctx.fillStyle = "rgba(69, 71, 76, 0.70)";
        ctx.fill(s._cachedHighlightPath);

        // 1px stroke outline
        ctx.strokeStyle = "#4a4d52";
        ctx.lineWidth = 1;
        ctx.stroke(s._cachedBodyPath);

        // --- 4. DIRECTION INDICATOR ---
        // Proportionate to chassis size so it never distorts on different map scales
        const triTipX = hw * 0.85;
        const triBaseX = hw * 0.35;
        const triHalfW = Math.min(hd * 0.35, (triTipX - triBaseX) * 0.6);
        ctx.fillStyle = "rgba(230, 241, 251, 0.70)";
        ctx.beginPath();
        ctx.moveTo(triTipX, 0);
        ctx.lineTo(triBaseX, -triHalfW);
        ctx.lineTo(triBaseX, triHalfW);
        ctx.closePath();
        ctx.fill();



      } else if (s.type === "cylinder" || s.type === "sphere") {
        const pr = Math.max(1.5, (s.radius || 0.05) * scale);
        ctx.beginPath();
        ctx.arc(0, 0, pr, 0, Math.PI * 2);
        ctx.fillStyle = (s.color || "#4a4d52") + "dd";
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    });


  ctx.shadowBlur = 0;
  const robotRadiusPx = Math.max(10, maxR * scale);

  if (collisionActive) {
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 120);
    ctx.beginPath();
    ctx.arc(0, 0, robotRadiusPx + 5, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(239, 68, 68, ${0.5 + 0.4 * pulse})`;
    ctx.lineWidth = 3 + 2 * pulse;
    ctx.stroke();
  }

  const gapPx = 8;
  const arrowLenPx = 16;
  const arrowStart = robotRadiusPx + gapPx;
  const arrowEnd = arrowStart + arrowLenPx;

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(arrowStart, 0);
  ctx.lineTo(arrowEnd, 0);
  ctx.stroke();

  ctx.fillStyle = lineColor;
  ctx.beginPath();
  ctx.moveTo(arrowEnd + 2, 0);
  ctx.lineTo(arrowEnd - 5, -3.5);
  ctx.lineTo(arrowEnd - 5, 3.5);
  ctx.closePath();
  ctx.fill();

  const now = Date.now();
  const gunLength = 16;
  const gunWidth = 4;
  const hw = Math.max(10, maxR * scale);

  if (effectActive) {
    const elapsed = effectStartTime ? now - effectStartTime : 0;

    // --- Phase 0: Gun slides out (0-300ms) ---
    let gunOffset = 0;
    if (elapsed < 300) {
      gunOffset = -gunLength + (elapsed / 300) * gunLength;
    }

    // Draw TANK-LIKE BARREL sliding out
    ctx.fillStyle = "#37474f";
    ctx.fillRect(hw - 2 + gunOffset, -gunWidth / 2, gunLength, gunWidth);
    ctx.strokeStyle = "#263238";
    ctx.lineWidth = 1;
    ctx.strokeRect(hw - 2 + gunOffset, -gunWidth / 2, gunLength, gunWidth);

    // Muzzle
    ctx.fillStyle = "#263238";
    ctx.fillRect(hw + gunLength - 4 + gunOffset, -gunWidth / 2 - 1, 4, gunWidth + 2);

    // Flare shooting mechanics (starts after 300ms, loops every 1350ms)
    if (elapsed >= 300) {
      const loopElapsed = elapsed - 300;
      const tFlare = (loopElapsed % 1350) / 1350;
      const startX = hw + gunLength + gunOffset;

      if (tFlare < 0.6) {
        // Phase 1: Shoot "up"
        const progress = tFlare / 0.6;
        const flareX = startX + progress * 40;
        const flareSize = 4 + Math.pow(progress, 2) * 50;

        ctx.beginPath();
        ctx.moveTo(startX, 0);
        ctx.lineTo(flareX, 0);
        ctx.strokeStyle = "rgba(255, 100, 0, 0.4)";
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(flareX, 0, flareSize, 0, Math.PI * 2);
        ctx.fillStyle = "#ff5722";
        ctx.fill();
        ctx.shadowBlur = 20;
        ctx.shadowColor = "#ff5722";

        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(flareX, 0, flareSize * 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        // Phase 2: Explode
        const progress = (tFlare - 0.6) / 0.4;
        const explodeX = startX + 40;

        const numParticles = 24;
        const maxDist = 120;

        for (let i = 0; i < numParticles; i++) {
          const angle = (i / numParticles) * Math.PI * 2;
          const dist = progress * maxDist;
          const px = explodeX + Math.cos(angle) * dist;
          const py = Math.sin(angle) * dist;

          ctx.beginPath();
          ctx.arc(px, py, 6 * (1 - progress), 0, Math.PI * 2);
          ctx.fillStyle = i % 2 === 0 ? "#ff5722" : "#ffeb3b";
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(explodeX, 0, progress * maxDist * 1.2, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 87, 34, ${1 - progress})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Text label
        ctx.rotate(Math.PI / 2 + thetaRad);
        const blinkAlpha = (Math.floor(Date.now() / 80) % 2 === 0) ? (1 - progress) : 0;
        ctx.fillStyle = `rgba(255, 87, 34, ${blinkAlpha})`;
        ctx.font = "bold 16px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Mission Complete!!", 0, -Math.max(20, maxR * scale) - 30 - (progress * 20));
        ctx.rotate(-Math.PI / 2 - thetaRad);
      }
    }
  } else if (effectEndTime > 0 && now - effectEndTime < 300) {
    // --- Phase 3: Gun slides in (0-300ms after effect ends) ---
    const elapsedSinceEnd = now - effectEndTime;
    const gunOffset = - (elapsedSinceEnd / 300) * gunLength;

    // Draw TANK-LIKE BARREL sliding back in
    ctx.fillStyle = "#37474f";
    ctx.fillRect(hw - 2 + gunOffset, -gunWidth / 2, gunLength, gunWidth);
    ctx.strokeStyle = "#263238";
    ctx.lineWidth = 1;
    ctx.strokeRect(hw - 2 + gunOffset, -gunWidth / 2, gunLength, gunWidth);

    ctx.fillStyle = "#263238";
    ctx.fillRect(hw + gunLength - 4 + gunOffset, -gunWidth / 2 - 1, 4, gunWidth + 2);
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// normaliseMap
// ─────────────────────────────────────────────────────────────────────────────
export function normaliseMap(raw) {
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
export function buildTransform(mapInfo, canvasW, canvasH) {
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
  };
}
