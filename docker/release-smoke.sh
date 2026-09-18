#!/usr/bin/env bash
# Run the smoke test against a release .deb on every ROS 2 distro we claim to
# support. The artifact bundles a workspace built on one distro (Jazzy, Python
# 3.12) and is meant to run on all of them -- this is what turns that claim
# into evidence.
#
#   ./docker/release-smoke.sh                            # every .deb in release/
#   ./docker/release-smoke.sh path/to/irish-amr-sim_X.Y.Z.deb ...
#   DISTROS=jazzy ./docker/release-smoke.sh              # just one distro
#
# Needs docker or podman (podman is rootless and needs no daemon or group
# membership -- set CONTAINER_ENGINE=podman, or just have it installed).
# Cross-architecture runs need binfmt/qemu registered
# (docker run --privileged --rm tonistiigi/binfmt --install all).
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The three the map server auto-detects (map-server.cjs), so the three we test.
DISTROS="${DISTROS:-humble jazzy lyrical}"

# A release is one package per architecture, so with no argument take them all:
# testing whichever happened to be newest is how an arm64 regression ships.
declare -a DEBS=()
if [ "$#" -gt 0 ]; then
  DEBS=("$@")
else
  while IFS= read -r f; do DEBS+=("$f"); done < <(ls -t release/*.deb 2>/dev/null)
fi
if [ "${#DEBS[@]}" -eq 0 ]; then
  echo "❌ no .deb given and none found in release/ -- run npm run dist first" >&2
  exit 2
fi
for deb in "${DEBS[@]}"; do
  [ -f "$deb" ] || { echo "❌ not a file: $deb" >&2; exit 2; }
done

ENGINE="${CONTAINER_ENGINE:-}"
if [ -z "$ENGINE" ]; then
  for candidate in docker podman; do
    command -v "$candidate" >/dev/null 2>&1 && ENGINE="$candidate" && break
  done
fi
if [ -z "$ENGINE" ]; then
  echo "❌ no container engine found. Either:" >&2
  echo "     sudo apt install podman      # rootless, no daemon, no re-login" >&2
  echo "     sudo apt install docker.io   # then add yourself to the docker group" >&2
  echo "   Or skip containers entirely and run this in CI:" >&2
  echo "     gh workflow run release-smoke.yml -f tag=vX.Y.Z" >&2
  exit 2
fi

echo "engine   : $ENGINE"
echo "packages : ${DEBS[*]}"
echo "distros  : $DISTROS"
echo

declare -a results=()
overall=0

for DEB in "${DEBS[@]}"; do
  # The container architecture has to match the package, or dpkg refuses it with
  # a message that reads like a corrupt download.
  if command -v dpkg-deb >/dev/null 2>&1; then
    DEB_ARCH=$(dpkg-deb -f "$DEB" Architecture 2>/dev/null)
  else
    case "$DEB" in *arm64*) DEB_ARCH=arm64 ;; *) DEB_ARCH=amd64 ;; esac
  fi
  PLATFORM="linux/${DEB_ARCH}"

  for distro in $DISTROS; do
    image="ros:${distro}-ros-base"
    [ "$ENGINE" = podman ] && image="docker.io/library/$image"
    tag="amr-smoke:${distro}-${DEB_ARCH}"
    echo "───────────────────────────────────────────────"
    echo "▶ $distro / $DEB_ARCH  ($image)"
    echo "───────────────────────────────────────────────"

    if ! "$ENGINE" build --platform "$PLATFORM" -f docker/Dockerfile.smoke \
          --build-arg "ROS_IMAGE=$image" --build-arg "DEB_FILE=$DEB" \
          -t "$tag" . ; then
      results+=("$distro/$DEB_ARCH: BUILD FAILED (image missing, or the .deb would not install)")
      overall=1
      continue
    fi

    if "$ENGINE" run --rm --platform "$PLATFORM" "$tag"; then
      results+=("$distro/$DEB_ARCH: PASS")
    else
      results+=("$distro/$DEB_ARCH: FAIL")
      overall=1
    fi
    echo
  done
done

echo "═══ summary ═══"
printf '  %s\n' "${results[@]}"
exit "$overall"
