import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../src/server.js';

it('serves full evidence, generates with the CLI, retrieves cached summaries, and guards writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'evidence-http-'));
  const saved = { ...process.env };
  let server;
  try {
    const sessions = join(dir, 'sessions'),
      day = join(sessions, '2026/11/11');
    await mkdir(day, { recursive: true });
    const id = '12345678-1234-4234-8234-123456789abc';
    const file = join(day, `rollout-2026-11-11T19-38-55-${id}.jsonl`);
    const rows = [
      ['session_meta', { id, cwd: dir }],
      ['event_msg', { type: 'task_started', turn_id: 't' }],
      [
        'response_item',
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Build slab' }] },
      ],
      ['event_msg', { type: 'item_completed', item: { type: 'UserMessage' } }],
      [
        'response_item',
        { type: 'custom_tool_call', name: 'exec', call_id: 'a', input: 'print(65)' },
      ],
      [
        'response_item',
        {
          type: 'custom_tool_call_output',
          call_id: 'a',
          output: [{ type: 'input_text', text: '65 atoms' }],
        },
      ],
      ['event_msg', { type: 'task_complete' }],
    ];
    await writeFile(
      file,
      rows
        .map(([type, payload], i) =>
          JSON.stringify({
            type,
            payload,
            ordinal: i,
            timestamp: `2026-11-11T10:38:${String(i).padStart(2, '0')}.000Z`,
          }),
        )
        .join('\n') + '\n',
    );
    const fake = join(dir, 'codex');
    const summary = {
      intent: { stated: 'Build slab', inferred: '' },
      code: 'print 65',
      textOutput: '65 atoms',
      images: [],
      nextAction: '',
      limitations: [],
      evidence: [{ file, line: 6 }],
    };
    await writeFile(
      fake,
      `#!${process.execPath}\nconst fs=require('fs'); let p='';process.stdin.on('data',d=>p+=d);process.stdin.on('end',()=>{if(!p.includes('65 atoms'))process.exit(2);fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],${JSON.stringify(JSON.stringify(summary))});});\n`,
    );
    await chmod(fake, 0o700);
    Object.assign(process.env, {
      RUNGRAPH_CODEX_SESSIONS: sessions,
      RUNGRAPH_CLAUDE_PROJECTS: '',
      RUNGRAPH_HERMES_HOME: '',
      RUNGRAPH_OPENCODE_HOME: '',
      RUNGRAPH_CURSOR_GLOBAL_STORAGE: '',
      RUNGRAPH_CURSOR_CLI_HOME: '',
      RUNGRAPH_SUMMARY_CACHE_DIR: join(dir, 'cache'),
      RUNGRAPH_SUMMARY_BACKEND: 'codex',
      RUNGRAPH_CODEX_BIN: fake,
    });
    server = await startServer({ preferredPort: 0 });
    const runId = `codex:${id}`;
    const graph = await (await fetch(server.url + '/api/graph/' + runId)).json();
    expect(graph.nodes).toHaveLength(3);
    const output = graph.nodes.find((n) => n.ext.codex.eventType === 'output');
    const call = graph.nodes.find((n) => n.ext.codex.eventType === 'call');
    const post = (origin) =>
      fetch(server.url + '/api/summary', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        body: JSON.stringify({ runId, nodeId: call.id }),
      });
    expect((await post('https://hostile.invalid')).status).toBe(403);
    expect((await fetch(server.url + '/api/summary')).status).toBe(405);
    const result = await post();
    expect(result.status).toBe(200);
    expect((await result.json()).summary).toEqual(summary);
    const detail = await (
      await fetch(server.url + `/api/detail/${encodeURIComponent(output.id)}?run=${runId}`)
    ).json();
    expect(detail.text).toBe('65 atoms');
    expect(detail.code).toBe('print(65)');
    expect(detail.summary.cached).toBe(true);
  } finally {
    if (server) await server.close();
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    await rm(dir, { recursive: true, force: true });
  }
});
