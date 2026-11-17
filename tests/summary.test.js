import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSummary, summarizeEvidence, cachedSummary } from '../src/summary.js';
import { runCodexSummary } from '../src/summary-codex.js';
import { EventEmitter } from 'node:events';
const detail = {
  kind: 'evidence',
  eventType: 'output',
  source: { file: '/trace', line: 7 },
  code: 'print(65)',
  text: '65 atoms',
  images: [{ url: 'data:image/png;base64,iVBORw0KGgo=' }],
};
const summary = {
  intent: { stated: 'read figure', inferred: '' },
  code: 'print count',
  textOutput: '65 atoms',
  images: [{ index: 1, description: 'a slab' }],
  nextAction: 'validate',
  limitations: ['reasoning encrypted'],
  evidence: [{ file: '/trace', line: 7 }],
};
const config = (cacheDir) => ({
  backend: 'api',
  model: 'vision-model',
  baseURL: 'http://localhost:1234/v1',
  apiKey: 'test',
  language: 'Korean',
  cacheDir,
});
it('sends actual pixels, redacts text, and fingerprints evidence/model/language changes', () => {
  const a = prepareSummary({ ...detail, blobEncryptionKey: 'abc' }, config('/unused'));
  expect(a.redacted).toBe(1);
  expect(
    a.messages[1].content.some(
      (c) => c.type === 'image_url' && c.image_url.url === detail.images[0].url,
    ),
  ).toBe(true);
  expect(a.fingerprint).not.toBe(
    prepareSummary({ ...detail, text: '64 atoms' }, config('/unused')).fingerprint,
  );
  expect(a.fingerprint).not.toBe(
    prepareSummary(
      { ...detail, blobEncryptionKey: 'abc' },
      { ...config('/unused'), language: 'English' },
    ).fingerprint,
  );
});
it('calls model once, reuses disk cache after restart and rejects invented citations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'summary-test-'));
  try {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(summary) } }] }),
    }));
    const opts = { config: config(dir), fetchImpl };
    const a = await summarizeEvidence(detail, opts);
    const b = await summarizeEvidence(detail, opts);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await cachedSummary(detail, opts.config)).toMatchObject({ fingerprint: a.fingerprint });
    fetchImpl.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ ...summary, evidence: [{ file: '/invented', line: 999 }] }),
            },
          },
        ],
      }),
    }));
    await expect(summarizeEvidence({ ...detail, text: 'new' }, opts)).rejects.toThrow(
      'unknown evidence',
    );
    expect(await cachedSummary({ ...detail, text: 'new' }, opts.config)).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('materializes images for Codex CLI, uses stdin and structured output, removes temp files', async () => {
  let cwd, argsSeen, promptSeen;
  const spawnImpl = (bin, args) => {
    argsSeen = args;
    cwd = args[args.indexOf('-C') + 1];
    const child = new EventEmitter();
    child.kill = vi.fn();
    child.stdin = new EventEmitter();
    child.stdin.end = async (prompt) => {
      promptSeen = prompt;
      const image = args[args.indexOf('--image') + 1];
      expect((await readFile(image)).length).toBeGreaterThan(0);
      await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify(summary));
      child.emit('close', 0);
    };
    return child;
  };
  const result = await runCodexSummary(
    prepareSummary(detail, config('/unused')),
    { codexBin: 'codex', model: 'test' },
    { spawnImpl },
  );
  expect(result).toEqual(summary);
  expect(argsSeen).toContain('--ephemeral');
  expect(argsSeen).toContain('read-only');
  expect(argsSeen.at(-1)).toBe('-');
  expect(promptSeen).toContain('print(65)');
  await expect(readFile(join(cwd, 'summary.json'))).rejects.toThrow();
});
it('fails provider errors without caching', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'summary-error-'));
  try {
    await expect(
      summarizeEvidence(detail, {
        config: config(dir),
        fetchImpl: async () => ({ ok: false, status: 429 }),
      }),
    ).rejects.toThrow('HTTP 429');
    expect(await cachedSummary(detail, config(dir))).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
