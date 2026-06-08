#!/usr/bin/env bash
# Rebuild bundle.zip for every version directory under agents/.
#
# Usage (from frontend/mocks/):
#   ./build-bundles.sh
#
# Each agents/<version>/ directory is zipped in-place, producing
# agents/<version>/bundle.zip.  The zip contains manifest.json and all
# agent subdirectories at the root level, matching the layout that
# agent-bundler publishes to the CDN.
set -euo pipefail

AGENTS_DIR="$(cd "$(dirname "$0")/agents" && pwd)"

built=0
for version_dir in "$AGENTS_DIR"/*/; do
  version="$(basename "$version_dir")"
  zip_path="$version_dir/bundle.zip"

  # Collect entries: manifest.json + every subdirectory
  entries=()
  if [[ -f "$version_dir/manifest.json" ]]; then
    entries+=("manifest.json")
  fi
  while IFS= read -r -d '' dir; do
    entries+=("$(basename "$dir")")
  done < <(find "$version_dir" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)

  if [[ ${#entries[@]} -eq 0 ]]; then
    echo "  skip  $version  (nothing to zip)"
    continue
  fi

  echo "  build $version  -> bundle.zip"
  (cd "$version_dir" && zip -qr bundle.zip "${entries[@]}")

  echo "  hash  $version  -> bundle.zip.sha256"
  (cd "$version_dir" && shasum -a 256 bundle.zip > bundle.zip.sha256)
  built=$((built + 1))
done

echo "Done — rebuilt $built bundle(s)."
