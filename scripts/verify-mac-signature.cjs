#!/usr/bin/env node
'use strict';
// Verify sealed package integrity, without relying on a trusted signing identity.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const assert = (condition, message) => { if (!condition) throw Error(message); };
const machOHeaders = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);
function command(file, args) {
  try { return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }).trim(); }
  catch (error) { throw Error(`${path.basename(file)} failed: ${(error.stderr?.toString() || error.message).trim().slice(-4000)}`); }
}
function argumentsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    assert(['--app', '--arch'].includes(key) && argv[index + 1] && !result[key], 'Usage: node scripts/verify-mac-signature.cjs --app <OpenVibeDesk.app> --arch <arm64|x64>');
    result[key] = argv[index + 1];
  }
  assert(result['--app'] && ['arm64', 'x64'].includes(result['--arch']), 'A packaged app and its arm64 or x64 architecture are required.');
  return result;
}
async function machOFiles(directory) {
  const files = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      // Framework symlinks point back to their real version directory. Check the
      // real files once; never follow links out of the supplied package.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!entry.isFile()) continue;
      const handle = await fs.open(file, 'r');
      try {
        const header = Buffer.alloc(4), { bytesRead } = await handle.read(header, 0, 4, 0);
        if (bytesRead === 4 && machOHeaders.has(header.toString('hex'))) files.push(file);
      } finally { await handle.close(); }
    }
  }
  await walk(directory);
  return files;
}
async function verify(appPath, arch) {
  assert(process.platform === 'darwin', 'macOS package integrity must be verified on macOS.');
  assert(['arm64', 'x64'].includes(arch), 'Unknown macOS package architecture.');
  const app = await fs.realpath(appPath), stat = await fs.lstat(app);
  assert(stat.isDirectory() && path.basename(app) === 'OpenVibeDesk.app', 'Use the packaged OpenVibeDesk.app bundle.');
  const plist = path.join(app, 'Contents', 'Info.plist');
  const read = property => command('/usr/libexec/PlistBuddy', ['-c', `Print ${property}`, plist]);
  assert(read('CFBundleIdentifier') === 'org.openworkspace.desktop', 'The packaged application identifier changed.');
  assert(read('CFBundleExecutable') === 'OpenVibeDesk', 'The packaged executable name changed.');
  let seal;
  try { seal = await fs.lstat(path.join(app, 'Contents', '_CodeSignature', 'CodeResources')); } catch { throw Error('The app has no sealed resource manifest. Package it with a valid code signature before publishing.'); }
  assert(seal.isFile() && !seal.isSymbolicLink(), 'The app resource seal must be a regular file.');
  command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  // codesign writes its descriptive output to stderr, even on success.
  const display = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', app], { encoding: 'utf8', timeout: 30_000 });
  assert(display.status === 0 && !display.error, 'The app signature cannot be inspected.');
  const details = `${display.stdout || ''}\n${display.stderr || ''}`;
  assert(/^Identifier=org\.openworkspace\.desktop$/m.test(details) && /^CDHash=[0-9a-f]{40,64}$/mi.test(details), 'The sealed app identity or CodeDirectory hash is missing.');
  const requiredArch = arch === 'x64' ? 'x86_64' : 'arm64';
  const files = await machOFiles(path.join(app, 'Contents'));
  assert(files.includes(path.join(app, 'Contents', 'MacOS', 'OpenVibeDesk')), 'The primary executable is not a Mach-O binary.');
  for (const file of files) {
    const architectures = command('/usr/bin/lipo', ['-archs', file]).split(/\s+/);
    assert(architectures.includes(requiredArch), `Wrong architecture in ${path.relative(app, file)}: expected ${requiredArch}.`);
    command('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', file]);
  }
  console.log(`Verified ${arch} app resource seal and ${files.length} Mach-O signatures. Trusted publisher identity and notarization are assessed separately.`);
  return { arch, binaries: files.length };
}
if (require.main === module) {
  try { const args = argumentsOf(process.argv.slice(2)); verify(args['--app'], args['--arch']).catch(error => { console.error(error.message || String(error)); process.exitCode = 1; }); }
  catch (error) { console.error(error.message || String(error)); process.exitCode = 1; }
}
module.exports = { verify };
