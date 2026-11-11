import { z } from 'zod';

/** Stable source identity retained with a mail snapshot; never a message search hint. */
export const mailSourceLocatorSchema = z.object({
  accountId: z.uuid(),
  connectionHash: z.string().regex(/^[a-f0-9]{64}$/),
  folder: z.string().min(1).max(1024).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
  uidValidity: z.string().regex(/^[0-9]{1,20}$/),
  uid: z.number().int().min(1).max(4294967295)
}).strict();
export type MailSourceLocator = z.infer<typeof mailSourceLocatorSchema>;
