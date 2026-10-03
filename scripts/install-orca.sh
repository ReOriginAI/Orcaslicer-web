#!/bin/sh
# Extract the official, checksum-pinned AppImage. FUSE is not required at runtime.
set -eu

destination=${1:-/opt/orca}
version=${2:-2.4.2}
checksum=${3:-d12fb8c8eac1aecd2dfb6377acd48f994f8fa439ed5292fa532dd82880f029fd}

case "$(uname -m)" in
  x86_64) ;;
  *) echo "This release pin currently supports x86_64 Linux only." >&2; exit 1 ;;
esac
case "$version" in *[!0-9.]*|'') echo "Invalid Orca version" >&2; exit 1 ;; esac
case "$checksum" in *[!0-9a-f]*|'') echo "Invalid Orca checksum" >&2; exit 1 ;; esac
[ "${#checksum}" -eq 64 ] || { echo "Expected a SHA-256 checksum" >&2; exit 1; }

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
artifact="OrcaSlicer_Linux_AppImage_Ubuntu2404_V${version}.AppImage"
curl --fail --location --retry 3 --silent --show-error \
  "https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v${version}/${artifact}" \
  --output "$temporary/orca.AppImage"
if ! printf '%s  %s\n' "$checksum" "$temporary/orca.AppImage" | sha256sum --check --status; then
  echo "Orca AppImage SHA-256 verification failed." >&2
  exit 1
fi
chmod +x "$temporary/orca.AppImage"
(
  cd "$temporary"
  ./orca.AppImage --appimage-extract >/dev/null
)
mkdir -p "$destination"
cp -a "$temporary/squashfs-root/." "$destination/"
printf '%s\n' "$version" > "$destination/ORCA_VERSION"
printf '%s\n' "$checksum" > "$destination/ORCA_SHA256"
