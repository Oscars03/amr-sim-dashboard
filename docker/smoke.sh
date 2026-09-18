#!/usr/bin/env bash
# Smoke-test an installed IRiSH AMR Simulator against whatever ROS 2 distro this
# machine has. Runs inside the container images built by docker/Dockerfile.smoke,
# but it is plain bash + ROS -- point APP_DIR at any install and it works:
#
#   APP_DIR=release/linux-unpacked ./docker/smoke.sh     # the dir electron-builder leaves behind
#
# It answers the one question the release cannot answer by inspection: does the
# workspace we bundled -- built on Jazzy with Python 3.12 -- actually run on the
# distro in front of us?
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/IRiSH AMR Simulator}"
WS_SETUP="$APP_DIR/resources/app/simamr_ws/install/setup.bash"
APP_BIN="$APP_DIR/irish-amr-simulator"
MAP_SERVER="$APP_DIR/resources/app/map-server.cjs"
TOPIC_TIMEOUT="${TOPIC_TIMEOUT:-15}"
READY_TIMEOUT="${READY_TIMEOUT:-90}"
LAUNCH_LOG="$(mktemp -t amr-smoke-XXXXXX.log)"
SERVER_LOG="$(mktemp -t amr-smoke-server-XXXXXX.log)"

fails=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails + 1)); }
info() { printf '  · %s\n' "$1"; }

# ── 0. which ROS is here ─────────────────────────────────────────────────────
if [ -z "${ROS_DISTRO:-}" ]; then
  for d in lyrical jazzy humble; do
    [ -f "/opt/ros/$d/setup.bash" ] && ROS_DISTRO="$d" && break
  done
fi
if [ -z "${ROS_DISTRO:-}" ] || [ ! -f "/opt/ros/$ROS_DISTRO/setup.bash" ]; then
  echo "❌ no ROS 2 installation found under /opt/ros" >&2
  exit 2
fi

# Keep DDS discovery on this machine. Otherwise a stale peer from an earlier
# session -- or a second smoke run on the same network -- joins the same domain,
# and the topic checks either read someone else's graph or block writing to a
# host that is gone. Seen locally as `ddsi_udp_conn_write to udp/10.0.x.x failed`
# with every topic check timing out while the sim was publishing fine.
# ROS_LOCALHOST_ONLY is the Humble spelling; Jazzy onward deprecates it in
# favour of ROS_AUTOMATIC_DISCOVERY_RANGE.
if [ "$ROS_DISTRO" = "humble" ]; then
  export ROS_LOCALHOST_ONLY="${ROS_LOCALHOST_ONLY:-1}"
else
  export ROS_AUTOMATIC_DISCOVERY_RANGE="${ROS_AUTOMATIC_DISCOVERY_RANGE:-LOCALHOST}"
fi

echo "═══ IRiSH AMR Simulator smoke test ═══"
info "ROS distro : $ROS_DISTRO"
info "Python     : $(python3 --version 2>&1)"
info "app dir    : $APP_DIR"
echo

# ── 1. the bundled workspace is there and is not machine-specific ────────────
if [ -f "$WS_SETUP" ]; then
  pass "bundled workspace present"
  if grep -q '/home/' "$WS_SETUP"; then
    fail "setup.bash carries hardcoded /home/... paths from the build machine"
  else
    pass "setup.bash has no build-machine paths"
  fi
else
  fail "bundled workspace missing: $WS_SETUP"
  echo "nothing else can be checked without it" >&2
  exit 1
fi

# Everything below needs both environments sourced, so run each check in a
# login shell that sources them rather than sourcing into this one.
ros_run() {
  bash -c "source '/opt/ros/$ROS_DISTRO/setup.bash' >/dev/null 2>&1 &&
           source '$WS_SETUP' >/dev/null 2>&1 && $1"
}

# ── 2. the ament index sees the package under THIS distro ────────────────────
if prefix=$(ros_run "ros2 pkg prefix amr_2dsim" 2>/dev/null) && [ -n "$prefix" ]; then
  pass "ros2 pkg prefix amr_2dsim -> $prefix"
else
  fail "ros2 pkg prefix amr_2dsim failed -- the workspace overlay is not visible"
fi

# ── 3. Python compatibility: built on 3.12, imported by whatever is here ─────
if err=$(ros_run "python3 -c 'import amr_2dsim.simulator_node'" 2>&1); then
  pass "amr_2dsim.simulator_node imports under $(python3 --version 2>&1 | cut -d' ' -f2)"
else
  fail "importing amr_2dsim.simulator_node failed"
  printf '      %s\n' "$(echo "$err" | tail -3)"
fi

# ── 4. the Electron binary links against this distro's libraries ─────────────
if [ -x "$APP_BIN" ]; then
  missing=$(ldd "$APP_BIN" 2>/dev/null | grep 'not found' | awk '{print $1}' | sort -u)
  if [ -z "$missing" ]; then
    pass "electron binary resolves every shared library"
  else
    fail "electron binary has unresolved libraries: $(echo "$missing" | tr '\n' ' ')"
  fi
else
  info "electron binary not present (workspace-only install) -- skipping ldd check"
fi

# Anything launched below spawns a tree -- ros2 launch brings up four nodes,
# map-server spawns a ros2 launch of its own -- and killing only the parent
# leaves the children holding port 9090. setsid puts each in its own process
# group so the whole tree is one target.
kill_group() {
  local pid="${1:-}" pgid
  [ -n "$pid" ] || return 0
  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
  if [ -n "$pgid" ]; then
    kill -INT -- "-$pgid" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 -- "-$pgid" 2>/dev/null || return 0; sleep 0.5; done
    kill -KILL -- "-$pgid" 2>/dev/null
  else
    kill -KILL "$pid" 2>/dev/null
  fi
}

# ── 5. the sim actually runs and publishes ───────────────────────────────────
echo
info "launching sim_bringup.launch.py (log: $LAUNCH_LOG)"
setsid bash -c "source '/opt/ros/$ROS_DISTRO/setup.bash' >/dev/null 2>&1 &&
                source '$WS_SETUP' >/dev/null 2>&1 &&
                exec ros2 launch amr_2dsim sim_bringup.launch.py" >"$LAUNCH_LOG" 2>&1 &
launch_pid=$!
server_pid=""
cleanup() { kill_group "$server_pid"; kill_group "$launch_pid"; }
trap cleanup EXIT

# Wait for the graph before timing anything. The first ros2 CLI call in a fresh
# environment waits out discovery, which on a cold container costs more than a
# topic's own timeout -- charge that to the gate, not to /odom, or the first
# topic checked always looks broken. READY_TIMEOUT bounds wall clock, not
# attempts: 90 attempts at a call that can itself take 10s is 15 minutes.
#
# --no-daemon throughout. The ros2 daemon caches a graph that outlives the run it
# came from, so a topic list can report /odom from a sim this script already
# killed -- a false pass in the very check meant to catch a launch that died. It
# also wedges: seen locally with every `ros2 topic list` hitting its timeout
# while `--no-daemon` answered in a second.
wait_for_odom() {
  ros_run "deadline=\$(( \$(date +%s) + $READY_TIMEOUT ))
           while [ \$(date +%s) -lt \$deadline ]; do
             timeout 10 ros2 topic list --no-daemon 2>/dev/null | grep -qx /odom && exit 0
             sleep 1
           done
           exit 1"
}

if wait_for_odom; then
  pass "sim graph up (/odom advertised)"
else
  fail "sim did not come up within ${READY_TIMEOUT}s"
fi

for topic in /odom /scan /camera/image_raw /joint_states; do
  if ros_run "timeout $TOPIC_TIMEOUT ros2 topic echo --once --no-daemon $topic" >/dev/null 2>&1; then
    pass "$topic publishes"
  else
    fail "$topic produced no message within ${TOPIC_TIMEOUT}s"
  fi
done

# ── 6. rosbridge is listening where the dashboard expects it ─────────────────
if timeout 15 python3 - <<'PY'
import socket, sys, time
deadline = time.time() + 15
while time.time() < deadline:
    try:
        socket.create_connection(("127.0.0.1", 9090), timeout=2).close()
        sys.exit(0)
    except OSError:
        time.sleep(1)
sys.exit(1)
PY
then
  pass "rosbridge accepting connections on :9090"
else
  fail "nothing listening on :9090 -- is ros-$ROS_DISTRO-rosbridge-suite installed?"
fi

kill_group "$launch_pid"
launch_pid=""

# ── 7. the launch path the app itself uses ───────────────────────────────────
# Everything above sources the workspace from this script, with this script's
# quoting. The app never does that: map-server.cjs assembles its own `bash -c`
# string and spawns it. Those are two different code paths, and the difference
# is exactly where a .deb install broke -- the package installs under
# `/opt/IRiSH AMR Simulator/` and an unquoted path in that string got split on
# the space, so every Launch died with `bash: /opt/IRiSH: No such file or
# directory`. Sections 1-6 passed straight through it. Drive the real thing.
if [ ! -x "$APP_BIN" ] || [ ! -f "$MAP_SERVER" ]; then
  info "map-server not present -- skipping the app launch path check"
else
  echo
  info "starting map-server (log: $SERVER_LOG)"
  # ELECTRON_RUN_AS_NODE makes the shipped Electron behave as plain node: no
  # nodejs package needed in the image, and it is the exact runtime the app uses.
  setsid env ELECTRON_RUN_AS_NODE=1 "$APP_BIN" "$MAP_SERVER" >"$SERVER_LOG" 2>&1 &
  server_pid=$!

  if switched=$(python3 - <<'PY'
import json, socket, sys, time, urllib.error, urllib.request

BASE = "http://127.0.0.1:3001"

def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return json.loads(r.read().decode())

deadline = time.time() + 60
while time.time() < deadline:
    try:
        socket.create_connection(("127.0.0.1", 3001), timeout=2).close()
        break
    except OSError:
        time.sleep(1)
else:
    sys.exit("map-server never listened on :3001")

try:
    robot = get("/robots")["robots"][0]["name"]
    world = get("/worlds")["worlds"][0]["name"]
except Exception as exc:
    sys.exit(f"map-server could not list robots/worlds: {exc}")

req = urllib.request.Request(
    BASE + "/switch",
    data=json.dumps({"robot": robot, "world": world}).encode(),
    headers={"Content-Type": "application/json"},
)
try:
    with urllib.request.urlopen(req, timeout=180) as r:
        print(f"{robot} + {world} (HTTP {r.status})")
except urllib.error.HTTPError as exc:
    sys.exit(f"POST /switch -> HTTP {exc.code}: {exc.read().decode()[:200]}")
PY
  ); then
    pass "map-server accepted POST /switch: $switched"
    # Gate first, then read. POST /switch returns as soon as the launch is
    # spawned, and `ros2 topic echo --once` does not wait for a topic to appear
    # -- it prints "does not appear to be published yet" and exits 1 straight
    # away. Poll until the topic exists, then require an actual message.
    if wait_for_odom &&
       ros_run "timeout $TOPIC_TIMEOUT ros2 topic echo --once --no-daemon /odom" >/dev/null 2>&1; then
      pass "sim came up through map-server's own launch command (/odom publishing)"
    else
      fail "map-server accepted the switch but the sim never came up"
      grep -m3 -E 'No such file|ROS stderr|EXITED' "$SERVER_LOG" |
        while IFS= read -r line; do printf '      %s\n' "$line"; done
    fi
  else
    fail "map-server: $switched"
  fi
fi

cleanup
trap - EXIT

echo
if [ "$fails" -eq 0 ]; then
  echo "═══ PASS on $ROS_DISTRO ═══"
  exit 0
fi
echo "═══ FAIL on $ROS_DISTRO ($fails check(s)) ═══"
for log in "$LAUNCH_LOG" "$SERVER_LOG"; do
  [ -s "$log" ] || continue
  echo "── last 25 lines of $log ──"
  tail -25 "$log"
done
exit 1
