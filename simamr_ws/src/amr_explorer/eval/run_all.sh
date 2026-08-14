#!/usr/bin/env bash
# run_all.sh -- the full acceptance suite: three start poses, sequential.
#
# Seed 1 starts inside the NW room, so the 1.0 m doorway has to be solved in
# the first few seconds rather than discovered at minute four. Seed 2 starts
# in the far corner and forces a full traverse. Both poses were checked
# against the distance field and sit >1.3 m clear of any wall.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_SHARE="$(ros2 pkg prefix amr_2dsim)/share/amr_2dsim"
URDF="${URDF:-$PKG_SHARE/urdf/amr.urdf}"
MAP="${MAP:-$PKG_SHARE/worlds/office.json}"
SLAM="${SLAM:-$(ros2 pkg prefix amr_navigation)/share/amr_navigation/config/slam_params.yaml}"

POSES=("[0.0, 0.0, 0.0]" "[-6.0, 4.0, -1.57]" "[6.5, -4.5, 3.14]")
rm -f "$HERE/results"/seed*.json
fail=0
for i in 0 1 2; do
  echo "=== seed $i  pose ${POSES[$i]} ==="
  python3 "$HERE/run_eval.py" --seed "$i" --pose "${POSES[$i]}" \
      --urdf "$URDF" --map "$MAP" --slam-params "$SLAM" || fail=1
  sleep 3
done

echo "=== summary ==="
python3 - "$HERE/results" << 'PY'
import glob, json, sys
rows = [json.load(open(p)) for p in sorted(glob.glob(sys.argv[1] + "/seed*.json"))]
print(f"{'seed':>4} {'cov%':>7} {'col':>4} {'rmse':>7} {'t(s)':>7} {'stuck':>6}  verdict")
for r in rows:
    print(f"{r.get('seed'):>4} {r.get('coverage_pct',0):>7} {r.get('collision_events',0):>4} "
          f"{str(r.get('wall_rmse_m')):>7} {r.get('elapsed_s',0):>7} {r.get('stuck_events',0):>6}  "
          f"{'PASS' if r.get('completed') else 'FAIL:' + str(r.get('fail_reason'))}")
ok = rows and all(r.get('completed') for r in rows)
print("\nSUITE " + ("PASS" if ok else "FAIL"))
sys.exit(0 if ok else 1)
PY
