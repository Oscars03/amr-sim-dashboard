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
rm -rf build install log
env -u COLCON_PREFIX_PATH -u AMENT_PREFIX_PATH bash -c "source /opt/ros/jazzy/setup.bash && colcon build --merge-install"
cd ..
```

### 3. Build the release artifacts

```bash
npm run dist           # electron-vite build && electron-builder
```

electron-builder reads `${version}` from `package.json` and writes to `release/`.
`build.linux.target` asks for both architectures, so one run produces all six
files — x64 is built natively, arm64 is cross-built (the packages are Electron
plus a pure-Python workspace; nothing is compiled here):

| artifact | notes |
|---|---|
| `release/irish-amr-sim_X.Y.Z_jazzy_amd64.deb` | ~100 MB. `Package: irish-amr-simulator`, installs to `/opt/IRiSH AMR Simulator/`. Bundles `simamr_ws/install` (pre-built — target needs no colcon). `Depends:` Electron libs only. |
| `release/irish-amr-sim_X.Y.Z_jazzy_arm64.deb` | same package, arm64 Electron |
| `release/irish-amr-sim_X.Y.Z_jazzy_x86_64.AppImage` | ~130 MB |
| `release/irish-amr-sim_X.Y.Z_jazzy_arm64.AppImage` | ~130 MB |
| `release/latest-linux.yml` | electron-updater feed for x64 (version + sha512 + size). **Ship it alongside the binaries.** |
| `release/latest-linux-arm64.yml` | the same for arm64. An arm64 install reads *this* name and nothing else, so leaving it off strands every arm64 user on the version they installed. |

The `_jazzy_` token is fixed in `build.deb.artifactName` / `build.appImage.artifactName`
in `package.json`. It is a filename, not a constraint — see the OS Compatibility
table in `README.md`.

> Note the two spellings of the same architecture: `${arch}` renders as `amd64`
> / `arm64` for deb and `x86_64` / `arm64` for AppImage. Anything that picks an
> asset by name (the CI matrix, the one-command install in `README.md`) has to
> know which of the two it is matching.

### 4. Save the artifacts

Per-version folder, both `.deb`s + both `.AppImage`s + both feeds:

```bash
mkdir -p ~/Downloads/IRiSH-AMR-Sim/vX.Y.Z
cp release/irish-amr-sim_X.Y.Z_jazzy_*.deb \
   release/irish-amr-sim_X.Y.Z_jazzy_*.AppImage \
   release/latest-linux.yml release/latest-linux-arm64.yml \
   ~/Downloads/IRiSH-AMR-Sim/vX.Y.Z/
```

### 5. Smoke-test the artifacts (Docker)

The bundled workspace is built once, on Jazzy with Python 3.12, and then shipped
to whatever distro the user has. Nothing in the build proves that works —
`docker/release-smoke.sh` does:

```bash
./docker/release-smoke.sh                      # every .deb in release/
DISTROS="humble jazzy" ./docker/release-smoke.sh path/to/x.deb
```

For each distro it builds a clean `ros:<distro>-ros-base` image, installs the
`.deb` the way a user would (`dpkg -i`, then `apt-get -f install`), and checks:
the bundled `setup.bash` has no build-machine paths, `ros2 pkg prefix amr_2dsim`
resolves under that distro's ament index, `amr_2dsim.simulator_node` imports
under that distro's Python, the Electron binary has no unresolved shared
libraries, `/odom` `/scan` `/camera/image_raw` `/joint_states` all publish, and
rosbridge answers on :9090.

`docker/smoke.sh` is the container half and runs anywhere ROS 2 is installed —
useful against a local build without Docker at all:

```bash
APP_DIR="$PWD/release/linux-unpacked" ./docker/smoke.sh
```

Cross-architecture runs need binfmt registered
(`docker run --privileged --rm tonistiigi/binfmt --install all`); the driver
picks the platform from the package's own `Architecture` field. `podman` works
in place of `docker` (`CONTAINER_ENGINE=podman`, or just have it installed).

**No container engine on the machine?** The same checks run on GitHub's runners,
which is also what fires automatically on every published release:

```bash
gh workflow run release-smoke.yml -f tag=vX.Y.Z
gh run watch
```

`.github/workflows/release-smoke.yml` runs one job per distro *and
architecture* — six — inside `ros:<distro>-ros-base`, downloads that
architecture's `.deb` from the release, installs it and runs `docker/smoke.sh`.
The arm64 half runs on `ubuntu-24.04-arm` rather than under qemu, so it tests
the artifact rather than an emulator. It needs the `.deb` to be on the release —
amd64 from v0.4.0 onward, arm64 from v0.4.2.

### 6. Publish to GitHub

**Upload all four binaries plus both updater feeds.** Each feed as written by
`npm run dist` lists that architecture's AppImage *and* `.deb`; ship them
unmodified. Every artifact a feed names must be on the release or auto-update
breaks for whoever installed that one: electron-updater reads
`resources/package-type` from the installed app and then looks for exactly that
extension in the feed for its own architecture (`DebUpdater` →
`findFile(files, "deb", …)`), so a feed entry with no matching asset is a
download failure, not a fallback.

**Create it as a draft, upload, then publish.** `release-smoke.yml` triggers on
`release: published`, which fires the moment `gh release create` returns — a
publish-then-upload order starts the smoke run against a release with no assets,
and all six jobs fail on "no .deb asset" while the binaries are still uploading.
(That is exactly what happened on v0.4.2, run 35337639567.) Publishing last
makes the trigger mean what it looks like it means.

```bash
gh release create vX.Y.Z --draft --generate-notes \
  --title "irish-amr-sim Release vX.Y.Z"
gh release upload vX.Y.Z \
  release/irish-amr-sim_X.Y.Z_jazzy_x86_64.AppImage \
  release/irish-amr-sim_X.Y.Z_jazzy_arm64.AppImage \
  release/irish-amr-sim_X.Y.Z_jazzy_amd64.deb \
  release/irish-amr-sim_X.Y.Z_jazzy_arm64.deb \
  release/latest-linux.yml \
  release/latest-linux-arm64.yml
gh release edit vX.Y.Z --draft=false --latest      # this is what fires the smoke run
```

> Up to and including v0.3.0 the release was AppImage-only and the `.deb` block
> was trimmed out of the feed by hand. That left every `.deb` install unable to
> update itself. Do not trim it any more.

### 7. Commit + tag

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
  (`amd64` / `arm64`) every run. The tagged releases now ship arm64 too, so this
  is only for machines that want `colcon` to build the workspace on the target.
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
