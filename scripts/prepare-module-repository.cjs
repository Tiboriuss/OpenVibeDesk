#!/usr/bin/env node
'use strict';
// Validate and stage a prebuilt module; never execute module code or publish to Git.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');

async function main() {
  const [moduleArg, repositoryArg, ...extra] = process.argv.slice(2);
  if (!moduleArg || !repositoryArg || extra.length) throw Error('Usage: node scripts/prepare-module-repository.cjs <built-module-folder> <catalog-repository-folder>\nRun pnpm build first.');
  const { ModuleRegistry } = require('../dist-electron/electron/modules.js');
  const { repositoryCatalogSchema, repositoryPathSchema } = require('../dist-electron/shared/module-repositories.js');
  const source = await fs.realpath(moduleArg), root = path.resolve(repositoryArg), files = [];
  let bytes = 0;
  async function walk(dir, prefix = '') {
    for (const name of (await fs.readdir(dir)).sort()) {
      if (name === '.DS_Store') continue;
      const relative = prefix + name, filename = path.join(dir, name), stat = await fs.lstat(filename);
      repositoryPathSchema.parse(relative);
      if (stat.isSymbolicLink()) throw Error('Symbolic links are not allowed: ' + relative);
      if (stat.isDirectory()) await walk(filename, relative + '/');
      else {
        if (!stat.isFile() || files.length >= 200 || stat.size + bytes > 16 * 1024 * 1024) throw Error('A package must contain at most 200 regular files and 16 MiB.');
        const content = await fs.readFile(filename);
        bytes += content.length;
        if (bytes > 16 * 1024 * 1024) throw Error('Package exceeds 16 MiB.');
        files.push({ path: relative, content, sha256: createHash('sha256').update(content).digest('hex') });
      }
    }
  }
  await walk(source);
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ovd-catalog-'));
  try {
    const candidate = path.join(scratch, 'candidate');
    for (const file of files) { const target = path.join(candidate, file.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, file.content, { flag: 'wx' }); }
    const registry = new ModuleRegistry(), discovered = await registry.discover({ userRoots: [scratch] });
    if (discovered.length !== 1 || discovered[0].status !== 'approval_required') throw Error(discovered[0]?.reason || 'No valid third-party module found.');
    const module = discovered[0];
    let catalog = { version: 1, title: 'OpenVibeDesk modules', modules: [] };
    const catalogPath = path.join(root, 'ovd-modules.json');
    try { catalog = repositoryCatalogSchema.parse(JSON.parse(await fs.readFile(catalogPath, 'utf8'))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const packagePath = `packages/${module.id}/${module.version}`;
    const entry = { id: module.id, title: module.title, description: module.description, version: module.version, apiVersion: module.apiVersion, package: { path: packagePath, files: files.map(({ path, sha256 }) => ({ path, sha256 })) } };
    const next = repositoryCatalogSchema.parse({ ...catalog, modules: [...catalog.modules.filter(item => item.id !== module.id), entry].sort((a, b) => a.id.localeCompare(b.id)) });
    await fs.mkdir(root, { recursive: true });
    const packageTarget = path.join(root, packagePath);
    await fs.mkdir(path.dirname(packageTarget), { recursive: true });
    // Never rewrite a published version. Bump module.json version for every release.
    await fs.mkdir(packageTarget);
    const temporary = `${catalogPath}.${randomUUID()}.tmp`;
    try {
      for (const file of files) { const target = path.join(packageTarget, file.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, file.content, { flag: 'wx' }); }
      await fs.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' });
      await fs.rename(temporary, catalogPath);
    } catch (error) { await fs.rm(packageTarget, { recursive: true, force: true }); await fs.rm(temporary, { force: true }); throw error; }
    console.log(`Prepared ${module.id} ${module.version}: ${files.length} files, ${bytes} bytes.\nReview and commit ${packagePath} and ovd-modules.json in ${root}. No Git operation was performed.`);
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message || String(error)); process.exitCode = 1; });
