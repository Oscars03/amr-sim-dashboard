#!/usr/bin/env node
// verify-release-workspace.cjs — runs automatically before `npm run dist`
// (see package.json's "predist" script). Fails the build instead of silently
// shipping an AppImage/.deb whose bundled simamr_ws/install is missing or
// stale, which is exactly how v0.3.0 shipped without the rosapi node: the
// dashboard connects fine but the Topic Monitor dropdown comes up empty for
// anyone who only downloads the packaged app.
//
// See RELEASE.md, "Cutting a release" step 2, for the required build order:
// colcon build (with ROS 2 sourced) must run BEFORE `npm run dist`.
const fs = require('fs');
const path = require('path');

const WS_INSTALL = path.join(__dirname, 'simamr_ws', 'install');
const SETUP_BASH = path.join(WS_INSTALL, 'setup.bash');
const LAUNCH_FILE = path.join(
  WS_INSTALL, 'amr_2dsim', 'share', 'amr_2dsim', 'launch', 'sim_bringup.launch.py'
);

function fail(msg) {
  console.error(`\n❌ ${msg}`);
  console.error('\n   Fix:');
  console.error('     cd simamr_ws');
  console.error('     source /opt/ros/jazzy/setup.bash');
  console.error('     rm -rf build install log && colcon build --merge-install');
  console.error('     cd ..');
  console.error('\n   See RELEASE.md, "Cutting a release" step 2.\n');
  process.exit(1);
}

if (!fs.existsSync(SETUP_BASH)) {
  fail(
    'simamr_ws/install/setup.bash not found -- the packaged AppImage/.deb ' +
    'would ship with no bundled ROS 2 workspace at all.'
  );
}

if (!fs.existsSync(LAUNCH_FILE)) {
  fail(`sim_bringup.launch.py not found in the built workspace: ${LAUNCH_FILE}`);
}

const launchSrc = fs.readFileSync(LAUNCH_FILE, 'utf8');
if (!launchSrc.includes('rosapi')) {
  fail(
    'Built launch file has no "rosapi" node -- Topic Monitor will come up ' +
    'empty for anyone who installs this build. simamr_ws/install is stale ' +
    '(built before the rosapi fix); rebuild it from current source.'
  );
}

console.log('✅ simamr_ws/install looks current (setup.bash + rosapi node present).');
