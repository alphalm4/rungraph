/** Native Codex vocabulary for display; source labels do not come from the LLM. */
export function nodeTypeLabel(node) {
  const type = node?.kind ?? '';
  const codex = node?.ext?.codex;
  if (!codex?.recordType) return type;
  if (type === 'message') return [type, codex.role, codex.phase].filter(Boolean).join(' · ');
  if (codex.recordType === 'event_msg') return `item_completed · ${type}`;
  return type;
}

export function isToolCall(node) {
  return ['tool', 'function_call', 'custom_tool_call'].includes(node?.kind);
}
