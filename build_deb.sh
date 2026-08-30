#!/bin/bash
set -e

# Always operate from the repo root, wherever this is invoked from.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP_NAME="irish-amr-simulator"

# Version + architecture are asked every run. Defaults: package.json version and
# amd64. Non-interactive callers can set VERSION= / ARCH= in the environment.
DEFAULT_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo 0.0.0)"
if [ -t 0 ]; then
  read -rp "Package version [${VERSION:-$DEFAULT_VERSION}]: " _ans
  VERSION="${_ans:-${VERSION:-$DEFAULT_VERSION}}"
  read -rp "Architecture (amd64/arm64) [${ARCH:-amd64}]: " _ans
  ARCH="${_ans:-${ARCH:-amd64}}"
fi
VERSION="${VERSION:-$DEFAULT_VERSION}"
ARCH="${ARCH:-amd64}"

case "$ARCH" in
  amd64) EB_ARCH="--x64" ;;
  arm64) EB_ARCH="--arm64" ;;
  *) echo "❌ Unsupported architecture: $ARCH (use amd64 or arm64)"; exit 1 ;;
esac

DEB_DIR="/tmp/${APP_NAME}_${VERSION}_${ARCH}"

echo "🚀 Building unified .deb for IRiSH AMR Simulator — v${VERSION} ${ARCH}"

# 1. Build the Electron App
echo "📦 Building Electron Dashboard..."
npm run build
npx electron-builder --linux dir $EB_ARCH

# 2. Setup Staging Directory
echo "📁 Setting up Debian Staging Directory..."
rm -rf $DEB_DIR
mkdir -p $DEB_DIR/DEBIAN
mkdir -p $DEB_DIR/opt/$APP_NAME/dashboard
mkdir -p $DEB_DIR/opt/$APP_NAME/ros2_ws/src
mkdir -p $DEB_DIR/usr/share/applications
mkdir -p $DEB_DIR/usr/share/pixmaps

# 3. Create DEBIAN/control
cat <<CTRL_EOF > $DEB_DIR/DEBIAN/control
Package: $APP_NAME
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Maintainer: Phuthanet Phengphan <osears.55@gmail.com>
Description: IRiSH AMR Simulator
 AMR Simulation Dashboard for autonomous mobile robot navigation.
 Includes both the Electron dashboard and the ROS 2 amr_2dsim package.
Depends: python3-colcon-common-extensions
CTRL_EOF

# 4. Create DEBIAN/postinst
cat <<'POSTINST_EOF' > $DEB_DIR/DEBIAN/postinst
#!/bin/bash
set -e

echo "--------------------------------------------------------"
echo "🛠️  IRiSH AMR Simulator: Compiling ROS 2 Workspace"
echo "--------------------------------------------------------"

# Find the installed ROS 2 version's setup.bash (e.g. /opt/ros/jazzy/setup.bash)
ROS_SETUP=$(ls /opt/ros/*/setup.bash 2>/dev/null | head -n 1)

if [ -z "$ROS_SETUP" ]; then
    echo "⚠️  WARNING: No ROS 2 installation found in /opt/ros/"
    echo "The amr_2dsim workspace was NOT compiled."
    echo "Please install ROS 2 and compile manually:"
    echo "  source /opt/ros/YOUR_DISTRO/setup.bash"
    echo "  cd /opt/irish-amr-simulator/ros2_ws"
    echo "  colcon build"
    exit 0
fi

echo "✅ Found ROS 2 at: $ROS_SETUP"
source "$ROS_SETUP"

echo "⚙️  Building workspace in /opt/irish-amr-simulator/ros2_ws..."
cd /opt/irish-amr-simulator/ros2_ws
colcon build

echo "✅ Build complete!"
# Fix ownership just in case (postinst runs as root, but we want it readable)
chmod -R a+rX /opt/irish-amr-simulator/ros2_ws/install
chmod -R a+rX /opt/irish-amr-simulator/ros2_ws/build
chmod -R a+rX /opt/irish-amr-simulator/ros2_ws/log

# Ensure the Electron app is executable
chmod +x /opt/irish-amr-simulator/dashboard/irish-amr-simulator
# (Optional) Chrome sandbox fix for root/sudo
chmod 4755 /opt/irish-amr-simulator/dashboard/chrome-sandbox || true

exit 0
POSTINST_EOF
chmod +x $DEB_DIR/DEBIAN/postinst

# 5. Copy Electron App
echo "📂 Copying Electron App..."
# electron-builder 'dir' output: release/linux-unpacked (x64) or
# release/linux-arm64-unpacked (arm64).
if [ "$ARCH" = "arm64" ]; then UNPACKED="release/linux-arm64-unpacked"; else UNPACKED="release/linux-unpacked"; fi
cp -r "$UNPACKED"/* $DEB_DIR/opt/$APP_NAME/dashboard/

# 6. Copy ROS 2 Workspace Source
echo "🤖 Copying ROS 2 Workspace..."
# Resolve the simamr_ws workspace without assuming a specific user/home path:
# 1. AMR_WS_SRC env override, 2. the bundled simamr_ws/src next to this script, 3. ~/simamr_ws
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "$AMR_WS_SRC" ]; then
    ROS_WS_SRC="$AMR_WS_SRC"
elif [ -d "$SCRIPT_DIR/simamr_ws/src" ]; then
    ROS_WS_SRC="$SCRIPT_DIR/simamr_ws/src"
else
    ROS_WS_SRC="$HOME/simamr_ws/src"
fi

if [ ! -d "$ROS_WS_SRC" ]; then
    echo "❌ ERROR: Could not find the ROS 2 workspace source at: $ROS_WS_SRC"
    echo "   Set AMR_WS_SRC=/path/to/workspace/src and re-run."
    exit 1
fi
echo "   Using ROS 2 workspace source: $ROS_WS_SRC"
cp -r "$ROS_WS_SRC"/* $DEB_DIR/opt/$APP_NAME/ros2_ws/src/

# 7. Create Desktop Shortcut
echo "🖥️  Creating Desktop Shortcut..."
cat <<DESKTOP_EOF > $DEB_DIR/usr/share/applications/$APP_NAME.desktop
[Desktop Entry]
Name=IRiSH AMR Simulator
Comment=AMR Simulation Dashboard
Exec=/opt/$APP_NAME/dashboard/$APP_NAME --no-sandbox
Icon=$APP_NAME
Terminal=false
Type=Application
Categories=Utility;
DESKTOP_EOF

# 8. Copy Icon
cp public/icon.png $DEB_DIR/usr/share/pixmaps/$APP_NAME.png

# 9. Build the .deb
echo "📦 Packing the .deb file..."
dpkg-deb --build $DEB_DIR
mv /tmp/${APP_NAME}_${VERSION}_${ARCH}.deb ./

echo "🎉 Done! The package is ready: ${APP_NAME}_${VERSION}_${ARCH}.deb"
