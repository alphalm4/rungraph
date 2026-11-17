#!/usr/bin/env bash
# Show only the paper reconstruction campaigns, with their isolated Codex homes.
set -euo pipefail
cd "$(dirname "$0")/.."
export RUNGRAPH_CODEX_CAMPAIGNS="${RUNGRAPH_CODEX_CAMPAIGNS:-$HOME/.codex_scratch_gpt6astra_xh_261111_pc}"
export RUNGRAPH_CLAUDE_PROJECTS=''
export RUNGRAPH_HERMES_HOME=''
export RUNGRAPH_OPENCODE_HOME=''
export RUNGRAPH_CURSOR_GLOBAL_STORAGE=''
export RUNGRAPH_CURSOR_CLI_HOME=''
export RUNGRAPH_SUMMARY_MODEL="${RUNGRAPH_SUMMARY_MODEL:-gpt-6.1-sol}"
rungraph_campaign_project="${RUNGRAPH_CAMPAIGN_PROJECT:-$HOME/workspace/ongo_from_scratch/codex_gpt6astra_xh_261111_percampaign}"
exec ./scripts/run-local.sh serve --no-open --project "$rungraph_campaign_project" "$@"
