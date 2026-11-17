import { it,expect } from 'vitest';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultRootDirs } from '../src/scanner.js';

it('scans isolated campaign homes only, overriding an inherited single-session root',async()=>{
 const root=await mkdtemp(join(tmpdir(),'campaigns-'));
 const saved=process.env.RUNGRAPH_CODEX_CAMPAIGNS, single=process.env.RUNGRAPH_CODEX_SESSIONS;
 try {
  for(const name of ['037_paper','011_paper','not-a-campaign'])await mkdir(join(root,name));
  process.env.RUNGRAPH_CODEX_CAMPAIGNS=root;process.env.RUNGRAPH_CODEX_SESSIONS='/old/037/sessions';
  expect(defaultRootDirs().codex).toEqual([join(root,'011_paper/sessions'),join(root,'037_paper/sessions')]);
 }finally{
  if(saved===undefined)delete process.env.RUNGRAPH_CODEX_CAMPAIGNS;else process.env.RUNGRAPH_CODEX_CAMPAIGNS=saved;
  if(single===undefined)delete process.env.RUNGRAPH_CODEX_SESSIONS;else process.env.RUNGRAPH_CODEX_SESSIONS=single;
  await rm(root,{recursive:true,force:true});
 }
});
