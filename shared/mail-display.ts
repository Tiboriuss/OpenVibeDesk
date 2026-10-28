import { z } from 'zod';

export const mailDisplayPatchSchema = z.object({
  format: z.enum(['auto', 'html', 'text']).optional(),
  remoteImages: z.boolean().optional()
}).strict().refine(value => value.format !== undefined || value.remoteImages !== undefined, 'Bitte eine Anzeigeoption angeben.');
export type MailDisplayPatch = z.infer<typeof mailDisplayPatchSchema>;
export interface MailDisplayState { format: 'auto' | 'html' | 'text'; remoteImages: boolean; }
export interface MailDisplayResult {
  emailId: string;
  display: MailDisplayState;
  effectiveFormat: 'html' | 'text';
  htmlAvailable: boolean;
  htmlTruncated: boolean;
  message?: string;
  cancelled?: boolean;
}
export const defaultMailDisplay: MailDisplayState = { format: 'auto', remoteImages: false };
