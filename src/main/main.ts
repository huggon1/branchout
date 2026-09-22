import { app, BrowserWindow, dialog, ipcMain, Menu, utilityProcess } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { channels } from '../shared/ipc-contracts';
import { Store } from './storage/store';
import { TaskManager } from './task-manager';
import { createWindow } from './window';
if (process.env.BRANCHOUT_TEST_DATA) app.setPath('userData', process.env.BRANCHOUT_TEST_DATA);
else app.setPath('userData', join(app.getPath('appData'), 'Branchout Foundation'));
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  let manager: TaskManager | undefined;
  let quitting = false;
  const open = () => { const existing = BrowserWindow.getAllWindows()[0]; if (existing) { existing.show(); existing.focus(); } else createWindow(); };
  app.on('second-instance', open);
  app.on('activate', () => { if (app.isReady()) open(); });
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => { if (!quitting && manager) { event.preventDefault(); quitting = true; void manager.shutdown().finally(() => app.quit()); } });
  void app.whenReady().then(async () => {
    const store = new Store(join(app.getPath('userData'), 'foundation.json')); await store.open();
    manager = new TaskManager(store, () => utilityProcess.fork(join(__dirname, '../worker/main.cjs')), () => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channels.changed); });
    await manager.recover();
    const expected = pathToFileURL(join(__dirname, '../renderer/index.html')).href;
    for (const channel of [channels.snapshot, channels.check, channels.cancel]) ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== expected) throw new Error('无效的界面请求');
      if (channel !== channels.cancel && args.length !== 0) throw new Error('无效的请求参数');
      if (channel === channels.snapshot) return store.snapshot();
      if (channel === channels.check) return manager!.start();
      if (args.length !== 1) throw new Error('无效的请求参数');
      return manager!.cancel(z.string().uuid().parse(args[0]));
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Branchout', submenu: [{ label: '显示窗口', click: open }, { type: 'separator' }, { role: 'quit' }] }, { role: 'editMenu' }, { role: 'viewMenu' }]));
    open();
    const session = BrowserWindow.getAllWindows()[0].webContents.session;
    session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
  }).catch(() => { dialog.showErrorBox('Branchout 无法启动', '无法读取本地数据或初始化应用。原数据已保留。'); app.exit(1); });
}
