import { describe, it, expect } from 'vitest';
import {
  parsePgm,
  parseMapYaml,
  computeOccupancy,
  morphClose,
  traceCrackContours,
  simplifyRdp,
  gridVertexToWorld,
  convertRosMapToWorld,
  rotateRosMap,
} from '../utils/rosMapImport.js';

/** Build a binary P5 PGM from a 2D array of greyscale values. */
function makePgm(rows, { comment = false } = {}) {
  const h = rows.length;
  const w = rows[0].length;
  const header = comment
    ? `P5\n# made by test\n${w} ${h}\n255\n`
    : `P5\n${w} ${h}\n255\n`;
  const head = new TextEncoder().encode(header);
  const body = new Uint8Array(w * h);
  let i = 0;
  for (const row of rows) for (const v of row) body[i++] = v;
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

const YAML_SAMPLE = `image: F4_2F.pgm
mode: trinary
resolution: 0.050
origin: [-8.747, -38.086, 0]
negate: 0
occupied_thresh: 0.65
free_thresh: 0.196`;

describe('parsePgm', () => {
  it('reads dimensions and pixel data', () => {
    const pgm = parsePgm(makePgm([[0, 255], [128, 64]]));
    expect(pgm.width).toBe(2);
    expect(pgm.height).toBe(2);
    expect(pgm.maxVal).toBe(255);
    expect(Array.from(pgm.pixels)).toEqual([0, 255, 128, 64]);
  });

  it('skips comment lines in the header', () => {
    const pgm = parsePgm(makePgm([[1, 2], [3, 4]], { comment: true }));
    expect(pgm.width).toBe(2);
    expect(Array.from(pgm.pixels)).toEqual([1, 2, 3, 4]);
  });

  it('rejects a non-P5 file with an actionable message', () => {
    const ascii = new TextEncoder().encode('P2\n2 2\n255\n0 0 0 0\n');
    expect(() => parsePgm(ascii)).toThrow(/Expected binary PGM \(P5\)/);
  });

  it('rejects a truncated image rather than returning short data', () => {
    const good = makePgm([[0, 0], [0, 0]]);
    expect(() => parsePgm(good.subarray(0, good.length - 2))).toThrow(/truncated/);
  });
});

describe('parseMapYaml', () => {
  it('parses the nav2 map_saver format', () => {
    const m = parseMapYaml(YAML_SAMPLE);
    expect(m.resolution).toBe(0.05);
    expect(m.origin).toEqual([-8.747, -38.086, 0]);
    expect(m.negate).toBe(0);
    expect(m.occupied_thresh).toBe(0.65);
    expect(m.image).toBe('F4_2F.pgm');
  });

  it('applies nav2 defaults when optional keys are absent', () => {
    const m = parseMapYaml('resolution: 0.05\norigin: [0, 0, 0]');
    expect(m.negate).toBe(0);
    expect(m.occupied_thresh).toBe(0.65);
    expect(m.free_thresh).toBe(0.196);
  });

  it('throws when a required key is missing', () => {
    expect(() => parseMapYaml('resolution: 0.05')).toThrow(/missing required field\(s\): origin/);
  });

  it('ignores comments', () => {
    const m = parseMapYaml('resolution: 0.05 # metres per pixel\norigin: [1, 2, 0]');
    expect(m.resolution).toBe(0.05);
    expect(m.origin).toEqual([1, 2, 0]);
  });
});

describe('computeOccupancy', () => {
  it('treats dark pixels as occupied when negate is 0', () => {
    const mask = computeOccupancy(new Uint8Array([0, 205, 254]), { negate: 0 });
    expect(Array.from(mask)).toEqual([1, 0, 0]);
  });

  it('inverts the mapping when negate is 1', () => {
    const mask = computeOccupancy(new Uint8Array([0, 254]), { negate: 1 });
    expect(Array.from(mask)).toEqual([0, 1]);
  });

  it('leaves trinary unknown (205) unoccupied', () => {
    // Importing unknown space as geometry would wall off unexplored regions.
    const mask = computeOccupancy(new Uint8Array([205]), { negate: 0 });
    expect(mask[0]).toBe(0);
  });
});

describe('morphClose', () => {
  it('bridges a single-pixel gap in a wall', () => {
    // 1 1 0 1 1  -> the gap should close
    const mask = new Uint8Array([1, 1, 0, 1, 1]);
    const out = morphClose(mask, 5, 1);
    expect(out[2]).toBe(1);
  });

  it('does not grow an isolated blob', () => {
    const mask = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const out = morphClose(mask, 3, 3);
    expect(Array.from(out)).toEqual(Array.from(mask));
  });
});

describe('traceCrackContours', () => {
  it('traces a single cell as a closed 4-edge loop', () => {
    const loops = traceCrackContours(new Uint8Array([1]), 1, 1);
    expect(loops).toHaveLength(1);
    const loop = loops[0];
    // Closed: first vertex repeated at the end.
    expect(loop[0]).toEqual(loop[loop.length - 1]);
    expect(loop.length).toBe(5);
  });

  it('traces two disjoint blobs as two loops', () => {
    // 1 0 1
    const loops = traceCrackContours(new Uint8Array([1, 0, 1]), 3, 1);
    expect(loops).toHaveLength(2);
  });

  it('produces vertices on integer grid intersections', () => {
    const loops = traceCrackContours(new Uint8Array([1]), 1, 1);
    for (const [x, y] of loops[0]) {
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
    }
  });

  it('returns nothing for an empty mask', () => {
    expect(traceCrackContours(new Uint8Array([0, 0, 0, 0]), 2, 2)).toHaveLength(0);
  });
});

describe('simplifyRdp', () => {
  it('collapses collinear points to the two endpoints', () => {
    const pts = [[0, 0], [1, 0], [2, 0], [3, 0]];
    expect(simplifyRdp(pts, 0.01)).toEqual([[0, 0], [3, 0]]);
  });

  it('keeps a corner that exceeds the tolerance', () => {
    const pts = [[0, 0], [1, 5], [2, 0]];
    expect(simplifyRdp(pts, 0.5)).toHaveLength(3);
  });

  it('drops a deviation below the tolerance', () => {
    const pts = [[0, 0], [1, 0.1], [2, 0]];
    expect(simplifyRdp(pts, 0.5)).toEqual([[0, 0], [2, 0]]);
  });

  it('handles a long polyline without recursion overflow', () => {
    const pts = Array.from({ length: 50000 }, (_, i) => [i, i % 2 === 0 ? 0 : 0.001]);
    expect(() => simplifyRdp(pts, 0.5)).not.toThrow();
  });
});

describe('gridVertexToWorld', () => {
  const opts = { originX: -8.747, originY: -38.086, resolution: 0.05, height: 1284 };

  it('maps the bottom-left grid vertex to the YAML origin', () => {
    // ROS origin is the world pose of the image's LOWER-LEFT corner, which is
    // grid vertex (0, height) once the row axis is flipped.
    const [x, y] = gridVertexToWorld(0, opts.height, opts);
    expect(x).toBeCloseTo(-8.747, 6);
    expect(y).toBeCloseTo(-38.086, 6);
  });

  it('flips the row axis, so image row 0 is the TOP of the world', () => {
    const [, yTop] = gridVertexToWorld(0, 0, opts);
    const [, yBottom] = gridVertexToWorld(0, opts.height, opts);
    expect(yTop).toBeGreaterThan(yBottom);
    expect(yTop - yBottom).toBeCloseTo(opts.height * opts.resolution, 6);
  });
});

describe('convertRosMapToWorld', () => {
  // A hollow 6x6 room: border occupied, interior free.
  const roomRows = Array.from({ length: 6 }, (_, r) =>
    Array.from({ length: 6 }, (_, c) =>
      (r === 0 || r === 5 || c === 0 || c === 5) ? 0 : 254
    )
  );
  const roomYaml = 'resolution: 1.0\norigin: [0, 0, 0]\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.196';

  it('emits axis-aligned walls for a rectangular room', () => {
    const res = convertRosMapToWorld(makePgm(roomRows), roomYaml, {
      simplifyM: 0.5, minLoopVertices: 4, closeGaps: false,
    });
    expect(res.walls.length).toBeGreaterThan(0);
    for (const [[x1, y1], [x2, y2]] of res.walls) {
      const axisAligned = (x1 === x2) || (y1 === y2);
      expect(axisAligned).toBe(true);
    }
  });

  it('computes map_info extents in metres', () => {
    const res = convertRosMapToWorld(makePgm(roomRows), roomYaml, { closeGaps: false });
    expect(res.mapInfo).toEqual({ origin_x: 0, origin_y: 0, width: 6, height: 6 });
  });

  it('keeps every wall inside the declared map extent', () => {
    const res = convertRosMapToWorld(makePgm(roomRows), roomYaml, {
      simplifyM: 0.5, minLoopVertices: 4, closeGaps: false,
    });
    for (const seg of res.walls) {
      for (const [x, y] of seg) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(6);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(6);
      }
    }
  });

  it('emits no walls for a fully-free map', () => {
    const free = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 254));
    const res = convertRosMapToWorld(makePgm(free), roomYaml, { closeGaps: false });
    expect(res.walls).toEqual([]);
    expect(res.stats.occupiedPixels).toBe(0);
  });

  it('emits no walls for a fully-unknown map', () => {
    // Trinary unknown must not become geometry.
    const unknown = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 205));
    const res = convertRosMapToWorld(makePgm(unknown), roomYaml, { closeGaps: false });
    expect(res.walls).toEqual([]);
  });

  it('produces fewer segments as the simplify tolerance grows', () => {
    const fine = convertRosMapToWorld(makePgm(roomRows), roomYaml, {
      simplifyM: 0.01, minLoopVertices: 4, closeGaps: false,
    });
    const coarse = convertRosMapToWorld(makePgm(roomRows), roomYaml, {
      simplifyM: 2.0, minLoopVertices: 4, closeGaps: false,
    });
    expect(coarse.walls.length).toBeLessThanOrEqual(fine.walls.length);
  });

  it('reports stats that let the UI warn about heavy geometry', () => {
    const res = convertRosMapToWorld(makePgm(roomRows), roomYaml, { closeGaps: false });
    expect(res.stats).toMatchObject({
      imageWidth: 6,
      imageHeight: 6,
      resolution: 1.0,
    });
    expect(res.stats.wallSegments).toBe(res.walls.length);
  });

  it('produces walls in the exact shape the world format expects', () => {
    const res = convertRosMapToWorld(makePgm(roomRows), roomYaml, {
      simplifyM: 0.5, minLoopVertices: 4, closeGaps: false,
    });
    // [[x1,y1],[x2,y2]] — same as Nav_01.json's "walls" entries.
    for (const seg of res.walls) {
      expect(seg).toHaveLength(2);
      expect(seg[0]).toHaveLength(2);
      expect(seg[1]).toHaveLength(2);
      expect(seg.flat().every(Number.isFinite)).toBe(true);
    }
  });
});

describe('rotateRosMap', () => {
  const sampleMap = {
    walls: [
      [[0, 0], [10, 0]],
      [[10, 0], [10, 5]],
      [[10, 5], [0, 5]],
      [[0, 5], [0, 0]],
    ],
    mapInfo: {
      origin_x: 0,
      origin_y: 0,
      width: 10,
      height: 5,
    },
  };

  it('returns data unchanged when rotation is 0', () => {
    const res = rotateRosMap(sampleMap, 0);
    expect(res).toBe(sampleMap);
  });

  it('swaps width and height and preserves bounding box area on 90 deg rotation', () => {
    const res = rotateRosMap(sampleMap, 90);
    expect(res.mapInfo.width).toBeCloseTo(5, 2);
    expect(res.mapInfo.height).toBeCloseTo(10, 2);
    expect(res.walls).toHaveLength(4);
  });

  it('preserves geometry and returns to identical bounds on 360 deg rotation', () => {
    const res = rotateRosMap(sampleMap, 360);
    expect(res.mapInfo.width).toBeCloseTo(10, 2);
    expect(res.mapInfo.height).toBeCloseTo(5, 2);
    expect(res.mapInfo.origin_x).toBeCloseTo(0, 2);
    expect(res.mapInfo.origin_y).toBeCloseTo(0, 2);
    expect(res.origin[0]).toBeCloseTo(0, 2);
    expect(res.origin[1]).toBeCloseTo(0, 2);
  });

  it('rotates origin point around map center on 90 deg rotation', () => {
    const res = rotateRosMap(sampleMap, 90);
    expect(res.origin).toBeDefined();
    expect(Number.isFinite(res.origin[0])).toBe(true);
    expect(Number.isFinite(res.origin[1])).toBe(true);
  });
});

