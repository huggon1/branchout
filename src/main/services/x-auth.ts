import { BrowserWindow, session } from "electron";
import { join } from "node:path";
import type { XCredentials } from "../../shared/platform-contracts";

const partition = "persist:branchout-x";
const allowed = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["x.com", "twitter.com"].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
};
export class XAuth {
  private window?: BrowserWindow;
  constructor(private changed: () => void) {}
  async credentials(): Promise<XCredentials | undefined> {
    const cookies = await session
      .fromPartition(partition)
      .cookies.get({ url: "https://x.com" });
    const authToken = cookies.find(
      (cookie) => cookie.name === "auth_token",
    )?.value;
    const ct0 = cookies.find((cookie) => cookie.name === "ct0")?.value;
    return authToken && ct0 ? { authToken, ct0 } : undefined;
  }
  async status() {
    return { signedIn: !!(await this.credentials()) };
  }
  async login() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return;
    }
    const window = new BrowserWindow({
      width: 960,
      height: 720,
      minWidth: 700,
      minHeight: 500,
      title: "登录 X",
      icon: join(__dirname, "../assets/branchout.png"),
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    this.window = window;
    const web = window.webContents;
    web.setWindowOpenHandler(() => ({ action: "deny" }));
    web.on("will-navigate", (event, url) => {
      if (!allowed(url)) event.preventDefault();
    });
    web.on("will-redirect", (event, url) => {
      if (!allowed(url)) event.preventDefault();
    });
    web.session.setPermissionRequestHandler((_web, _permission, callback) =>
      callback(false),
    );
    web.session.setPermissionCheckHandler(() => false);
    const notify = () => this.changed();
    web.session.cookies.on("changed", notify);
    window.on("closed", () => {
      web.session.cookies.removeListener("changed", notify);
      this.window = undefined;
      this.changed();
    });
    await window.loadURL("https://x.com/i/flow/login");
  }
  async logout() {
    this.window?.close();
    await session.fromPartition(partition).clearStorageData();
    this.changed();
  }
}
