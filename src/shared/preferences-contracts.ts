import { z } from "zod";
import { languageSchema } from "./language";

export const preferencesSchema = z.object({
  language: languageSchema.default("zh-CN"),
  taskBrowserVisible: z.boolean().default(false),
});
export type ApplicationPreferences = z.infer<typeof preferencesSchema>;
