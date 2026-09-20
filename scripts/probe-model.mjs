import { configureNetwork } from '../src/adapters/network.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText } from '../src/adapters/model.mjs';
const dataDir = await mkdtemp(join(tmpdir(), 'branchout-model-'));
configureNetwork();
let streamed = false;
try {
  const result = await generateText({ text: 'Fictional integration test.', instruction: 'Reply exactly BRANCHOUT_OK.', dataDir, onProgress: () => { streamed = true; } });
  const success = result.text === 'BRANCHOUT_OK' && result.tools.length === 0;
  console.log(JSON.stringify({ success, model: result.model, provider: result.provider, streamed, tools: result.tools }));
  if (!success) process.exitCode = 1;
} catch (e) { console.error(JSON.stringify({ code: e.code || 'probe_failed', message: e.code ? e.message : '模型验证失败' })); process.exitCode = 1; }
finally { await rm(dataDir, { recursive: true, force: true }); }
