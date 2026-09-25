#!/usr/bin/env bash
# Run the MkDocs docs site in Docker for local preview or a strict build.
set -euo pipefail

#######################################
# Print usage to stdout.
# Arguments:
#   None
#######################################
usage() {
  cat <<'EOF'
Usage: ./scripts/docs.sh [serve|build] [extra mkdocs args...]

  serve   Live-reload preview on http://localhost:8000 (default)
  build   Strict production build into ./site

Environment:
  DOCS_PORT   Host port for serve (default: 8000)
  DOCS_IMAGE  Image tag to build/use (default: agent-manager-docs)
EOF
}

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly DOCS_IMAGE="${DOCS_IMAGE:-agent-manager-docs}"
readonly DOCS_PORT="${DOCS_PORT:-8000}"

command="${1:-serve}"
if [[ "${command}" == "-h" || "${command}" == "--help" ]]; then
  usage
  exit 0
fi
if [[ "${#}" -gt 0 ]]; then
  shift
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is required to preview the docs site." >&2
  exit 1
fi

echo "Building docs image (${DOCS_IMAGE})..."
docker build \
  -f "${REPO_ROOT}/Dockerfile.docs" \
  -t "${DOCS_IMAGE}" \
  "${REPO_ROOT}"

docker_mounts=(
  -v "${REPO_ROOT}:/docs"
)

case "${command}" in
  serve)
    echo "Serving docs at http://localhost:${DOCS_PORT}"
    docker run --rm -it \
      "${docker_mounts[@]}" \
      -p "${DOCS_PORT}:8000" \
      "${DOCS_IMAGE}" \
      serve --dev-addr "0.0.0.0:8000" "$@"
    ;;
  build)
    echo "Building docs into ${REPO_ROOT}/site ..."
    docker run --rm \
      "${docker_mounts[@]}" \
      "${DOCS_IMAGE}" \
      build --strict "$@"
    ;;
  *)
    echo "Error: unknown command '${command}'" >&2
    usage >&2
    exit 1
    ;;
esac
