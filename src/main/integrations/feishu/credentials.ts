import { z } from "zod";
import {
  feishuCredentialsSchema,
  type FeishuCredentials,
} from "../../../shared/feishu-contracts";
import { BotStore } from "../bots/atomic-store";
const schema = z
  .object({
    version: z.literal(1),
    credentials: feishuCredentialsSchema.nullable(),
  })
  .strict();
/** Matches the application's current-user local credential boundary (0600). */
export class FeishuCredentialStore extends BotStore<z.infer<typeof schema>> {
  constructor(file: string) {
    super(file, schema, { version: 1, credentials: null });
  }
  get() {
    return this.snapshot().credentials;
  }
  save(value: FeishuCredentials | null) {
    return this.update((state) => {
      state.credentials = value;
    });
  }
}
