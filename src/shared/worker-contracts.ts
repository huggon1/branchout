import { z } from 'zod';
import { resultSchema } from './domain';
export const workerCommandSchema = z.object({ type: z.literal('check'), taskId: z.string().uuid() }).strict();
export const workerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('result'), result: resultSchema }).strict(),
  z.object({ type: z.literal('completed'), taskId: z.string().uuid() }).strict(),
]);
export type WorkerEvent = z.infer<typeof workerEventSchema>;
