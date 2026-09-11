const { app, utilityProcess, session } = require('electron');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
let child, dataDir, timer;
let finished = false;
async function finish(code) {
  if (finished) return; finished = true;
  clearTimeout(timer); child?.kill();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  app.exit(code);
}
app.whenReady().then(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'feedloom-desktop-'));
  const env = { ...process.env, NODE_USE_ENV_PROXY: '1' };
  const proxy = await session.defaultSession.resolveProxy('https://chatgpt.com');
  const match = proxy.match(/(?:^|;\s*)PROXY\s+([^;]+)/);
  if (match) env.HTTPS_PROXY = env.HTTP_PROXY = `http://${match[1]}`;
  child = utilityProcess.fork(join(__dirname, 'probe-worker.mjs'), [], { env, stdio: 'ignore', serviceName: 'Feedloom integration probe' });
  timer = setTimeout(() => { console.log(JSON.stringify({ type: 'failed', code: 'desktop_timeout' })); void finish(1); }, 120_000);
  child.on('message', message => {
    console.log(JSON.stringify({ packaged: app.isPackaged, ...message }));
    if (message.type === 'done') void finish(Object.values(message.results).every(Boolean) ? 0 : 1);
    if (message.type === 'failed') void finish(1);
  });
  child.on('exit', code => { if (!finished) { console.log(JSON.stringify({ type: 'failed', code: 'worker_exit', exitCode: code })); void finish(1); } });
  child.postMessage({ type: 'probe', dataDir, model: process.argv.includes('--model') });
}).catch(() => finish(1));
app.on('before-quit', () => child?.kill());
