import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { convertRosMapToWorld } from '../../utils/rosMapImport.js';

/**
 * Import a ROS occupancy-grid map (.pgm + .yaml) and convert it to world walls.
 *
 * The conversion is lossy by nature — a raster has no notion of "wall segment",
 * so the result depends on how aggressively contours are simplified. That is
 * why this is a preview dialog rather than a one-click action: the operator
 * needs to see the traced geometry and the segment count before committing it,
 * since an over-simplified map loses doorways and an under-simplified one
 * carries thousands of segments into the simulator.
 */
export default function ImportRosMapModal({ isDark, onCancel, onApply }) {
  const [pgmBuffer, setPgmBuffer] = useState(null);
  const [yamlText, setYamlText] = useState(null);
  const [pgmName, setPgmName] = useState('');
  const [yamlName, setYamlName] = useState('');
  const [fileError, setFileError] = useState('');

  const [simplifyM, setSimplifyM] = useState(0.10);
  const [minLoopVertices, setMinLoopVertices] = useState(8);
  const [closeGaps, setCloseGaps] = useState(true);

  const previewRef = useRef(null);

  const handleFiles = useCallback(async (fileList) => {
    setFileError('');
    const files = Array.from(fileList || []);
    for (const f of files) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith('.pgm')) {
        setPgmBuffer(await f.arrayBuffer());
        setPgmName(f.name);
      } else if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
        setYamlText(await f.text());
        setYamlName(f.name);
      } else {
        setFileError(`"${f.name}" is neither a .pgm nor a .yaml file.`);
      }
    }
  }, []);

  // Recomputed on every parameter change. Measured at 21-64 ms for a
  // 656x1284 map, which is fast enough to run synchronously on each edit.
  const result = useMemo(() => {
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

  // Draw the traced walls so the operator can confirm the shape survived
  // simplification before importing it.
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = isDark ? '#11151c' : '#f5f7fa';
    ctx.fillRect(0, 0, W, H);

    if (!result?.ok || !result.data.walls.length) {
      ctx.fillStyle = isDark ? '#5b6675' : '#98a2b3';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        result?.ok ? 'No walls at these settings' : 'Select both files to preview',
        W / 2, H / 2
      );
      return;
    }

    const { walls } = result.data;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [[x1, y1], [x2, y2]] of walls) {
      minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2);
      minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2);
    }
    const pad = 12;
    const spanX = Math.max(maxX - minX, 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
    const offX = (W - spanX * scale) / 2;
    const offY = (H - spanY * scale) / 2;
    // Canvas y grows downward, world y grows upward.
    const sx = (x) => offX + (x - minX) * scale;
    const sy = (y) => H - (offY + (y - minY) * scale);

    ctx.strokeStyle = isDark ? '#6fa8e8' : '#1f5fa9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [[x1, y1], [x2, y2]] of walls) {
      ctx.moveTo(sx(x1), sy(y1));
      ctx.lineTo(sx(x2), sy(y2));
    }
    ctx.stroke();
  }, [result, isDark]);

  const bg = isDark ? '#1a1f27' : '#ffffff';
  const fg = isDark ? '#e4eaf0' : '#161d26';
  const sub = isDark ? '#9aa7b4' : '#5a6673';
  const border = isDark ? '#2c3540' : '#dde4eb';
  const inputBg = isDark ? '#131820' : '#f7f9fb';

  const stats = result?.ok ? result.data.stats : null;
  const segments = stats?.wallSegments ?? 0;
  const heavy = segments > 1500;
  const ready = result?.ok && segments > 0;

  const labelStyle = { display: 'block', fontSize: 12, color: sub, marginBottom: 4 };
  const rowStyle = { display: 'flex', flexDirection: 'column', gap: 4 };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import ROS map"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: bg, color: fg, borderRadius: 10, border: `1px solid ${border}`,
        width: 'min(860px, 94vw)', maxHeight: '92vh', overflowY: 'auto',
        padding: 22, boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
      }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 19 }}>Import ROS map</h2>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: sub, maxWidth: '62ch' }}>
          Converts an occupancy grid from <code>map_saver_cli</code> into wall segments.
          Tracing is approximate — check the preview before importing.
        </p>

        {/* Files */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Map files (.pgm and .yaml)</label>
          <input
            type="file"
            multiple
            accept=".pgm,.yaml,.yml"
            onChange={(e) => handleFiles(e.target.files)}
            style={{
              width: '100%', padding: 9, background: inputBg, color: fg,
              border: `1px solid ${border}`, borderRadius: 6, fontSize: 13,
            }}
          />
          <div style={{ fontSize: 12, color: sub, marginTop: 6 }}>
            {pgmName ? `✓ ${pgmName}` : '• .pgm not selected'}
            {'   '}
            {yamlName ? `✓ ${yamlName}` : '• .yaml not selected'}
          </div>
          {fileError && (
            <div style={{ fontSize: 12, color: '#e0605c', marginTop: 6 }}>{fileError}</div>
          )}
        </div>

        {/* Preview + controls */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 240px',
          gap: 18, alignItems: 'start',
        }}>
          <div>
            <canvas
              ref={previewRef}
              width={520}
              height={340}
              style={{
                width: '100%', height: 'auto', border: `1px solid ${border}`,
                borderRadius: 6, display: 'block',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={rowStyle}>
              <label htmlFor="imp-simplify" style={labelStyle}>
                Simplify tolerance — {simplifyM.toFixed(2)} m
              </label>
              <input
                id="imp-simplify" type="range" min="0.02" max="0.50" step="0.01"
                value={simplifyM}
                onChange={(e) => setSimplifyM(parseFloat(e.target.value))}
              />
              <span style={{ fontSize: 11, color: sub }}>
                Higher merges more detail into straight walls.
              </span>
            </div>

            <div style={rowStyle}>
              <label htmlFor="imp-minloop" style={labelStyle}>
                Ignore blobs under — {minLoopVertices} px
              </label>
              <input
                id="imp-minloop" type="range" min="0" max="40" step="1"
                value={minLoopVertices}
                onChange={(e) => setMinLoopVertices(parseInt(e.target.value, 10))}
              />
              <span style={{ fontSize: 11, color: sub }}>
                Drops scanning speckle.
              </span>
            </div>

            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={closeGaps}
                onChange={(e) => setCloseGaps(e.target.checked)}
              />
              Bridge 1-pixel gaps
            </label>

            <div style={{
              borderTop: `1px solid ${border}`, paddingTop: 12,
              fontSize: 12, color: sub, lineHeight: 1.75,
            }}>
              {result?.ok ? (
                <>
                  <div><b style={{ color: fg }}>{segments}</b> wall segments</div>
                  <div>{stats.imageWidth} × {stats.imageHeight} px @ {stats.resolution} m</div>
                  <div>
                    {(stats.imageWidth * stats.resolution).toFixed(1)} ×{' '}
                    {(stats.imageHeight * stats.resolution).toFixed(1)} m
                  </div>
                  <div>{stats.contoursKept} of {stats.contoursFound} contours kept</div>
                </>
              ) : result ? (
                <span style={{ color: '#e0605c' }}>{result.error}</span>
              ) : (
                <span>Awaiting files…</span>
              )}
            </div>

            {heavy && (
              <div style={{
                fontSize: 12, color: isDark ? '#d9a34a' : '#8a5a08',
                background: isDark ? '#2c2418' : '#fbf1df',
                border: `1px solid ${isDark ? '#4a3c22' : '#e8d5a8'}`,
                borderRadius: 5, padding: '8px 10px', lineHeight: 1.5,
              }}>
                {segments} segments is a lot of geometry. Raise the simplify
                tolerance unless you need this much detail.
              </div>
            )}

            {result?.ok && stats.originYaw !== 0 && (
              <div style={{
                fontSize: 12, color: isDark ? '#d9a34a' : '#8a5a08',
                background: isDark ? '#2c2418' : '#fbf1df',
                border: `1px solid ${isDark ? '#4a3c22' : '#e8d5a8'}`,
                borderRadius: 5, padding: '8px 10px', lineHeight: 1.5,
              }}>
                This map declares a non-zero origin yaw ({stats.originYaw.toFixed(3)} rad),
                which is not applied. The imported walls will be rotated relative
                to the original map.
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '9px 18px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
              background: 'transparent', color: fg, border: `1px solid ${border}`,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => ready && onApply(result.data, pgmName)}
            disabled={!ready}
            style={{
              padding: '9px 18px', borderRadius: 6, fontSize: 13,
              cursor: ready ? 'pointer' : 'not-allowed',
              background: ready ? '#1f5fa9' : (isDark ? '#2a323d' : '#dfe5ec'),
              color: ready ? '#fff' : sub,
              border: '1px solid transparent', fontWeight: 600,
            }}
          >
            Import {segments > 0 ? `${segments} walls` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
