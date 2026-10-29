import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Include actual compiled adapter/shared code: packaged module folders contain only manifests. */
export async function operationHostIdentity(root: string): Promise<string> {
  const digest = createHash('sha256');
  async function visit(directory: string): Promise<void> {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name.endsWith('.js')) digest.update(path.relative(root, file).split(path.sep).join('/')).update('\0').update(await fs.readFile(file)).update('\0');
    }
  }
  await visit(root);
  return digest.digest('hex');
}
