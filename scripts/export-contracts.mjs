import { writeFile } from "node:fs/promises";
import { contractSchema } from "../src/core/contracts.ts";

await writeFile(
  new URL("../contracts/v1.json", import.meta.url),
  `${JSON.stringify(contractSchema, null, 2)}\n`,
);
