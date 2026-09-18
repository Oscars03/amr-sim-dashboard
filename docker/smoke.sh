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
TOPIC_TIMEOUT="${TOPIC_TIMEOUT:-15}"
READY_TIMEOUT="${READY_TIMEOUT:-90}"
LAUNCH_LOG="$(mktemp -t amr-smoke-XXXXXX.log)"

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

# ── 5. the sim actually runs and publishes ───────────────────────────────────
echo
info "launching sim_bringup.launch.py (log: $LAUNCH_LOG)"
# setsid: ros2 launch spawns four nodes as children, and killing only the shell
# leaves them (and port 9090) behind. Its own process group makes them one
# target.
setsid bash -c "source '/opt/ros/$ROS_DISTRO/setup.bash' >/dev/null 2>&1 &&
                source '$WS_SETUP' >/dev/null 2>&1 &&
                exec ros2 launch amr_2dsim sim_bringup.launch.py" >"$LAUNCH_LOG" 2>&1 &
launch_pid=$!
launch_pgid=$(ps -o pgid= -p "$launch_pid" 2>/dev/null | tr -d ' ')
cleanup() {
  local target="${launch_pgid:-}"
  if [ -n "$target" ]; then
    kill -INT -- "-$target" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 -- "-$target" 2>/dev/null || return; sleep 0.5; done
    kill -KILL -- "-$target" 2>/dev/null
  else
    kill -KILL "$launch_pid" 2>/dev/null
  fi
}
trap cleanup EXIT

# Wait for the graph before timing anything. The first ros2 CLI call in a fresh
# environment starts the ros2 daemon and waits out discovery, which on a cold
# container costs more than a topic's own timeout -- charge that to the gate,
# not to /odom, or the first topic checked always looks broken.
if ros_run "for _ in \$(seq 1 $READY_TIMEOUT); do
              ros2 topic list 2>/dev/null | grep -qx /odom && exit 0
              sleep 1
            done
            exit 1"; then
  pass "sim graph up (/odom advertised)"
else
  fail "sim did not come up within ${READY_TIMEOUT}s"
fi

for topic in /odom /scan /camera/image_raw /joint_states; do
  if ros_run "timeout $TOPIC_TIMEOUT ros2 topic echo --once $topic" >/dev/null 2>&1; then
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

cleanup
trap - EXIT

echo
if [ "$fails" -eq 0 ]; then
  echo "═══ PASS on $ROS_DISTRO ═══"
  exit 0
fi
echo "═══ FAIL on $ROS_DISTRO ($fails check(s)) ═══"
echo "── last 25 lines of the launch log ──"
tail -25 "$LAUNCH_LOG"
exit 1
