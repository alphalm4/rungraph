import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const object = (properties) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const string = { type: 'string' };
export const SUMMARY_SCHEMA = object({
  intent: object({ stated: string, inferred: string }),
  code: string,
  textOutput: string,
  images: { type: 'array', items: object({ index: { type: 'integer' }, description: string }) },
  nextAction: string,
  limitations: { type: 'array', items: string },
  evidence: { type: 'array', items: object({ file: string, line: { type: 'integer' } }) },
});

/** Uses the user's existing CLI login. Transcript code is input data, never shell code. */
export async function runCodexSummary(input, config, { spawnImpl = spawn } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'rungraph-summary-'));
  try {
    const schema = join(dir, 'schema.json'),
      output = join(dir, 'summary.json');
    await writeFile(schema, JSON.stringify(SUMMARY_SCHEMA), { mode: 0o600 });
    const args = [
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ignore-user-config',
      '--ignore-rules',
      '-C',
      dir,
      '--color',
      'never',
      '--output-schema',
      schema,
      '--output-last-message',
      output,
      '-c',
      'features.apps=false',
      '-c',
      'features.plugins=false',
      '-c',
      'features.memories=false',
      '-c',
      'agents.enabled=false',
      '-c',
      'model_reasoning_effort="low"',
    ];
    if (config.model) args.push('--model', config.model);
    let prompt =
      input.messages[0].content +
      '\nDo not call tools or read any files. Analyze only the supplied evidence and attached images.\n';
    for (const block of input.messages[1].content) {
      if (block.type === 'text') prompt += '\n' + block.text;
      if (block.type === 'image_url') {
        const match = block.image_url.url.match(
          /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\r\n]+)$/,
        );
        if (!match) continue;
        const path = join(
          dir,
          `image-${args.filter((a) => a === '--image').length + 1}.${match[1]}`,
        );
        await writeFile(path, Buffer.from(match[2], 'base64'), { mode: 0o600 });
        args.push('--image', path);
      }
    }
    args.push('--', '-');
    await new Promise((resolve, reject) => {
      const child = spawnImpl(config.codexBin, args, { stdio: ['pipe', 'ignore', 'ignore'] });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, config.timeoutMs ?? 240000);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Cannot start Codex CLI: ${err.code ?? 'spawn failed'}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve()
          : reject(
              new Error(
                timedOut
                  ? 'Codex summary timed out.'
                  : `Codex summary exited ${code}; check CLI login with codex login status.`,
              ),
            );
      });
      child.stdin.on('error', () => {});
      child.stdin.end(prompt);
    });
    return JSON.parse(await readFile(output, 'utf8'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
