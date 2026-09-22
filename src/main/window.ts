import { BrowserWindow } from 'electron';
import { join } from 'node:path';
export function createWindow() {
  const window = new BrowserWindow({ width: 1100, height: 760, minWidth: 640, minHeight: 480, backgroundColor: '#f5f7f8', title: 'Branchout', webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  void window.loadFile(join(__dirname, '../renderer/index.html'));
  return window;
}
