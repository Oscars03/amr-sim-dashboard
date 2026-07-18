import React, { useEffect, useRef } from 'react';
import './UpdateProgressModal.css';
import iconCircleTransparent from '/icon_circle_transparent.png?url';

const samplePointsFromImage = (img, size) => {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = size;
  tempCanvas.height = size;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(img, 0, 0, size, size);
  const imgData = tempCtx.getImageData(0, 0, size, size);
  const data = imgData.data;
  const pts = [];
  const step = 3; // 3px sampling grid
  const half = size / 2;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const idx = (y * size + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      // Sample non-transparent pattern pixels (dark/blue lines of the logo)
      if (a > 50 && (r < 220 || g < 220 || b < 220)) {
        pts.push({
          x: x - half,
          y: y - half,
          brightness: 0
        });
      }
    }
  }
  return pts;
};

function LidarMap({ percent }) {
  const canvasRef = useRef(null);
  const exploredCanvasRef = useRef(document.createElement('canvas'));
  const logoImgRef = useRef(null);
  const imagePointsRef = useRef([]);

  useEffect(() => {
    exploredCanvasRef.current.width = 270;
    exploredCanvasRef.current.height = 270;

    const img = new Image();
    img.src = iconCircleTransparent;
    img.onload = () => {
      logoImgRef.current = img;
      imagePointsRef.current = samplePointsFromImage(img, 270);
    };
  }, []);

  const targetPercentRef = useRef(percent);
  const currentPercentRef = useRef(percent);

  useEffect(() => {
    targetPercentRef.current = percent;
  }, [percent]);

  // Clear explored mask when resetting/starting
  useEffect(() => {
    if (percent <= 2 && exploredCanvasRef.current) {
      const eCtx = exploredCanvasRef.current.getContext('2d');
      eCtx.clearRect(0, 0, 270, 270);
    }
  }, [percent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const eCtx = exploredCanvasRef.current.getContext('2d');
    let animationId;

    const render = () => {
      ctx.clearRect(0, 0, 270, 270);
      
      let current = currentPercentRef.current;
      let target = targetPercentRef.current;
      if (current < target) {
        current += (target - current) * 0.05;
        if (target - current < 0.1) current = target;
      }
      currentPercentRef.current = current;

      const time = Date.now() % 2500;
      let sweepAngle = (time / 2500) * Math.PI * 2 - Math.PI / 2;
      if (sweepAngle > Math.PI) sweepAngle -= Math.PI * 2;

      // Calculate robot position along a coverage spiral based on percent
      const p = current / 100;
      const radius = 100 * Math.sqrt(p);
      const angle = p * 8 * Math.PI;
      const robotX = radius * Math.cos(angle);
      const robotY = radius * Math.sin(angle);

      // Unmask explored area in offscreen canvas
      eCtx.save();
      eCtx.translate(135, 135);
      eCtx.beginPath();
      eCtx.arc(robotX, robotY, 50, 0, Math.PI * 2); // 50px sensor radius
      eCtx.fillStyle = '#ffffff';
      eCtx.fill();

      // Ensure 100% revealed when download finishes
      if (p >= 0.98) {
        eCtx.beginPath();
        eCtx.arc(0, 0, 140, 0, Math.PI * 2);
        eCtx.fill();
      }
      eCtx.restore();

      // Draw masked logo onto main canvas
      if (logoImgRef.current) {
        ctx.save();
        // 1. Draw the mask
        ctx.drawImage(exploredCanvasRef.current, 0, 0);
        // 2. Composite source-in to clip logo to mask
        ctx.globalCompositeOperation = 'source-in';
        ctx.drawImage(logoImgRef.current, 0, 0, 270, 270);
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
      }

      ctx.save();
      ctx.translate(135, 135);

      // Draw active Lidar scan points sampled directly from image picture shape
      const pts = imagePointsRef.current;
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        
        const dx = pt.x - robotX;
        const dy = pt.y - robotY;
        const dist = Math.hypot(dx, dy);
        
        // If within scan radius of the robot
        if (dist <= 50) {
          let ptAngle = Math.atan2(dy, dx);
          let angDiff = sweepAngle - ptAngle;
          while (angDiff < -Math.PI) angDiff += Math.PI * 2;
          while (angDiff > Math.PI) angDiff -= Math.PI * 2;

          if (angDiff > 0 && angDiff < 0.35) {
            pt.brightness = 1.0;
          } else {
            pt.brightness *= 0.94;
          }
        } else {
           pt.brightness *= 0.94;
        }

        if (pt.brightness > 0.05) {
          ctx.fillStyle = `rgba(56, 180, 255, ${pt.brightness})`;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.5, 0, Math.PI * 2);
          ctx.fill();
          
          if (pt.brightness > 0.8) {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 0.8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Draw visible rotating Lidar beam centered at robot position
      ctx.save();
      ctx.translate(robotX, robotY);
      
      // Rotating beam cone gradient
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 50, sweepAngle - 0.25, sweepAngle + 0.25);
      ctx.closePath();
      const beamGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 50);
      beamGrad.addColorStop(0, 'rgba(56, 180, 255, 0.45)');
      beamGrad.addColorStop(1, 'rgba(56, 180, 255, 0.0)');
      ctx.fillStyle = beamGrad;
      ctx.fill();

      // Rotating laser line
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(50 * Math.cos(sweepAngle), 50 * Math.sin(sweepAngle));
      ctx.strokeStyle = 'rgba(133, 220, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();

      // Draw Robot (green triangle)
      ctx.save();
      ctx.translate(robotX, robotY);
      // Tangent direction along spiral
      const dr_dp = 100 / (2 * Math.max(0.01, Math.sqrt(p)));
      const dtheta_dp = 8 * Math.PI;
      const vx = dr_dp * Math.cos(angle) - radius * Math.sin(angle) * dtheta_dp;
      const vy = dr_dp * Math.sin(angle) + radius * Math.cos(angle) * dtheta_dp;
      ctx.rotate(Math.atan2(vy, vx));
      
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-5, 5);
      ctx.lineTo(-5, -5);
      ctx.closePath();
      ctx.fillStyle = '#4caf50';
      ctx.shadowColor = '#4caf50';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.restore();

      ctx.restore();
      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, []);

  return <canvas ref={canvasRef} width={270} height={270} className="upm-scan-canvas" style={{position: 'absolute', top: 0, left: 0}} />;
}

export default function UpdateProgressModal({ updateInfo, appVersion, onClose }) {
  if (!updateInfo) return null;
  
  if (updateInfo.status !== 'available' && updateInfo.status !== 'downloading' && updateInfo.status !== 'downloaded') {
    return null;
  }

  if (updateInfo.status === 'available') {
    const handleStartDownload = () => {
      if (window.electronAPI) {
        window.electronAPI.startDownload?.();
      }
    };

    return (
      <div className="upm-overlay">
        <div className="upm-card">
          <button className="upm-close-btn" onClick={onClose} title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <div style={{ padding: '8px 4px 16px' }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(43, 92, 217, 0.15)',
              border: '1px solid rgba(43, 92, 217, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              color: '#64b5f6'
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </div>

            <h2 className="upm-title">Update Available</h2>
            <p className="upm-subtitle" style={{ marginBottom: '16px' }}>
              {appVersion} &rarr; {updateInfo.version || '0.3.0'}
            </p>

            <p style={{ fontSize: '13px', color: '#B4B2A9', lineHeight: 1.5, margin: '0 0 24px 0' }}>
              A new version of IRiSH AMR Simulation is ready for update. Would you like to download and install it now?
            </p>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                onClick={onClose}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#ccc',
                  padding: '12px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Later
              </button>
              <button 
                onClick={handleStartDownload}
                style={{
                  flex: 1,
                  background: '#2b5cd9',
                  border: 'none',
                  color: '#fff',
                  padding: '12px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(43,92,217,0.4)'
                }}
              >
                Update Now
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isDownloaded = updateInfo.status === 'downloaded';
  const percent = isDownloaded ? 100 : (updateInfo.percent ?? updateInfo.progress ?? 0);

  const handleRestart = () => {
    if (window.electronAPI) {
      window.electronAPI.restartApp?.();
    }
  };

  return (
    <div className="upm-overlay">
      <div className="upm-card">
        {/* Optional close button for when downloaded */}
        {isDownloaded && (
          <button className="upm-close-btn" onClick={onClose} title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        )}

        <h2 className="upm-title">Updating firmware</h2>
        <p className="upm-subtitle">
          {appVersion} &rarr; {updateInfo.version || 'New Version'}
        </p>

        <div className="upm-scan-container">
          {/* Real-time Lidar Scan Map */}
          <LidarMap percent={percent} />
        </div>

        <div className="upm-progress-track">
          <div 
            className="upm-progress-fill" 
            style={{ width: `${percent}%` }}
          ></div>
        </div>

        <div className="upm-progress-labels">
          <span className="upm-label-left">
            {isDownloaded ? 'Update ready — restart to apply' : 'Downloading update'}
          </span>
          <span className="upm-label-right">
            {percent}%
          </span>
        </div>

        {isDownloaded && (
          <button className="upm-restart-btn" onClick={handleRestart}>
            Restart now
          </button>
        )}

      </div>
    </div>
  );
}
