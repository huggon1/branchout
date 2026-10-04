import { setNativeLanguage } from "./native-language";
import { Menu } from "electron";
import type { Language } from "../shared/language";
export function installMenu(language: Language, open: () => void) {
  setNativeLanguage(language);
  const label = (zh: string, en: string) => (language === "en" ? en : zh);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Branchout",
        submenu: [
          { label: label("显示窗口", "Show window"), click: open },
          { type: "separator" },
          { role: "quit", label: label("退出 Branchout", "Quit Branchout") },
        ],
      },
      {
        label: label("编辑", "Edit"),
        submenu: [
          { role: "undo", label: label("撤销", "Undo") },
          { role: "redo", label: label("重做", "Redo") },
          { type: "separator" },
          { role: "cut", label: label("剪切", "Cut") },
          { role: "copy", label: label("复制", "Copy") },
          { role: "paste", label: label("粘贴", "Paste") },
          { role: "selectAll", label: label("全选", "Select all") },
        ],
      },
      {
        label: label("显示", "View"),
        submenu: [
          { role: "reload", label: label("重新加载", "Reload") },
          {
            role: "toggleDevTools",
            label: label("开发者工具", "Developer tools"),
          },
          { type: "separator" },
          { role: "resetZoom", label: label("实际大小", "Actual size") },
          { role: "zoomIn", label: label("放大", "Zoom in") },
          { role: "zoomOut", label: label("缩小", "Zoom out") },
          { role: "togglefullscreen", label: label("全屏", "Full screen") },
        ],
      },
    ]),
  );
}
