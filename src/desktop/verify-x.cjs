const { app, session } = require('electron');
const { join, isAbsolute } = require('node:path');
const { homedir } = require('node:os');
const { spawn } = require('node:child_process');
app.setPath('userData', join(homedir(), 'Library', 'Application Support', 'Branchout'));
app.whenReady().then(async () => {
  const runtime = process.env.BRANCHOUT_X_RUNTIME;
  if (!runtime || !isAbsolute(runtime)) throw Error('runtime_required');
  const isolated = session.fromPartition('persist:branchout-x');
  const cookies = await isolated.cookies.get({ url: 'https://x.com' });
  const token = cookies.find(c => c.name === 'auth_token')?.value;
  const csrf = cookies.find(c => c.name === 'ct0')?.value;
  if (!token || !csrf) throw Error('login_required');
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ELECTRON_RUN_AS_NODE: '1', NODE_USE_ENV_PROXY: '1', AUTH_TOKEN: token, CT0: csrf, BIRD_DISABLE_BROWSER_COOKIES: '1' };
  const proxy = await session.defaultSession.resolveProxy('https://x.com');
  const match = proxy.match(/(?:^|;\s*)PROXY\s+([^;]+)/);
  if (match) env.HTTPS_PROXY = env.HTTP_PROXY = `http://${match[1]}`;
  const child = spawn(process.execPath, [runtime, 'AI', '--count', '3', '--json'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  let output = '', overflow = false;
  const timeout = setTimeout(() => child.kill(), 45_000);
  child.stdout.on('data', chunk => { if (output.length > 1_000_000) { overflow = true; child.kill(); } else output += chunk; });
  child.on('error', () => { clearTimeout(timeout); console.log('{"platform":"x","status":"runtime_failed"}'); app.exit(1); });
  child.on('exit', async code => {
    clearTimeout(timeout);
    try {
      const raw = JSON.parse(output);
      if (overflow || code !== 0 || !Array.isArray(raw)) {
        console.log(JSON.stringify({ platform: 'x', status: 'search_failed', category: /401|403|auth|login/i.test(raw.error || '') ? 'authentication_or_access' : 'runtime_or_platform' })); app.exit(1); return;
      }
      const { normalizeXSearch } = await import('../adapters/social.mjs');
      const rows = normalizeXSearch(raw);
      console.log(JSON.stringify({ platform: 'x', status: 'search_response_valid', count: rows.length, bodyAvailable: rows.every(m => !!m.text) }));
      app.exit(0);
    } catch { console.log('{"platform":"x","status":"invalid_response"}'); app.exit(1); }
  });
}).catch(error => { console.log(JSON.stringify({ platform: 'x', status: ['login_required', 'runtime_required'].includes(error.message) ? error.message : 'probe_failed' })); app.exit(1); });
