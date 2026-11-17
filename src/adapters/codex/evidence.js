import { snippet } from '../../ir.js';

const textOf = (parts) =>
  (parts ?? [])
    .filter((p) => ['text', 'input_text', 'output_text', 'summary_text'].includes(p?.type))
    .map((p) => p.text ?? '')
    .join('\n');
const safeImage = (url) =>
  typeof url === 'string' &&
  /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(url);

/** Modern rollout records: a lossless evidence chain, without executing transcript code.
 * Old event-stream sessions retain their existing graph. Duplicate UI echoes are
 * suppressed by item id; encrypted bodies are deliberately never copied.
 */
export function evidenceGraph(records, file, { collectDetails = false, prefix = 'ev' } = {}) {
  if (
    !records.some(
      (r) =>
        r.type === 'event_msg' &&
        r.payload?.type === 'item_completed' &&
        ['UserMessage', 'CommandExecution', 'ImageView'].includes(r.payload.item?.type),
    )
  )
    return null;
  const nodes = [],
    edges = [],
    details = new Map(),
    calls = new Map();
  let tip = null,
    prompt = '',
    context = [],
    activeCalls = new Map();
  const add = (r, eventType, label, data = {}, kind = 'evidence') => {
    const id = `${prefix}:${r.ordinal ?? r._line}:${eventType}`;
    const source = { file, line: r._line, ordinal: r.ordinal ?? null, timestamp: r.timestamp };
    const node = {
      id,
      kind,
      label: snippet(label, 85),
      status: 'completed',
      startedAt: r.timestamp,
      hasDetail: true,
      ext: { codex: { eventType, source, callId: data.callId ?? null } },
    };
    nodes.push(node);
    if (tip) edges.push({ id: `e:sequence:${tip}→${id}`, kind: 'sequence', from: tip, to: id });
    tip = id;
    if (collectDetails) details.set(id, { kind: 'evidence', eventType, source, ...data });
    return node;
  };
  for (const r of records) {
    const p = r.payload ?? {};
    if (r.type === 'response_item') {
      if (p.type === 'message' && ['user', 'assistant'].includes(p.role)) {
        const text = textOf(p.content);
        if (
          p.role === 'user' &&
          (text.startsWith('<environment_context>') || text.startsWith('# AGENTS.md'))
        )
          continue;
        if (p.role === 'user') {
          prompt = text;
          context = [];
        } else context.push({ text, phase: p.phase, source: { file, line: r._line } });
        add(r, 'message', `${p.role}${p.phase ? ` · ${p.phase}` : ''}: ${text}`, {
          role: p.role,
          phase: p.phase,
          text,
          images: (p.content ?? [])
            .filter((c) => c.type === 'input_image' && safeImage(c.image_url))
            .map((c) => ({ url: c.image_url, detail: c.detail })),
        });
      } else if (p.type === 'reasoning') {
        add(
          r,
          'reasoning',
          p.encrypted_content
            ? 'Reasoning · encrypted, unavailable'
            : 'Reasoning · recorded summary',
          { text: textOf(p.summary) || textOf(p.content), encrypted: Boolean(p.encrypted_content) },
        );
      } else if (['function_call', 'custom_tool_call'].includes(p.type)) {
        const code = p.input ?? p.arguments ?? '';
        const n = add(
          r,
          'call',
          `${p.name} · ${code}`,
          { callId: p.call_id, name: p.name, code, prompt, precedingMessages: [...context] },
          'tool',
        );
        Object.assign(n, { status: 'running', callCount: 1, errorCount: 0 });
        calls.set(p.call_id, n);
        activeCalls.set(p.call_id, n.id);
      } else if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
        const blocks = Array.isArray(p.output)
          ? p.output
          : [
              {
                type: 'input_text',
                text: typeof p.output === 'string' ? p.output : JSON.stringify(p.output),
              },
            ];
        const images = blocks
          .filter((c) => c.type === 'input_image' && safeImage(c.image_url))
          .map((c) => ({ url: c.image_url, detail: c.detail }));
        const text = textOf(blocks);
        const call = calls.get(p.call_id);
        const observations = collectDetails
          ? [...details.values()].filter((d) => d.parentCallIds?.includes(p.call_id))
          : [];
        const followingMessages = records
          .filter(
            (x) =>
              x._line > r._line &&
              x.type === 'response_item' &&
              x.payload?.type === 'message' &&
              x.payload.role === 'assistant',
          )
          .slice(0, 1)
          .map((x) => ({ text: textOf(x.payload.content), source: { file, line: x._line } }));
        // Pair image paths and pixels only when their ordered counts agree.
        const views = observations.filter((d) => d.eventType === 'ImageView');
        if (views.length === images.length && activeCalls.size === 1) {
          images.forEach((im, index) => {
            im.path = views[index].execution.path;
            views[index].images = [im];
            views[index].imageAttribution = 'ordered view/output pairing';
          });
        }
        const next = records.find(
          (x) =>
            x._line > r._line &&
            x.type === 'response_item' &&
            ['function_call', 'custom_tool_call'].includes(x.payload?.type),
        );
        const followingAction = next
          ? {
              source: { file, line: next._line },
              name: next.payload.name,
              code: next.payload.input ?? next.payload.arguments,
            }
          : null;
        const n = add(r, 'output', `Output · ${images.length} images · ${text}`, {
          callId: p.call_id,
          text,
          images,
          blocks: blocks.filter((c) => c.type !== 'input_image'),
          callNodeId: call?.id,
          observations,
          followingMessages,
          followingAction,
          truncated: /truncat(?:ed|ion)/i.test(text),
        });
        if (call) {
          call.status = 'completed';
          call.endedAt = r.timestamp;
          // This edge is a known call/result relation, independent of sequence.
          edges.push({
            id: `e:result:${call.id}→${n.id}`,
            kind: 'sequence',
            from: call.id,
            to: n.id,
            label: 'call_id → result',
          });
          if (collectDetails) {
            Object.assign(details.get(call.id), {
              outputNodeId: n.id,
              output: text,
              images,
              observations,
              followingMessages,
              followingAction,
              outputSource: details.get(n.id).source,
            });
            const d = details.get(n.id);
            Object.assign(d, {
              callSource: details.get(call.id).source,
              code: details.get(call.id).code,
              name: details.get(call.id).name,
              precedingMessages: details.get(call.id).precedingMessages,
              prompt: details.get(call.id).prompt,
            });
          }
        }
        activeCalls.delete(p.call_id);
      }
    } else if (r.type === 'event_msg' && p.type === 'item_completed') {
      const i = p.item ?? {};
      if (['CommandExecution', 'ImageView', 'FileChange'].includes(i.type)) {
        const data = {
          text: i.aggregated_output ?? i.stdout ?? '',
          execution: i,
          parentCallIds: [...activeCalls.keys()],
          attribution:
            activeCalls.size === 1
              ? 'single active call (inferred from interval)'
              : 'ambiguous concurrent calls',
        };
        const label =
          i.type === 'CommandExecution'
            ? `Command · ${JSON.stringify(i.command)}`
            : i.type === 'ImageView'
              ? `Image viewed · ${i.path}`
              : `File change · ${Object.keys(i.changes ?? {}).join(', ')}`;
        const n = add(r, i.type, label, data);
        if (i.type === 'CommandExecution' && i.exit_code != null && i.exit_code !== 0)
          n.status = 'error';
        if (
          i.type === 'CommandExecution' &&
          activeCalls.size === 1 &&
          i.exit_code != null &&
          i.exit_code !== 0
        ) {
          const parent = calls.get([...activeCalls.keys()][0]);
          if (parent) {
            parent.errorCount = 1;
            parent.status = 'error';
          }
        }
      }
    }
  }
  // A failed child command remains a failed call even when the JS envelope completed.
  for (const n of calls.values()) if (n.errorCount) n.status = 'error';
  return { nodes, edges, details, prompt };
}
