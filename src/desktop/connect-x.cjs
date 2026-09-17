const { app, BrowserWindow, session } = require('electron');
const { join } = require('node:path');
const { homedir } = require('node:os');
app.setPath('userData', join(homedir(), 'Library', 'Application Support', 'Feedloom'));
app.setName('nature-feed');
let win, timer;
app.whenReady().then(async () => {
  const isolated = session.fromPartition('persist:feedloom-x');
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  win = new BrowserWindow({ width: 1060, height: 780, title: 'nature-feed · 连接 X', webPreferences: { session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    try { const u = new URL(url); if (u.protocol !== 'https:' || !['x.com', 'twitter.com'].some(h => u.hostname === h || u.hostname.endsWith(`.${h}`))) event.preventDefault(); } catch { event.preventDefault(); }
  });
  timer = setInterval(async () => {
    const cookies = await isolated.cookies.get({ url: 'https://x.com' });
    if (cookies.some(c => c.name === 'auth_token') && cookies.some(c => c.name === 'ct0')) {
      await isolated.cookies.flushStore(); clearInterval(timer);
      console.log(JSON.stringify({ platform: 'x', loginState: 'credentials_present', searchVerified: false }));
      win.setTitle('nature-feed · X 登录已保存，待验证搜索');
    }
  }, 2500);
  win.on('closed', () => { clearInterval(timer); app.quit(); });
  await win.loadURL('https://x.com/i/flow/login');
}).catch(() => { console.log(JSON.stringify({ platform: 'x', code: 'login_window_failed' })); app.quit(); });
app.on('window-all-closed', () => app.quit());
