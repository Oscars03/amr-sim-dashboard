import React, { useState, useEffect, useRef, useCallback } from 'react';

export default function MapEditor({ initialWalls = [] }) {
  const [walls, setWalls] = useState(initialWalls);
  const [startPoint, setStartPoint] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const canvasRef = useRef(null);

  // คำนวณพิกัดบน Canvas (สมมติ 1 เมตร = 50px)
  const SCALE = 50;
  const SNAP = 0.5; // Snap to 0.5m grid

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const rawX = (e.clientX - rect.left - 250) / SCALE;
    const rawY = -(e.clientY - rect.top - 250) / SCALE;
    // Snap to grid
    return [
      Math.round(rawX / SNAP) * SNAP,
      Math.round(rawY / SNAP) * SNAP
    ];
  };

  const handleMouseMove = (e) => setMousePos({ x: e.clientX, y: e.clientY });

  const handleMouseDown = (e) => {
    const [x, y] = getPos(e);
    if (!startPoint) {
      setStartPoint([x, y]);
    } else {
      setWalls([...walls, [startPoint, [x, y]]]);
      setStartPoint(null);
    }
  };

  // วาด Canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 500, 500);

    // Draw Grid
    ctx.strokeStyle = '#ddd';
    for(let i=0; i<500; i+=SCALE) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 500); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(500, i); ctx.stroke();
    }

    // Draw Existing Walls
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;
    walls.forEach(([p1, p2]) => {
      ctx.beginPath();
      ctx.moveTo(p1[0]*SCALE + 250, -p1[1]*SCALE + 250);
      ctx.lineTo(p2[0]*SCALE + 250, -p2[1]*SCALE + 250);
      ctx.stroke();
    });

    // Draw Ghost Line
    if (startPoint) {
      const [currX, currY] = getPos({clientX: mousePos.x, clientY: mousePos.y});
      ctx.strokeStyle = 'red';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(startPoint[0]*SCALE + 250, -startPoint[1]*SCALE + 250);
      ctx.lineTo(currX*SCALE + 250, -currY*SCALE + 250);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [walls, startPoint, mousePos]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <div>
      <h3>Map Editor (Snap: 0.5m)</h3>
      <canvas
        ref={canvasRef} width={500} height={500}
        style={{ background: '#fff', cursor: 'crosshair', border: '1px solid #000' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
      />
      <div>
        <button onClick={() => setWalls([])}>Clear</button>
        <button onClick={() => {
            const data = { name: "Edited Map", walls };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'map.json'; a.click();
        }}>Export JSON</button>
      </div>
    </div>
  );
}