import { configureNetwork } from '../adapters/network.mjs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { generateText } from '../adapters/model.mjs';
import { fetchTrending } from '../adapters/github.mjs';
configureNetwork();
const port = process.parentPort;
port.on('message', async ({ data }) => {
  if (data.type !== 'probe') return;
  const results = {};
  try {
    const path = join(data.dataDir, 'probe.sqlite');
    let db = new DatabaseSync(path);
    db.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT OR REPLACE INTO probe VALUES (?, ?)').run(1, 'fictional-probe'); db.close();
    db = new DatabaseSync(path); results.sqlite = db.prepare('SELECT value FROM probe WHERE id=1').get().value === 'fictional-probe'; db.close();
    port.postMessage({ type: 'stage', stage: 'sqlite', success: results.sqlite });
    results.github = (await fetchTrending({ limit: 1 })).materials.length === 1;
    port.postMessage({ type: 'stage', stage: 'github', success: results.github });
    if (data.model) {
      let streamed = false;
      const result = await generateText({ text: 'Fictional integration test.', instruction: 'Reply exactly BRANCHOUT_OK.', dataDir: data.dataDir, onProgress: () => { streamed = true; } });
      results.model = result.text === 'BRANCHOUT_OK' && result.tools.length === 0;
      results.streamed = streamed;
      port.postMessage({ type: 'stage', stage: 'model', success: results.model, streamed, model: result.model });
    }
    port.postMessage({ type: 'done', results });
  } catch (error) { port.postMessage({ type: 'failed', code: error.code || error.name || 'probe_failed' }); }
});
