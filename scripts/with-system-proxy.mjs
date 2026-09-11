import { execFileSync, spawn } from 'node:child_process';
const env = { ...process.env, NODE_USE_ENV_PROXY: '1', ELECTRON_GET_USE_PROXY: '1' };
if (process.platform === 'darwin' && !env.HTTPS_PROXY && !env.https_proxy) {
  const raw = execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8' });
  const get = name => raw.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'm'))?.[1]?.trim();
  if (get('HTTPSEnable') === '1' && get('HTTPSProxy') && /^\d+$/.test(get('HTTPSPort') || '')) {
    env.HTTPS_PROXY = `http://${get('HTTPSProxy')}:${get('HTTPSPort')}`;
    env.HTTP_PROXY ||= env.HTTPS_PROXY;
  }
}
const [command, ...args] = process.argv.slice(2);
if (!command) throw Error('Missing command');
const child = spawn(command, args, { env, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
child.on('error', () => { console.error('Failed to start command'); process.exitCode = 1; });
