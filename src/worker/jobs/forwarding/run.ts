import { runReadingJob, type ReadingDependencies } from "./reading";
import { z } from "zod";
import { executionSchema } from "../../../shared/model-contracts";
import {
  forwardingJobCommandSchema,
  type ForwardingJobEventContract,
} from "./contracts";

const runtimeCommandSchema = forwardingJobCommandSchema
  .extend({ config: executionSchema })
  .strict();
export type { ForwardingJobEventContract as ForwardingJobEvent } from "./contracts";

export async function runForwardingJob(
  raw: unknown,
  emit: (event: ForwardingJobEventContract) => void,
  signal: AbortSignal,
  overrides: { reading?: Partial<ReadingDependencies> } = {},
) {
  const command = runtimeCommandSchema.parse(raw);
  return runReadingJob(command, emit, signal, overrides.reading);
}
