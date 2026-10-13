import { z } from "zod";
export const languageSchema = z.enum(["zh-CN", "en"]);
export type Language = z.infer<typeof languageSchema>;
export const localizedText = (
  language: string | undefined,
  zh: string,
  en: string,
) => (language === "en" ? en : zh);
export const outputLanguage = (language: Language = "zh-CN") =>
  `Write reader-facing output in ${language === "en" ? "English" : "Simplified Chinese"}. Keep original quotations, URLs, and technical identifiers unchanged.`;
