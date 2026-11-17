import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evidenceGraph } from '../src/adapters/codex/evidence.js';
import { parse } from '../src/adapters/codex/index.js';
import { scan, toIndexEntry } from '../src/scanner.js';
import { isToolCall, nodeTypeLabel } from '../src/node-types.js';

afterEach(() => vi.unstubAllEnvs());

const sourceRows = () => [
  ['response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Build the slab' }] }],
  ['event_msg', { type: 'item_completed', item: { type: 'UserMessage', content: [] } }],
  ['response_item', { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Read the supplied figure' }] }],
  ['response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'c', input: 'text(await tools.exec_command({cmd:"python build.py"}))' }],
  ['event_msg', { type: 'item_completed', item: { type: 'CommandExecution', command: ['python', 'build.py'], aggregated_output: '65 atoms', exit_code: 0 } }],
  ['event_msg', { type: 'item_completed', item: { type: 'ImageView', path: '/figure.png' } }],
  ['event_msg', { type: 'item_completed', item: { type: 'FileChange', changes: { '/slab.vasp': { kind: 'add' } } } }],
  ['response_item', { type: 'custom_tool_call_output', call_id: 'c', output: [{ type: 'input_text', text: '65 atoms' }] }],
  ['response_item', { type: 'reasoning', encrypted_content: 'private', summary: [] }],
].map(([type, payload], i) => ({ type, payload, _line: i + 1, ordinal: i, timestamp: `2026-11-11T10:00:${String(i).padStart(2, '0')}.000Z` }));

it('uses the native Codex record vocabulary and retains role/phase without generic evidence/tool tags', () => {
  const { nodes } = evidenceGraph(sourceRows(), '/rollout.jsonl', { collectDetails: true });
  expect(nodes.map(n => n.kind)).toEqual([
    'message', 'message', 'custom_tool_call', 'CommandExecution', 'ImageView',
    'FileChange', 'custom_tool_call_output', 'reasoning',
  ]);
  expect(nodeTypeLabel(nodes[0])).toBe('message · user');
  expect(nodeTypeLabel(nodes[1])).toBe('message · assistant · commentary');
  expect(nodeTypeLabel(nodes[2])).toBe('custom_tool_call');
  expect(nodeTypeLabel(nodes[3])).toBe('item_completed · CommandExecution');
  expect(nodeTypeLabel(nodes[6])).toBe('custom_tool_call_output');
  expect(nodes.every(n => !['evidence', 'tool'].includes(n.kind))).toBe(true);
  expect(isToolCall(nodes[2])).toBe(true);
  expect(isToolCall(nodes[6])).toBe(false);
  expect(nodes[6].ext.codex.recordType).toBe('response_item');
});

it('applies explicit custom titles in the index and graph without replacing the user prompt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rungraph-native-title-'));
  try {
    const root = join(dir, 'sessions');
    const day = join(root, '2026/11/11');
    const project = join(dir, '037_paper');
    await mkdir(day, { recursive: true });
    await mkdir(project);
    const id = '12345678-1234-4234-8234-123456789abc';
    const runId = `codex:${id}`;
    const path = join(day, `rollout-2026-11-11T10-00-00-${id}.jsonl`);
    const rows = [
      { type: 'session_meta', payload: { id, cwd: project } },
      ...sourceRows(),
      { type: 'event_msg', payload: { type: 'task_complete' } },
    ];
    await writeFile(path, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const titleFile = join(dir, 'titles.json');
    await writeFile(titleFile, JSON.stringify({ '037': '037 - Fig. S9 / S6', '037_paper': '037 - Fig. exact campaign', [runId]: '037 - Fig. explicit run' }));
    vi.stubEnv('RUNGRAPH_TITLES_FILE', titleFile);
    const { runs } = await scan({ rootDirs: { codex: [root] }, project });
    expect(runs).toHaveLength(1);
    expect(toIndexEntry(runs[0])).toMatchObject({ title: '037 - Fig. explicit run', customTitle: '037 - Fig. explicit run' });
    const { ir, details } = await parse(runs[0], { collectDetails: true });
    expect(ir.meta.title).toBe('037 - Fig. explicit run');
    expect([...details.values()].find(d => d.role === 'user').text).toBe('Build the slab');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
