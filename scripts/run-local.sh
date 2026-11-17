#!/usr/bin/env bash
# Run the checkout with Node >=20, including VS Code's bundled runtime.
set -euo pipefail
cd "$(dirname "$0")/.."
rungraph_node="${RUNGRAPH_NODE_BIN:-$(command -v node || true)}"
if [[ -z "$rungraph_node" ]] || ! "$rungraph_node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  for candidate in "$HOME"/.vscode-server/cli/servers/*/server/node; do
    if [[ -x "$candidate" ]] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
      rungraph_node="$candidate"
      break
    fi
  done
fi
if [[ -z "$rungraph_node" ]] || ! "$rungraph_node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  echo 'Node >=20 is required. Set RUNGRAPH_NODE_BIN to a supported Node executable.' >&2
  exit 1
fi
export PATH="$(dirname "$rungraph_node"):$PATH"
exec "$rungraph_node" bin/rungraph.js "$@"
