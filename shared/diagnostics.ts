import { z } from 'zod';

export const diagnosticsSettingsSchema = z.object({ enabled: z.boolean() }).strict();
export interface DiagnosticsStatus {
  enabled: boolean;
  entryCount: number;
  sizeBytes: number;
  fileCount: number;
  maxFileBytes: number;
  maxFiles: number;
  lastEventAt?: string;
  lastError?: 'storage_unavailable';
}
export interface DiagnosticsExportResult {
  cancelled: boolean;
  fileName?: string;
  entryCount?: number;
  sizeBytes?: number;
}
