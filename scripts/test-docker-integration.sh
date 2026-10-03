#!/bin/sh
# Build and test against the same Ubuntu + Orca runtime used in production.
set -eu
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the container integration test." >&2
  exit 127
fi
project_directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
docker build --target integration --tag orca-web-integration "$project_directory"
docker run --rm --init --cap-drop ALL --security-opt no-new-privileges \
  orca-web-integration
