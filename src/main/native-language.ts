import type { Language } from "../shared/language";
let current: Language = "zh-CN";
export function setNativeLanguage(language: Language) {
  current = language;
}
export function nativeText(zh: string, en: string) {
  return current === "en" ? en : zh;
}

export function nativeLanguage() {
  return current;
}
