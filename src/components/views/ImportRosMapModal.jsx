import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { convertRosMapToWorld, rotateRosMap } from '../../utils/rosMapImport.js';
import './ImportRosMapModal.css';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function ImportRosMapModal({ isDark, onCancel, onApply }) {
  const [step, setStep] = useState('upload'); // 'upload' | 'preview'

  // Files state
  const [pgmBuffer, setPgmBuffer] = useState(null);
  const [pgmName, setPgmName] = useState('');
  const [pgmSize, setPgmSize] = useState(0);

  const [yamlText, setYamlText] = useState(null);
  const [yamlName, setYamlName] = useState('');
  const [yamlSize, setYamlSize] = useState(0);

  const [fileError, setFileError] = useState('');
  const [dragOverCard, setDragOverCard] = useState(null); // 'pgm' | 'yaml' | 'any' | null

  // Conversion parameters
  const [simplifyM, setSimplifyM] = useState(0.10);
  const [minLoopVertices, setMinLoopVertices] = useState(8);
  const [closeGaps, setCloseGaps] = useState(true);

  // Preview interactive state: zoom, pan, rotation
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270 degrees

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const pgmInputRef = useRef(null);
  const yamlInputRef = useRef(null);
  const canvasRef = useRef(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Keep canvas resolution in sync with real container dimensions
  useEffect(() => {
    if (step !== 'preview') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const r = canvas.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setCanvasSize({ width: Math.round(r.width), height: Math.round(r.height) });
      }
    };

    updateSize();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        if (cr.width > 0 && cr.height > 0) {
          setCanvasSize({ width: Math.round(cr.width), height: Math.round(cr.height) });
        }
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [step]);

  // Handle single or multiple files
  const processFiles = useCallback(async (fileList) => {
    setFileError('');
    const files = Array.from(fileList || []);
    for (const f of files) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith('.pgm')) {
        const buf = await f.arrayBuffer();
        setPgmBuffer(buf);
        setPgmName(f.name);
        setPgmSize(f.size);
      } else if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
        const txt = await f.text();
        setYamlText(txt);
        setYamlName(f.name);
        setYamlSize(f.size);
      } else {
        setFileError(`"${f.name}" is neither a .pgm nor a .yaml file.`);
      }
    }
  }, []);

  const handlePgmChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pgm')) {
      setFileError(`"${file.name}" is not a .pgm file.`);
      return;
    }
    setFileError('');
    setPgmBuffer(await file.arrayBuffer());
    setPgmName(file.name);
    setPgmSize(file.size);
  }, []);

  const handleYamlChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.yaml') && !lower.endsWith('.yml')) {
      setFileError(`"${file.name}" is not a .yaml file.`);
      return;
    }
    setFileError('');
    setYamlText(await file.text());
    setYamlName(file.name);
    setYamlSize(file.size);
  }, []);

  // Compute conversion result
  const rawResult = useMemo(() => {
    if (!pgmBuffer || !yamlText) return null;
    try {
      return {
        ok: true,
        data: convertRosMapToWorld(pgmBuffer, yamlText, {
          simplifyM,
          minLoopVertices,
          closeGaps,
        }),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, [pgmBuffer, yamlText, simplifyM, minLoopVertices, closeGaps]);

  // Apply rotation
  const transformedResult = useMemo(() => {
    if (!rawResult || !rawResult.ok) return rawResult;
    return {
      ok: true,
      data: rotateRosMap(rawResult.data, rotation),
    };
  }, [rawResult, rotation]);

  const readyToPreview = Boolean(pgmBuffer && yamlText);
  const readyToImport = Boolean(transformedResult?.ok && transformedResult.data.walls.length > 0);
  const stats = rawResult?.ok ? rawResult.data.stats : null;
  const segments = transformedResult?.ok ? transformedResult.data.walls.length : 0;
  const heavy = segments > 1500;

  // Render preview on canvas
  useEffect(() => {
    if (step !== 'preview') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Canvas size from ResizeObserver or client dimensions
    const dpr = window.devicePixelRatio || 1;
    const W = canvasSize.width || canvas.clientWidth || 800;
    const H = canvasSize.height || canvas.clientHeight || 500;

    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = isDark ? '#0b0f17' : '#f8fafc';
    ctx.fillRect(0, 0, W, H);

    // Subtle background grid
    const gridSize = 40;
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gridOffsetX = (W / 2 + pan.x) % gridSize;
    const gridOffsetY = (H / 2 + pan.y) % gridSize;
    for (let x = gridOffsetX; x < W; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = gridOffsetY; y < H; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();

    if (!transformedResult?.ok || !transformedResult.data.walls.length) {
      ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        transformedResult?.error || 'No walls at these settings',
        W / 2,
        H / 2
      );
      return;
    }

    const { walls } = transformedResult.data;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [[x1, y1], [x2, y2]] of walls) {
      minX = Math.min(minX, x1, x2);
      maxX = Math.max(maxX, x1, x2);
      minY = Math.min(minY, y1, y2);
      maxY = Math.max(maxY, y1, y2);
    }

    const pad = 36;
    const spanX = Math.max(maxX - minX, 1e-4);
    const spanY = Math.max(maxY - minY, 1e-4);
    const scale0 = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
    const scale = scale0 * zoom;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const toCanvas = (wx, wy) => ({
      cx: W / 2 + (wx - centerX) * scale + pan.x,
      cy: H / 2 - (wy - centerY) * scale + pan.y,
    });

    // Draw origin (0, 0) rotated with the map
    const [origX, origY] = transformedResult.data.origin || [0, 0];
    const { cx: origCx, cy: origCy } = toCanvas(origX, origY);
    const rotRad = ((rotation || 0) * Math.PI) / 180;
    const axisLen = 30;

    if (origCx >= -40 && origCx <= W + 40 && origCy >= -40 && origCy <= H + 40) {
      // Rotated X Axis (Red) - starts Right, rotates CW
      const axEndX = origCx + Math.cos(rotRad) * axisLen;
      const axEndY = origCy + Math.sin(rotRad) * axisLen;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(origCx, origCy);
      ctx.lineTo(axEndX, axEndY);
      ctx.stroke();

      // Rotated Y Axis (Green) - starts Up, rotates CW
      const ayEndX = origCx + Math.sin(rotRad) * axisLen;
      const ayEndY = origCy - Math.cos(rotRad) * axisLen;
      ctx.strokeStyle = '#22c55e';
      ctx.beginPath();
      ctx.moveTo(origCx, origCy);
      ctx.lineTo(ayEndX, ayEndY);
      ctx.stroke();

      // Origin center dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(origCx, origCy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Draw walls
    ctx.strokeStyle = isDark ? '#38bdf8' : '#0284c7';
    ctx.lineWidth = Math.max(1.2, Math.min(2.5, 1.5 * zoom));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const [[x1, y1], [x2, y2]] of walls) {
      const p1 = toCanvas(x1, y1);
      const p2 = toCanvas(x2, y2);
      ctx.moveTo(p1.cx, p1.cy);
      ctx.lineTo(p2.cx, p2.cy);
    }
    ctx.stroke();

    // Draw coordinate axes widget in top-right (HUD indicator that rotates with map)
    const axOriginX = W - 45;
    const axOriginY = 45;
    const hudLen = 24;

    ctx.save();
    ctx.translate(axOriginX, axOriginY);
    ctx.rotate(rotRad);

    // X Axis (Right) - Red
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(hudLen, 0);
    ctx.stroke();

    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(hudLen + 4, 0);
    ctx.lineTo(hudLen - 3, -3.5);
    ctx.lineTo(hudLen - 3, 3.5);
    ctx.closePath();
    ctx.fill();

    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('X', hudLen + 6, 0);

    // Y Axis (Up) - Green
    ctx.strokeStyle = '#22c55e';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -hudLen);
    ctx.stroke();

    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.moveTo(0, -hudLen - 4);
    ctx.lineTo(-3.5, -hudLen + 3);
    ctx.lineTo(3.5, -hudLen + 3);
    ctx.closePath();
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Y', 0, -hudLen - 5);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }, [transformedResult, isDark, zoom, pan, step, canvasSize, rotation]);

  // Zoom on wheel anchored to cursor
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas || !transformedResult?.ok) return;

    const W = canvas.clientWidth || 800;
    const H = canvas.clientHeight || 500;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const { walls } = transformedResult.data;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [[x1, y1], [x2, y2]] of walls) {
      minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2);
      minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2);
    }
    const pad = 36;
    const spanX = Math.max(maxX - minX, 1e-4);
    const spanY = Math.max(maxY - minY, 1e-4);
    const scale0 = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
    const currentScale = scale0 * zoom;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const wx = (mx - W / 2 - pan.x) / currentScale + centerX;
    const wy = centerY - (my - H / 2 - pan.y) / currentScale;

    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const nextZoom = Math.min(Math.max(zoom * factor, 0.15), 25);
    const nextScale = scale0 * nextZoom;

    const nextPanX = mx - W / 2 - (wx - centerX) * nextScale;
    const nextPanY = my - H / 2 + (wy - centerY) * nextScale;

    setZoom(nextZoom);
    setPan({ x: nextPanX, y: nextPanY });
  }, [transformedResult, zoom, pan]);

  // Pan via pointer drag
  const handlePointerDown = (e) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  };

  const handlePointerUp = (e) => {
    isDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignored
    }
  };

  // Reset view to fit
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const rotateCw = () => setRotation((r) => (r + 90) % 360);
  const rotateCcw = () => setRotation((r) => (r - 90 + 360) % 360);
  const resetRotation = () => setRotation(0);

  // Drag and drop handlers for upload zones
  const handleDragOver = (e, cardType) => {
    e.preventDefault();
    setDragOverCard(cardType);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOverCard(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOverCard(null);
    if (e.dataTransfer?.files) {
      processFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      className="irm-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import ROS map"
        className={`irm-card ${step === 'preview' ? 'irm-step-preview' : 'irm-step-upload'} ${
          isDark ? 'irm-dark' : 'irm-light'
        }`}
      >
        {/* Header */}
        <div className="irm-header">
          <div className="irm-title-wrap">
            <h2 className="irm-title">Import ROS Map</h2>
            <p className="irm-subtitle">
              Convert Nav2 occupancy grid map (.pgm + .yaml) into simulator wall obstacles
            </p>
          </div>
          <button
            className="irm-close-btn"
            onClick={onCancel}
            title="Close"
            type="button"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Stepper Bar on top */}
        <div className="irm-stepper-wrap">
          <div className="irm-stepper">
            <button
              type="button"
              className={`irm-step-pill ${step === 'upload' ? 'active' : 'completed'} clickable`}
              onClick={() => setStep('upload')}
            >
              <span className="irm-step-badge">
                {step === 'preview' && pgmBuffer && yamlText ? '✓' : '1'}
              </span>
              <span>1. Upload Files</span>
            </button>

            <span className="irm-step-arrow">&gt;</span>

            <button
              type="button"
              className={`irm-step-pill ${step === 'preview' ? 'active' : ''} ${
                readyToPreview ? 'clickable' : ''
              }`}
              onClick={() => {
                if (readyToPreview) {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                  setStep('preview');
                }
              }}
              disabled={!readyToPreview}
            >
              <span className="irm-step-badge">2</span>
              <span>2. Preview & Adjust</span>
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="irm-body">
          {step === 'upload' ? (
            /* ── STEP 1: Upload Files ────────────────────────────────────────── */
            <div className="irm-upload-container">
              {fileError && <div className="irm-error-banner">{fileError}</div>}

              <div className="irm-upload-grid">
                {/* Card 1: PGM Map Image */}
                <div
                  className={`irm-dropzone ${pgmBuffer ? 'has-file' : ''} ${
                    dragOverCard === 'pgm' ? 'drag-over' : ''
                  }`}
                  onClick={() => pgmInputRef.current?.click()}
                  onDragOver={(e) => handleDragOver(e, 'pgm')}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <input
                    ref={pgmInputRef}
                    type="file"
                    accept=".pgm"
                    style={{ display: 'none' }}
                    onChange={handlePgmChange}
                  />
                  <div className="irm-drop-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </div>
                  <div className="irm-drop-title">Map Image (.pgm)</div>
                  <div className="irm-drop-desc">
                    Occupancy grid raster file written by map_saver
                  </div>

                  {pgmBuffer ? (
                    <div className="irm-file-status" onClick={(e) => e.stopPropagation()}>
                      <span className="irm-filename">✓ {pgmName}</span>
                      <span className="irm-filesize">{formatBytes(pgmSize)}</span>
                      <button
                        type="button"
                        className="irm-change-file-btn"
                        onClick={() => pgmInputRef.current?.click()}
                      >
                        Change file
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: '11.5px', color: '#3b82f6', fontWeight: 600 }}>
                      Click to select or drag & drop .pgm
                    </span>
                  )}
                </div>

                {/* Card 2: YAML Metadata */}
                <div
                  className={`irm-dropzone ${yamlText ? 'has-file' : ''} ${
                    dragOverCard === 'yaml' ? 'drag-over' : ''
                  }`}
                  onClick={() => yamlInputRef.current?.click()}
                  onDragOver={(e) => handleDragOver(e, 'yaml')}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <input
                    ref={yamlInputRef}
                    type="file"
                    accept=".yaml,.yml"
                    style={{ display: 'none' }}
                    onChange={handleYamlChange}
                  />
                  <div className="irm-drop-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                  </div>
                  <div className="irm-drop-title">Map Metadata (.yaml)</div>
                  <div className="irm-drop-desc">
                    Map YAML declaring origin, resolution, and thresholds
                  </div>

                  {yamlText ? (
                    <div className="irm-file-status" onClick={(e) => e.stopPropagation()}>
                      <span className="irm-filename">✓ {yamlName}</span>
                      <span className="irm-filesize">{formatBytes(yamlSize)}</span>
                      <button
                        type="button"
                        className="irm-change-file-btn"
                        onClick={() => yamlInputRef.current?.click()}
                      >
                        Change file
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: '11.5px', color: '#3b82f6', fontWeight: 600 }}>
                      Click to select or drag & drop .yaml
                    </span>
                  )}
                </div>
              </div>

              {/* Status Hint */}
              <div className={`irm-upload-hint-banner ${readyToPreview ? 'ready' : ''}`}>
                <span>
                  {readyToPreview
                    ? '✓ Both files loaded. Click "Next Step" to preview and adjust.'
                    : '• Please provide both .pgm and .yaml files to proceed.'}
                </span>
                <span style={{ fontSize: '11px', opacity: 0.8 }}>
                  Tip: You can drag and drop both files together at once
                </span>
              </div>
            </div>
          ) : (
            /* ── STEP 2: Preview & Adjust ────────────────────────────────────── */
            <div className="irm-preview-layout">
              {/* Canvas Area with Toolbar */}
              <div className="irm-canvas-container">
                {/* Floating Toolbar: Zoom, Pan, Rotate */}
                <div className="irm-canvas-toolbar">
                  {/* Zoom controls */}
                  <button
                    type="button"
                    className="irm-toolbar-btn"
                    onClick={() => setZoom((z) => Math.min(z * 1.25, 20))}
                    title="Zoom in"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="irm-toolbar-btn"
                    onClick={() => setZoom((z) => Math.max(z / 1.25, 0.2))}
                    title="Zoom out"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="irm-toolbar-btn"
                    onClick={handleResetView}
                    title="Fit to view"
                  >
                    Fit
                  </button>
                  <span className="irm-toolbar-badge">{Math.round(zoom * 100)}%</span>

                  <div className="irm-toolbar-divider" />

                  {/* Rotate controls */}
                  <button
                    type="button"
                    className="irm-toolbar-btn"
                    onClick={rotateCcw}
                    title="Rotate 90° counter-clockwise"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="irm-toolbar-btn"
                    onClick={rotateCw}
                    title="Rotate 90° clockwise"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                      <path d="M21 3v5h-5" />
                    </svg>
                  </button>
                  {rotation !== 0 && (
                    <button
                      type="button"
                      className="irm-toolbar-btn"
                      onClick={resetRotation}
                      title="Reset rotation to 0°"
                    >
                      Reset
                    </button>
                  )}
                  <span className="irm-toolbar-badge">{rotation}°</span>
                </div>

                {/* Canvas element */}
                <canvas
                  ref={canvasRef}
                  className="irm-preview-canvas"
                  onWheel={handleWheel}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                />

                {/* Scale Indicator */}
                <div className="irm-scale-indicator">
                  <span className="irm-scale-text">Pan: Drag | Zoom: Wheel / Toolbar</span>
                </div>
              </div>

              {/* Sidebar: Sliders, Options & Stats */}
              <div className="irm-sidebar">
                <div className="irm-setting-group">
                  <label htmlFor="irm-simplify" className="irm-label">
                    <span>Simplify tolerance</span>
                    <span className="irm-label-val">{simplifyM.toFixed(2)} m</span>
                  </label>
                  <input
                    id="irm-simplify"
                    type="range"
                    min="0.02"
                    max="0.50"
                    step="0.01"
                    value={simplifyM}
                    onChange={(e) => setSimplifyM(parseFloat(e.target.value))}
                  />
                  <span className="irm-hint">
                    Higher merges more detail into straight walls.
                  </span>
                </div>

                <div className="irm-setting-group">
                  <label htmlFor="irm-minloop" className="irm-label">
                    <span>Ignore blobs under</span>
                    <span className="irm-label-val">{minLoopVertices} px</span>
                  </label>
                  <input
                    id="irm-minloop"
                    type="range"
                    min="0"
                    max="40"
                    step="1"
                    value={minLoopVertices}
                    onChange={(e) => setMinLoopVertices(parseInt(e.target.value, 10))}
                  />
                  <span className="irm-hint">
                    Drops speckles and sensor noise.
                  </span>
                </div>

                <label className="irm-checkbox-label">
                  <input
                    type="checkbox"
                    checked={closeGaps}
                    onChange={(e) => setCloseGaps(e.target.checked)}
                  />
                  <span>Bridge 1-pixel gaps</span>
                </label>

                {/* Stats Card */}
                <div className="irm-stats-card">
                  <span className="irm-stats-title">Geometry Statistics</span>
                  {stats ? (
                    <>
                      <div className="irm-stats-row">
                        <span>Wall segments:</span>
                        <span className="irm-stats-val">{segments}</span>
                      </div>
                      <div className="irm-stats-row">
                        <span>Resolution:</span>
                        <span className="irm-stats-val">{stats.resolution} m/px</span>
                      </div>
                      <div className="irm-stats-row">
                        <span>Raster size:</span>
                        <span className="irm-stats-val">
                          {stats.imageWidth} × {stats.imageHeight} px
                        </span>
                      </div>
                      <div className="irm-stats-row">
                        <span>Physical size:</span>
                        <span className="irm-stats-val">
                          {(stats.imageWidth * stats.resolution).toFixed(1)} ×{' '}
                          {(stats.imageHeight * stats.resolution).toFixed(1)} m
                        </span>
                      </div>
                      <div className="irm-stats-row">
                        <span>Contours:</span>
                        <span className="irm-stats-val">
                          {stats.contoursKept} / {stats.contoursFound} kept
                        </span>
                      </div>
                      <div className="irm-stats-row">
                        <span>Applied rotation:</span>
                        <span className="irm-stats-val">{rotation}°</span>
                      </div>
                    </>
                  ) : (
                    <span>Awaiting conversion…</span>
                  )}
                </div>

                {heavy && (
                  <div className="irm-warn-box">
                    ⚠️ {segments} segments is a lot of geometry. Raise simplify tolerance to avoid slowing simulation.
                  </div>
                )}

                {stats && stats.originYaw !== 0 && (
                  <div className="irm-warn-box">
                    ℹ️ Map declares origin yaw ({stats.originYaw.toFixed(3)} rad). Use the rotate buttons above if adjustment is needed.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="irm-footer">
          {step === 'upload' ? (
            <>
              <button
                type="button"
                className="irm-btn irm-btn-secondary"
                onClick={onCancel}
              >
                Cancel
              </button>
              <div className="irm-footer-right">
                <button
                  type="button"
                  className="irm-btn irm-btn-primary"
                  disabled={!readyToPreview}
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                    setStep('preview');
                  }}
                >
                  Next Step &gt;
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                className="irm-btn irm-btn-secondary"
                onClick={onCancel}
              >
                Cancel
              </button>
              <div className="irm-footer-right">
                <button
                  type="button"
                  className="irm-btn irm-btn-secondary"
                  onClick={() => setStep('upload')}
                >
                  &lt; Back
                </button>
                <button
                  type="button"
                  className="irm-btn irm-btn-success"
                  disabled={!readyToImport}
                  onClick={() => {
                    if (readyToImport) {
                      onApply(transformedResult.data, pgmName);
                    }
                  }}
                >
                  Done {segments > 0 ? `(${segments} walls)` : ''}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
