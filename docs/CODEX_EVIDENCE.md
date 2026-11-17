# Codex evidence and LLM summaries

Pipeline: `rollout JSONL → pure parser → explicit Codex/LLM summary → browser`.

Modern Codex rollouts (including CLI 0.167.0) render each recorded user/assistant
message, tool call, nested command, image view, file change, tool result and
reasoning placeholder as a distinct node. JSONL file, physical line, ordinal,
call id and timestamps remain attached. Calls/results join by `call_id`, including
parallel calls; sequence arrows mean recorded order, not proof of causation.
Node badges use the original Codex types: `message` with role/phase,
`custom_tool_call`, `custom_tool_call_output`, `reasoning`, and
`item_completed · CommandExecution` / `ImageView` / `FileChange`. UI echoes of
messages/reasoning are suppressed. Older event-stream sessions keep the existing
compact graph. Child-agent lanes retain the existing adapter view.

LLM interpretation is retrospective and can include subsequent actions; it is hidden while replay is positioned before the end of the run.

Select a node to read full recorded code and text, command metadata and embedded
images. No transcript code is executed. Only embedded raster data is rendered;
paths/remote URLs are not fetched. ImageView paths are paired with returned pixels
only when ordered counts agree and a single envelope call is active. Nested
command attribution is explicitly inferred from active-call intervals; concurrent
calls remain ambiguous. Source truncation is marked. Encrypted reasoning bodies
are excluded; their positions and any public summaries are retained separately.

## Run locally

Requires Node >=20. Standard setup from this branch:

```bash
npm ci
npm run build
node bin/rungraph.js serve --no-open
```

`scripts/run-local.sh` also finds a supported Node bundled with VS Code on Linux.
Build once before serving; it does not install packages or build on its own.
The server prints its loopback URL (normally `http://127.0.0.1:4321`). The viewer
never starts the user's original task or modifies its artifacts.

For the paper reconstruction workspace, show **only** its isolated Codex campaigns:

```bash
cd ~/workspace/rungraph
./scripts/percampaign.sh
```

This discovers the campaign homes under `~/.codex_scratch_gpt6astra_xh_261111_pc`,
disables other agent adapters, and filters recorded working directories to
`~/workspace/ongo_from_scratch/codex_gpt6astra_xh_261111_percampaign`.
There are currently 39 recorded campaigns. Override the locations using
`RUNGRAPH_CODEX_CAMPAIGNS` and `RUNGRAPH_CAMPAIGN_PROJECT` if needed. Restart an
existing server after changing its scope; the launcher does not manage tmux.

The launcher loads `config/percampaign-titles.json`, producing titles such as
`037 - Fig. S9 / S6`. The Figure references are curated from `structures/*.md`
notes: they identify cited reconstruction evidence, including related/supporting
figures when no exact target depiction exists. They are not assertions that a
paper supplies coordinates for that target. Set `RUNGRAPH_TITLES_FILE` to another
JSON mapping to customize them. Explicit run-id titles take precedence over
campaign-directory titles, which take precedence over numeric campaign ids.

The structure-generation sessions used a separate Codex home. On the original
machine, target campaign 037 with:

```bash
cd ~/workspace/rungraph
export RUNGRAPH_CODEX_SESSIONS="$HOME/.codex_scratch_gpt6astra_xh_261111_pc/037_10.1021__acs.jpcc.5b02297/sessions"
export RUNGRAPH_SUMMARY_MODEL=gpt-6.1-sol
./scripts/run-local.sh serve --no-open
```

## Summarize before viewing, or on demand

Batch summaries use two concurrent model calls by default; set `RUNGRAPH_SUMMARY_CONCURRENCY=1` for serial execution (allowed range 1–4). Completed steps remain cached if a later step fails.

Default backend: the installed **Codex CLI and its existing login**, no separate
API key. Click **Summarize with Codex** in the inspector, or precompute every tool
output (one structured summary per call/result pair):

```bash
./scripts/run-local.sh list --json
./scripts/run-local.sh summarize codex:01a1ca30-70ce-7700-806e-2830f77e99fa --json > /tmp/037-summaries.json
```

Each request supplies original code, prior stated intent, command/output evidence,
actual image pixels, and the next recorded call/message. The summarizer reports
stated intent, inferred intent, code behavior, concrete text results, image
contents, next recorded action, limitations and source citations. It cannot read
private encrypted reasoning. A later message is evidence of later narration,
not proof that a preceding image caused that decision.

Codex runs ephemerally with read-only sandbox, tools discouraged, plugins/apps/
memories disabled, and a JSON output schema. It receives prompts through stdin
and images as temporary private files, cleaned on completion. Authentication
continues to use the user's CLI login; user config/rules are not loaded for this
separate analysis process. Model selection is explicit via the environment, or
falls back to the CLI's built-in default.

Summaries are **LLM interpretation**, displayed separately from original records.
Model calls consume the user's plan/API usage. Only an explicit button or the
`summarize` command invokes the model; opening/scanning/replaying does not.
Code and output remain full in the viewer even when model input is shortened
(100,000 text characters; up to 10 images / 24 MiB of encoded image data).
Omissions and text redaction counts are included. Image pixels are supplied to
the model as-is: text-secret scanning does not inspect pixels.

Caches live in `~/.cache/rungraph/summaries/`, keyed by source content, prompt
version, backend, model and language. Changed evidence creates a new key. Errors
and malformed/unverifiable citations are not cached. Calls and their output
nodes share the output summary. Reopening a node loads the cache automatically.
The cache is local, private, and outside the repository; it is not in exports.

| Variable | Purpose |
|---|---|
| `RUNGRAPH_SUMMARY_MODEL` | Codex model override; required for API backend |
| `RUNGRAPH_CODEX_BIN` | CLI executable, default `codex` |
| `RUNGRAPH_SUMMARY_LANGUAGE` | Summary language, default Korean |
| `RUNGRAPH_SUMMARY_CACHE_DIR` | Cache directory override |
| `RUNGRAPH_SUMMARY_BACKEND` | `codex` (default), or `api` |
| `RUNGRAPH_SUMMARY_BASE_URL` | OpenAI-compatible `/v1` endpoint for API backend |
| `RUNGRAPH_SUMMARY_API_KEY` | API credential; falls back to `OPENAI_API_KEY` |

The optional API backend sends multimodal Chat Completions with JSON output.
It also supports a local vision model endpoint. Credentials are read server-side
from environment variables, never accepted from the browser or stored in caches.

## Verification

Synthetic tests cover call-id pairing, concurrent attribution, original code/text/
images, repeated encrypted placeholders, source lines, live calls, cache reuse and
invalidation, citations, CLI image arguments/temporary cleanup, and the HTTP
parse → summarize → cached display path. Legacy adapter snapshots remain intact.
The real campaign 037 is a local audit, not a committed fixture: 208 records,
114 visible nodes, 20 call/result pairs and 10 embedded images. The complete raw
rollout and its private contents are never committed to this repository.
