export const ipcErrorMessages = {
  invalid_request: {
    "zh-CN": "无效的请求，请重新打开页面后重试。",
    en: "Invalid request. Reopen the page and retry.",
  },
  unavailable: {
    "zh-CN": "连接或组件暂不可用，请检查设置后重试。",
    en: "Connection or component unavailable. Check Settings and retry.",
  },
  invalid_input: {
    "zh-CN": "输入无效，请检查字段、链接或当前版本。",
    en: "Invalid input. Check the fields, link, or current version.",
  },
  operation_failed: {
    "zh-CN": "操作未完成，请检查配置或稍后重试。",
    en: "Operation incomplete. Check configuration or retry later.",
  },
} as const;
export type IpcErrorCode = keyof typeof ipcErrorMessages;
export function ipcErrorCode(message: string): IpcErrorCode {
  if (/无效.*请求|无效.*参数/.test(message)) return "invalid_request";
  if (/不可用|未连接|登录|认证|组件/.test(message)) return "unavailable";
  if (/版本|输入|链接|字符|字段|不能为空/.test(message)) return "invalid_input";
  return "operation_failed";
}
