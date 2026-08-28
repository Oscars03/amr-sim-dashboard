/**
 * Convert a ROS occupancy-grid map (.pgm + .yaml) into this app's world format.
 *
 * The two formats are fundamentally different: ROS ships a raster (one pixel per
 * grid cell, occupancy encoded as greyscale), while a world here is a vector
 * list of wall segments in metres. Everything below exists to bridge that.
 *
 * Pipeline:
 *   parsePgm + parseMapYaml -> occupancy mask -> optional morphological close
 *   -> traceCrackContours -> simplifyRdp -> world coordinates
 *
 * All functions are pure so they can be unit-tested without a browser or ROS.
 */

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a binary PGM (P5). ROS map_saver always writes P5, but the header is
 * whitespace-delimited with optional comments, so it cannot be read with a
 * fixed offset.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {{width:number, height:number, maxVal:number, pixels:Uint8Array}}
 *   pixels is row-major, row 0 is the TOP of the image.
 */
export function parsePgm(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let pos = 0;

  const isSpace = (b) => b === 32 || b === 9 || b === 10 || b === 13;

  // Header tokens are whitespace-separated; '#' runs to end of line.
  function nextToken() {
    while (pos < bytes.length) {
      if (isSpace(bytes[pos])) {
        pos++;
      } else if (bytes[pos] === 35) {
        while (pos < bytes.length && bytes[pos] !== 10) pos++;
      } else {
        break;
      }
    }
    const start = pos;
    while (pos < bytes.length && !isSpace(bytes[pos]) && bytes[pos] !== 35) pos++;
    if (start === pos) return null;
    return String.fromCharCode(...bytes.subarray(start, pos));
  }

  const magic = nextToken();
  if (magic !== 'P5') {
    throw new Error(
      `Unsupported PGM format "${magic ?? '(empty file)'}". ` +
      `Expected binary PGM (P5), which is what "ros2 run nav2_map_server map_saver_cli" writes.`
    );
  }

  const width = parseInt(nextToken(), 10);
  const height = parseInt(nextToken(), 10);
  const maxVal = parseInt(nextToken(), 10);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`PGM header has invalid dimensions (${width} x ${height}).`);
  }
  if (!Number.isFinite(maxVal) || maxVal <= 0) {
    throw new Error(`PGM header has an invalid max value (${maxVal}).`);
  }
  if (maxVal > 255) {
    throw new Error(
      `PGM uses ${maxVal} levels (16-bit). Only 8-bit maps (max 255) are supported.`
    );
  }

  // Exactly one whitespace byte separates the header from the pixel block.
  pos++;

  const expected = width * height;
  const pixels = bytes.subarray(pos, pos + expected);
  if (pixels.length < expected) {
    throw new Error(
      `PGM is truncated: header declares ${width}x${height} = ${expected} pixels ` +
      `but only ${pixels.length} bytes of image data follow.`
    );
  }

  return { width, height, maxVal, pixels: new Uint8Array(pixels) };
}

/**
 * Parse the flat subset of YAML that ROS map files use. A full YAML parser is
 * not warranted: map_saver emits exactly these scalar and inline-array keys.
 *
 * @param {string} text
 * @returns {{image:string, resolution:number, origin:number[], negate:number,
 *            occupied_thresh:number, free_thresh:number, mode?:string}}
 */
export function parseMapYaml(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (!key) continue;

    if (value.startsWith('[')) {
      out[key] = value
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .split(',')
        .map((v) => parseFloat(v.trim()))
        .filter((v) => Number.isFinite(v));
      continue;
    }

    value = value.replace(/^["']|["']$/g, '');
    const num = Number(value);
    out[key] = value !== '' && Number.isFinite(num) ? num : value;
  }

  const missing = ['resolution', 'origin'].filter((k) => out[k] === undefined);
  if (missing.length) {
    throw new Error(
      `Map YAML is missing required field(s): ${missing.join(', ')}. ` +
      `Expected the format written by nav2_map_server.`
    );
  }
  if (!Number.isFinite(out.resolution) || out.resolution <= 0) {
    throw new Error(`Map YAML has an invalid resolution (${out.resolution}).`);
  }
  if (!Array.isArray(out.origin) || out.origin.length < 2) {
    throw new Error(`Map YAML "origin" must be [x, y, yaw]; got ${JSON.stringify(out.origin)}.`);
  }

  // Defaults match nav2_map_server's own.
  if (out.negate === undefined) out.negate = 0;
  if (out.occupied_thresh === undefined) out.occupied_thresh = 0.65;
  if (out.free_thresh === undefined) out.free_thresh = 0.196;

  return out;
}

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

/**
 * Apply ROS occupancy semantics to greyscale pixels.
 *
 * ROS treats a *dark* pixel as occupied by default: p=0 -> occupancy 1.0.
 * The `negate` flag in the YAML inverts that mapping. Cells above
 * occupied_thresh become walls; unknown (205 in a trinary map) sits between the
 * two thresholds and is deliberately NOT treated as a wall — importing unknown
 * space as geometry would wall off every unexplored region of the map.
 *
 * @returns {Uint8Array} 1 = occupied, 0 = not, row-major, same order as input.
 */
export function computeOccupancy(pixels, { negate = 0, occupied_thresh = 0.65, maxVal = 255 } = {}) {
  const mask = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    const norm = pixels[i] / maxVal;
    const occ = negate ? norm : 1 - norm;
    mask[i] = occ > occupied_thresh ? 1 : 0;
  }
  return mask;
}

/**
 * 3x3 morphological close (dilate then erode) — bridges the one-pixel gaps that
 * SLAM leaves in otherwise continuous walls, so they trace as a single contour
 * instead of a string of fragments.
 */
export function morphClose(mask, width, height) {
  // Both passes run on a canvas padded by the kernel radius, then the result is
  // cropped back. Doing it in place instead forces a bad trade at the border:
  // zero-padding erodes away any wall lying along the image edge (silently
  // opening the room to the outside), while replicate-padding stops border
  // pixels eroding at all and lets an isolated speck grow to fill a small map.
  // Padding first avoids both -- dilation expands into the pad ring, so the
  // subsequent erosion finds real support there.
  const pw = width + 2;
  const ph = height + 2;

  const padded = new Uint8Array(pw * ph);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      padded[(r + 1) * pw + (c + 1)] = mask[r * width + c];
    }
  }

  const dil = new Uint8Array(pw * ph);
  for (let r = 0; r < ph; r++) {
    for (let c = 0; c < pw; c++) {
      let hit = 0;
      for (let dr = -1; dr <= 1 && !hit; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= ph || cc < 0 || cc >= pw) continue;
          if (padded[rr * pw + cc]) { hit = 1; break; }
        }
      }
      dil[r * pw + c] = hit;
    }
  }

  const out = new Uint8Array(mask.length);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const pr = r + 1, pc = c + 1;
      let all = 1;
      for (let dr = -1; dr <= 1 && all; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = pr + dr, cc = pc + dc;
          const v = (rr < 0 || rr >= ph || cc < 0 || cc >= pw) ? 0 : dil[rr * pw + cc];
          if (!v) { all = 0; break; }
        }
      }
      out[r * width + c] = all;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contour extraction
// ---------------------------------------------------------------------------

/**
 * Trace region boundaries by following the "cracks" between pixels — the grid
 * lines separating an occupied cell from a free one — rather than the pixel
 * centres.
 *
 * Chosen over centre-based tracing (Moore neighbourhood) for three reasons that
 * matter for building maps specifically:
 *   1. It always closes. Every occupied region is enclosed by a cycle of unit
 *      edges, so there are no open polylines to special-case.
 *   2. Its segments are axis-aligned by construction, so a straight wall
 *      collapses to a single segment under RDP instead of a staircase.
 *   3. Vertices land on integer grid intersections, which makes the pixel ->
 *      metre transform exact rather than half-cell-biased.
 *
 * Edges are emitted with a consistent winding (occupied region on the right in
 * image coordinates) so that chaining is unambiguous at shared vertices.
 *
 * @returns {Array<Array<[number,number]>>} closed loops of [col,row] grid
 *   vertices; the first vertex is repeated as the last.
 */
export function traceCrackContours(mask, width, height) {
  const at = (r, c) => (r < 0 || r >= height || c < 0 || c >= width) ? 0 : mask[r * width + c];

  // Directed unit edges keyed by their start vertex.
  const outgoing = new Map();
  const key = (x, y) => y * (width + 1) + x;

  const addEdge = (x1, y1, x2, y2) => {
    const k = key(x1, y1);
    if (!outgoing.has(k)) outgoing.set(k, []);
    outgoing.get(k).push([x2, y2]);
  };

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!at(r, c)) continue;
      // Vertex (x=c, y=r) is the top-left corner of this cell.
      if (!at(r - 1, c)) addEdge(c, r, c + 1, r);             // top,    ->
      if (!at(r, c + 1)) addEdge(c + 1, r, c + 1, r + 1);     // right,  v
      if (!at(r + 1, c)) addEdge(c + 1, r + 1, c, r + 1);     // bottom, <-
      if (!at(r, c - 1)) addEdge(c, r + 1, c, r);             // left,   ^
    }
  }

  const loops = [];
  for (const [startKey, ends] of outgoing) {
    while (ends.length) {
      const loop = [];
      let x = startKey % (width + 1);
      let y = Math.floor(startKey / (width + 1));
      const sx = x, sy = y;

      // Follow edges until the walk returns to where it began. Each edge is
      // consumed once, so every edge ends up in exactly one loop.
      for (;;) {
        loop.push([x, y]);
        const list = outgoing.get(key(x, y));
        if (!list || list.length === 0) break;
        const [nx, ny] = list.pop();
        x = nx; y = ny;
        if (x === sx && y === sy) {
          loop.push([x, y]);
          break;
        }
      }

      if (loop.length > 2) loops.push(loop);
    }
  }

  return loops;
}

// ---------------------------------------------------------------------------
// Simplification
// ---------------------------------------------------------------------------

/**
 * Ramer-Douglas-Peucker polyline simplification, iterative to avoid blowing the
 * stack on the long contours a building-sized map produces.
 *
 * @param {Array<[number,number]>} points
 * @param {number} epsilon max deviation, in the same units as points
 */
export function simplifyRdp(points, epsilon) {
  if (points.length < 3 || epsilon <= 0) return points.slice();

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    if (last <= first + 1) continue;

    const [x1, y1] = points[first];
    const [x2, y2] = points[last];
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;

    let maxDist = -1, maxIdx = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      let dist;
      if (lenSq === 0) {
        dist = Math.hypot(px - x1, py - y1);
      } else {
        // Perpendicular distance to the segment's infinite line.
        dist = Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / Math.sqrt(lenSq);
      }
      if (dist > maxDist) { maxDist = dist; maxIdx = i; }
    }

    if (maxDist > epsilon && maxIdx !== -1) {
      keep[maxIdx] = 1;
      stack.push([first, maxIdx], [maxIdx, last]);
    }
  }

  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

// ---------------------------------------------------------------------------
// Coordinate transform
// ---------------------------------------------------------------------------

/**
 * Grid vertex -> world metres.
 *
 * ROS defines `origin` as the world pose of the LOWER-LEFT corner of the image,
 * while image row 0 is the TOP row. The row axis therefore has to be flipped —
 * getting this wrong mirrors the map vertically, which is subtle enough to look
 * plausible on a symmetric floor plan.
 *
 * Grid vertex coordinates are already on cell corners (see traceCrackContours),
 * so no half-cell offset is applied.
 */
export function gridVertexToWorld(x, y, { originX, originY, resolution, height }) {
  return [
    originX + x * resolution,
    originY + (height - y) * resolution,
  ];
}

// ---------------------------------------------------------------------------
// Top level
// ---------------------------------------------------------------------------

/**
 * Full conversion.
 *
 * @param {ArrayBuffer|Uint8Array} pgmBuffer
 * @param {string} yamlText
 * @param {object} [options]
 * @param {number} [options.simplifyM=0.10]   RDP tolerance in METRES
 * @param {number} [options.minLoopVertices=8] drop contours smaller than this
 *                                             (SLAM speckle) before simplifying
 * @param {boolean} [options.closeGaps=true]  apply the 3x3 morphological close
 * @param {number} [options.occupiedThresh]   override the YAML threshold
 * @returns {{walls: Array<[[number,number],[number,number]]>,
 *            mapInfo: {origin_x:number, origin_y:number, width:number, height:number},
 *            stats: object}}
 */
export function convertRosMapToWorld(pgmBuffer, yamlText, options = {}) {
  const {
    simplifyM = 0.10,
    minLoopVertices = 8,
    closeGaps = true,
    occupiedThresh,
  } = options;

  const pgm = parsePgm(pgmBuffer);
  const meta = parseMapYaml(yamlText);

  const resolution = meta.resolution;
  const originX = meta.origin[0];
  const originY = meta.origin[1];
  const originYaw = meta.origin[2] ?? 0;

  let mask = computeOccupancy(pgm.pixels, {
    negate: meta.negate,
    occupied_thresh: occupiedThresh ?? meta.occupied_thresh,
    maxVal: pgm.maxVal,
  });
  const occupiedPixels = mask.reduce((a, b) => a + b, 0);

  if (closeGaps) mask = morphClose(mask, pgm.width, pgm.height);

  const loops = traceCrackContours(mask, pgm.width, pgm.height);
  const kept = loops.filter((l) => l.length >= minLoopVertices);

  // Simplify in pixel units, then convert — RDP tolerance is easier to reason
  // about in metres, so translate it here.
  const epsilonPx = simplifyM / resolution;

  const walls = [];
  for (const loop of kept) {
    const simplified = simplifyRdp(loop, epsilonPx);
    for (let i = 0; i < simplified.length - 1; i++) {
      const a = gridVertexToWorld(simplified[i][0], simplified[i][1],
        { originX, originY, resolution, height: pgm.height });
      const b = gridVertexToWorld(simplified[i + 1][0], simplified[i + 1][1],
        { originX, originY, resolution, height: pgm.height });
      // Drop zero-length segments left behind by collinear collapse.
      if (a[0] !== b[0] || a[1] !== b[1]) {
        walls.push([[round3(a[0]), round3(a[1])], [round3(b[0]), round3(b[1])]]);
      }
    }
  }

  const mapInfo = {
    origin_x: round3(originX),
    origin_y: round3(originY),
    width: round3(pgm.width * resolution),
    height: round3(pgm.height * resolution),
  };

  return {
    walls,
    mapInfo,
    stats: {
      imageWidth: pgm.width,
      imageHeight: pgm.height,
      resolution,
      occupiedPixels,
      contoursFound: loops.length,
      contoursKept: kept.length,
      wallSegments: walls.length,
      originYaw,
    },
  };
}

export function rotateRosMap(data, rotationDeg) {
  if (!data || !data.walls || !rotationDeg) return data;
  // Positive rotationDeg rotates Clockwise (CW) to match the ↻ button
  const rad = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const { origin_x, origin_y, width, height } = data.mapInfo;
  const cx = origin_x + width / 2;
  const cy = origin_y + height / 2;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const rotatedWalls = data.walls.map(([[x1, y1], [x2, y2]]) => {
    const rx1 = cx + (x1 - cx) * cos - (y1 - cy) * sin;
    const ry1 = cy + (x1 - cx) * sin + (y1 - cy) * cos;
    const rx2 = cx + (x2 - cx) * cos - (y2 - cy) * sin;
    const ry2 = cy + (x2 - cx) * sin + (y2 - cy) * cos;

    minX = Math.min(minX, rx1, rx2);
    maxX = Math.max(maxX, rx1, rx2);
    minY = Math.min(minY, ry1, ry2);
    maxY = Math.max(maxY, ry1, ry2);

    return [[round3(rx1), round3(ry1)], [round3(rx2), round3(ry2)]];
  });

  const rotOrigX = cx + (0 - cx) * cos - (0 - cy) * sin;
  const rotOrigY = cy + (0 - cx) * sin + (0 - cy) * cos;

  return {
    ...data,
    walls: rotatedWalls,
    origin: [round3(rotOrigX), round3(rotOrigY)],
    mapInfo: {
      origin_x: round3(minX),
      origin_y: round3(minY),
      width: round3(maxX - minX),
      height: round3(maxY - minY),
    },
  };
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

