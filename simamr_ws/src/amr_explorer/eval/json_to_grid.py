#!/usr/bin/env python3
"""Build the coverage ground truth from an amr_2dsim world JSON.

REACHABLE_FREE = cells the robot CENTRE can occupy, flood-filled from the
start pose. Sealed obstacle interiors are excluded, so the coverage target
stays physically attainable. Wall distances are exact point-to-segment, not
rasterise-then-EDT, so doorway margins are correct to floating point.
"""
import argparse, json, sys
import numpy as np
from scipy import ndimage


def load_walls(path):
    d = json.load(open(path))
    walls = [((float(w[0][0]), float(w[0][1])), (float(w[1][0]), float(w[1][1])))
             for w in d.get("walls", [])]
    if not walls:
        raise ValueError(f"{path}: no walls")
    return d.get("name", "unnamed"), walls


def wall_distance_field(walls, res, margin=0.5):
    xs = [p[0] for s in walls for p in s]
    ys = [p[1] for s in walls for p in s]
    ox, oy = min(xs) - margin, min(ys) - margin
    nx = int(np.ceil((max(xs) + margin - ox) / res))
    ny = int(np.ceil((max(ys) + margin - oy) / res))
    X, Y = np.meshgrid(ox + (np.arange(nx) + .5) * res,
                       oy + (np.arange(ny) + .5) * res)
    dist = np.full((ny, nx), np.inf)
    for (p1, p2) in walls:
        dx, dy = p2[0] - p1[0], p2[1] - p1[1]
        L = dx * dx + dy * dy or 1.0
        t = np.clip(((X - p1[0]) * dx + (Y - p1[1]) * dy) / L, 0.0, 1.0)
        np.minimum(dist, np.hypot(X - (p1[0] + t * dx), Y - (p1[1] + t * dy)), out=dist)
    return dist, ox, oy, res


def reachable_mask(dist, ox, oy, res, radius, start=(0.0, 0.0)):
    free = dist >= radius
    ix, iy = int((start[0] - ox) / res), int((start[1] - oy) / res)
    if not (0 <= iy < free.shape[0] and 0 <= ix < free.shape[1]):
        raise ValueError(f"start {start} outside grid")
    if not free[iy, ix]:
        raise ValueError(f"start {start} inside inflated obstacle "
                         f"(clearance {dist[iy, ix]:.3f} < radius {radius})")
    # 4-connectivity: never let the fill slip through a sealed diagonal pinch.
    lab, _ = ndimage.label(free, structure=ndimage.generate_binary_structure(2, 1))
    return lab == lab[iy, ix], free


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("world_json")
    ap.add_argument("--radius", type=float, default=0.35)
    ap.add_argument("--res", type=float, default=0.05)
    ap.add_argument("--start", type=float, nargs=2, default=[0.0, 0.0])
    ap.add_argument("-o", "--out")
    ap.add_argument("--png")
    a = ap.parse_args()

    name, walls = load_walls(a.world_json)
    dist, ox, oy, res = wall_distance_field(walls, a.res)
    print(f"world '{name}': {len(walls)} segments, grid {dist.shape[1]}x{dist.shape[0]} @ {res} m")

    reach, free = reachable_mask(dist, ox, oy, res, a.radius, tuple(a.start))
    area = reach.sum() * res * res
    print(f"radius={a.radius} m  ->  REACHABLE_FREE = {area:.2f} m2 ({reach.sum()} cells)")
    print(f"  orphaned (clear but unreachable): {(free & ~reach).sum() * res * res:.2f} m2")

    if a.out:
        np.savez_compressed(a.out, reachable=reach, dist=dist,
                            origin=np.array([ox, oy]), res=res, radius=a.radius)
        print(f"  wrote {a.out}")
    if a.png:
        import matplotlib; matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        img = np.zeros(reach.shape + (3,))
        img[free & ~reach] = [.95, .75, .2]
        img[reach] = [.25, .75, .45]
        fig, ax = plt.subplots(figsize=(10, 8))
        ax.imshow(img, origin="lower", extent=[ox, ox + reach.shape[1] * res,
                                               oy, oy + reach.shape[0] * res])
        for (p1, p2) in walls:
            ax.plot([p1[0], p2[0]], [p1[1], p2[1]], "k-", lw=2)
        ax.plot(*a.start, "r*", ms=16)
        ax.set_title(f"{name}: REACHABLE_FREE (green) r={a.radius} = {area:.1f} m2")
        ax.set_aspect("equal"); fig.tight_layout(); fig.savefig(a.png, dpi=110)
        print(f"  wrote {a.png}")


if __name__ == "__main__":
    sys.exit(main())
