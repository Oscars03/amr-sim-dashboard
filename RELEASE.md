# Release & Build

How the IRiSH AMR Simulator is built and packaged. Restored and corrected from
the old `build-workflows` skill (removed in `4f0e3a7`), which never mentioned the
actual release path (`npm run dist`).

The app is an Electron/React dashboard; the ROS 2 (Jazzy) simulation packages
live in `simamr_ws/` and are bundled into the shipped package.

---

## Prerequisites

- Node.js + `npm` (repo deps: `npm install`)
- ROS 2 Jazzy — `source /opt/ros/jazzy/setup.bash`
- `python3-colcon-common-extensions`, `dpkg-deb`
- For the ROS bridge at runtime: `ros-jazzy-rosbridge-suite`

---

## Development

```bash
npm run dev            # Vite dev server + Electron, hot reload
```

The dev app forks `map-server.cjs` (port 3001) and launches the sim on demand;
it does not need `simamr_ws/install` to be current.

---

## Cutting a release

### 1. Bump the version (three files, keep them in sync)

| file | field |
|---|---|
| `package.json` | `"version"` |
| `simamr_ws/src/amr_2dsim/package.xml` | `<version>` |
| `CHANGELOG.md` | promote `## [Unreleased]` → `## [X.Y.Z] - YYYY-MM-DD`, add a fresh `## [Unreleased]` |

### 2. Build the ROS 2 workspace (clean, merge-install)

`--merge-install` matters: `--symlink-install` leaves dangling symlinks that get
baked into the package.

```bash
cd simamr_ws
source /opt/ros/jazzy/setup.bash
rm -rf build install log
colcon build --merge-install
cd ..
```

### 3. Build the release artifacts

```bash
npm run dist           # electron-vite build && electron-builder
```

electron-builder reads `${version}` from `package.json` and writes to `release/`:

| artifact | notes |
|---|---|
| `release/irish-amr-sim_X.Y.Z_jazzy_amd64.deb` | ~100 MB. `Package: irish-amr-simulator`, installs to `/opt/IRiSH AMR Simulator/`. Bundles `simamr_ws/install` (pre-built — target needs no colcon). `Depends:` Electron libs only. |
| `release/irish-amr-sim_X.Y.Z_jazzy_x86_64.AppImage` | ~130 MB |
| `release/latest-linux.yml` | electron-updater feed (version + sha512 + size). **Ship it alongside the binaries.** |

The `_jazzy_` token is fixed in `build.deb.artifactName` / `build.appImage.artifactName`
in `package.json`.

### 4. Save the artifacts

Per-version folder, `.deb` + `.AppImage` + `latest-linux.yml`:

```bash
mkdir -p ~/Downloads/IRiSH-AMR-Sim/vX.Y.Z
cp release/irish-amr-sim_X.Y.Z_jazzy_amd64.deb \
   release/irish-amr-sim_X.Y.Z_jazzy_x86_64.AppImage \
   release/latest-linux.yml \
   ~/Downloads/IRiSH-AMR-Sim/vX.Y.Z/
```

### 5. Commit + tag

```bash
git add package.json simamr_ws/src/amr_2dsim/package.xml CHANGELOG.md
git commit -m "chore(release): vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push --follow-tags        # or open a PR and re-tag on the merge commit
```

Tags are `vX.Y.Z`. Recent history merges release PRs as merge commits, so a
locally-made `vX.Y.Z` tag stays valid after merge — just `git push origin vX.Y.Z`.

---

## Alternative: `build_deb.sh` (unified source package)

A different `.deb` for machines where you want `colcon` to build the workspace on
the target rather than shipping a pre-built `install/`:

```bash
./build_deb.sh                 # prompts for version + architecture
VERSION=0.3.0 ARCH=arm64 ./build_deb.sh   # or non-interactively
```

- Prompts for **version** (default: `package.json`) and **architecture**
  (`amd64` / `arm64`) every run.
- Bundles `simamr_ws/src` (source) and runs `colcon build` from the package's
  `postinst`, so the target needs ROS 2 + `python3-colcon-common-extensions`.
- Output: `./irish-amr-simulator_<version>_<arch>.deb`, installs to
  `/opt/irish-amr-simulator/`.

This is **not** what the tagged releases ship — those come from `npm run dist`
(step 3 above).

---

## Troubleshooting

- **Chrome sandbox error (Ubuntu 24.04):** run with `--no-sandbox`, or the
  package's `postinst` sets `chrome-sandbox` to `4755`.
- **Dangling symlinks in the bundled workspace:** you built with
  `--symlink-install`. Redo step 2 with `--merge-install`.
- **Frontend assets not updating:** `rm -rf node_modules package-lock.json && npm install`.
- **`latest-linux.yml` missing from the release folder:** it is only written by
  `npm run dist` (not `electron-builder --linux dir`); copy it in step 4.
