#!/bin/bash
set -e

APP_NAME="irish-amr-simulator"
VERSION="1.0.0"
ARCH="amd64"
DEB_DIR="/tmp/${APP_NAME}_${VERSION}_${ARCH}"

echo "🚀 Building Unified .deb for IRiSH AMR Simulator..."

# 1. Build the Electron App
echo "📦 Building Electron Dashboard..."
npm run build
npx electron-builder --linux dir

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
# Electron builder 'dir' output goes to release/linux-unpacked
cp -r release/linux-unpacked/* $DEB_DIR/opt/$APP_NAME/dashboard/

# 6. Copy ROS 2 Workspace Source
echo "🤖 Copying ROS 2 Workspace..."
cp -r /home/phutanate/simamr_ws/src/* $DEB_DIR/opt/$APP_NAME/ros2_ws/src/

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
