import { describe, it, expect } from 'vitest';
import { evidenceGraph } from '../src/adapters/codex/evidence.js';
const png = 'data:image/png;base64,iVBORw0KGgo=';
const records = (items) =>
  items.map((r, i) => ({
    timestamp: `2026-11-11T10:00:${String(i).padStart(2, '0')}.000Z`,
    _line: i + 1,
    ordinal: i,
    ...r,
  }));
const response = (payload) => ({ type: 'response_item', payload });
const event = (item) => ({ type: 'event_msg', payload: { type: 'item_completed', item } });
const message = (role, text) =>
  response({
    type: 'message',
    role,
    content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
  });
const call = (id) =>
  response({
    type: 'custom_tool_call',
    name: 'exec',
    call_id: id,
    input: `text(await tools.exec_command({cmd:'echo ${id}'}))`,
  });
const output = (id, text) =>
  response({
    type: 'custom_tool_call_output',
    call_id: id,
    output: [
      { type: 'input_text', text },
      { type: 'input_image', image_url: png },
    ],
  });

describe('modern Codex evidence graph', () => {
  it('preserves messages, nested commands, exact code, text and images without exposing encrypted reasoning', () => {
    const rows = records([
      message('user', 'Build a slab'),
      event({ type: 'UserMessage', id: 'echo', content: [{ text: 'Build a slab' }] }),
      message('assistant', 'Read SI Figure S9'),
      call('a'),
      event({
        type: 'CommandExecution',
        command: ['python', 'build.py'],
        aggregated_output: 'Fe54O9H2',
        exit_code: 0,
      }),
      event({ type: 'ImageView', path: '/image.png' }),
      output('a', 'Warning: truncated output\n65 atoms'),
      response({ type: 'reasoning', encrypted_content: 'SECRET', summary: [] }),
      message('assistant', 'Validate bonds'),
    ]);
    const g = evidenceGraph(rows, '/trace.jsonl', { collectDetails: true });
    expect(g.nodes).toHaveLength(8);
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(8);
    const d = [...g.details.values()].find((d) => d.eventType === 'output');
    expect(d.code).toContain('echo a');
    expect(d.images[0].url).toBe(png);
    expect(d.truncated).toBe(true);
    expect(d.observations).toHaveLength(2);
    expect(d.followingMessages[0].text).toBe('Validate bonds');
    expect(d.source.line).toBe(7);
    expect(JSON.stringify(g.nodes)).not.toContain('base64');
    expect(JSON.stringify([...g.details])).not.toContain('SECRET');
    expect([...g.details.values()].filter((d) => d.eventType === 'reasoning')).toHaveLength(1);
  });
  it('joins parallel call/results by call_id and marks ambiguous command attribution', () => {
    const g = evidenceGraph(
      records([
        event({ type: 'UserMessage' }),
        call('a'),
        call('b'),
        event({ type: 'CommandExecution', command: ['false'], exit_code: 1 }),
        output('b', 'B'),
        output('a', 'A'),
      ]),
      '/parallel',
      { collectDetails: true },
    );
    const outputs = [...g.details.values()].filter((d) => d.eventType === 'output');
    expect(outputs.map((d) => [d.callId, d.code.includes(`echo ${d.callId}`)])).toEqual([
      ['b', true],
      ['a', true],
    ]);
    expect(outputs[0].observations[0].attribution).toContain('ambiguous');
  });
  it('keeps repeated reasoning steps distinct and reports in-flight calls', () => {
    const g = evidenceGraph(
      records([
        event({ type: 'UserMessage' }),
        response({ type: 'reasoning', encrypted_content: 'A' }),
        response({ type: 'reasoning', encrypted_content: 'B' }),
        call('a'),
      ]),
      '/live',
      { collectDetails: true },
    );
    expect(g.nodes.filter((n) => n.ext.codex.eventType === 'reasoning')).toHaveLength(2);
    expect(g.nodes.at(-1).status).toBe('running');
    expect(g.nodes.at(-1).endedAt).toBeUndefined();
  });
  it('does not switch legacy streams or render remote image URLs', () => {
    expect(evidenceGraph(records([message('user', 'old')]), '/old')).toBeNull();
    const g = evidenceGraph(
      records([
        event({ type: 'UserMessage' }),
        call('a'),
        response({
          type: 'custom_tool_call_output',
          call_id: 'a',
          output: [{ type: 'input_image', image_url: 'https://remote.invalid/private' }],
        }),
      ]),
      '/bad',
      { collectDetails: true },
    );
    expect([...g.details.values()].find((d) => d.eventType === 'output').images).toEqual([]);
  });
});
