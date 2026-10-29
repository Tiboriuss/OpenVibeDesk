#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { releaseContext } = require('./release-version.cjs');
const targets = { 'mac-arm64': 'dmg', 'mac-x64': 'dmg', 'win-x64': 'exe' };
const shaPattern = /^[a-f0-9]{64}$/;
const stage = 'release-artifacts', output = 'release-publish';
const filename = (version, target) => `OpenVibeDesk-${version}-${target}.${targets[target]}`;
const canonical = value => JSON.stringify(value, null, 2) + '\n';
const assert = (value, message) => { if (!value) throw Error(message); };
async function digest(file) {
  const stat = await fsp.lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 1024 * 1024 * 1024, 'Release assets must be nonempty regular files no larger than 1 GiB.');
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return { bytes: stat.size, sha256: hash.digest('hex') };
}
async function jsonFile(file) {
  const stat = await fsp.lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 64 * 1024, 'Invalid release metadata file.');
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}
async function collect(target, context) {
  assert(Object.hasOwn(targets, target), 'Unknown installer target.');
  const name = filename(context.version, target), source = path.join('release', name), checked = await digest(source);
  await fsp.mkdir(stage, { recursive: true });
  await fsp.copyFile(source, path.join(stage, name), fs.constants.COPYFILE_EXCL);
  const metadata = { schemaVersion: 1, version: context.version, commit: context.commit, target, filename: name, ...checked };
  await fsp.writeFile(path.join(stage, `${target}.json`), canonical(metadata), { flag: 'wx' });
  console.log(`Collected ${name} (${checked.bytes} bytes).`);
}
function releaseManifest(context, installers) {
  return { schemaVersion: 1, version: context.version, sourceCommit: context.commit, signing: 'unsigned', updateMethod: 'Install a newer release over the existing application. User data is stored separately; no automatic update service is included.', installers };
}
async function assemble(context) {
  const names = await fsp.readdir(stage), expected = Object.keys(targets).flatMap(target => [filename(context.version, target), `${target}.json`]);
  assert(names.length === expected.length && names.every(name => expected.includes(name)), 'The complete set of three installer artifacts is required; unexpected files are rejected.');
  const installers = [];
  for (const target of Object.keys(targets)) {
    const name = filename(context.version, target), metadata = await jsonFile(path.join(stage, `${target}.json`)), checked = await digest(path.join(stage, name));
    assert(metadata.schemaVersion === 1 && metadata.version === context.version && metadata.commit === context.commit && metadata.target === target && metadata.filename === name && metadata.bytes === checked.bytes && metadata.sha256 === checked.sha256, `Installer provenance or checksum mismatch for ${target}.`);
    installers.push({ target, filename: name, ...checked });
  }
  await fsp.mkdir(output);
  for (const item of installers) await fsp.copyFile(path.join(stage, item.filename), path.join(output, item.filename), fs.constants.COPYFILE_EXCL);
  await fsp.writeFile(path.join(output, 'RELEASE.json'), canonical(releaseManifest(context, installers)), { flag: 'wx' });
  const checksums = [];
  for (const name of [...installers.map(item => item.filename), 'RELEASE.json'].sort()) checksums.push(`${(await digest(path.join(output, name))).sha256}  ${name}`);
  await fsp.writeFile(path.join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n', { flag: 'wx' });
  console.log('Verified all three installers and wrote RELEASE.json and SHA256SUMS.txt.');
}
async function verifiedAssets(context) {
  const manifest = await jsonFile(path.join(output, 'RELEASE.json'));
  assert(Array.isArray(manifest.installers) && manifest.installers.length === 3, 'All three installers must be present.');
  const installers = [];
  for (const target of Object.keys(targets)) {
    const name = filename(context.version, target), item = manifest.installers.find(item => item.target === target), checked = await digest(path.join(output, name));
    assert(item?.filename === name && item.bytes === checked.bytes && item.sha256 === checked.sha256, `Invalid installer checksum for ${target}.`);
    installers.push({ target, filename: name, ...checked });
  }
  assert(canonical(manifest) === canonical(releaseManifest(context, installers)), 'The release manifest does not match this version and source commit.');
  const names = [...installers.map(item => item.filename), 'RELEASE.json', 'SHA256SUMS.txt'];
  const actual = await fsp.readdir(output);
  assert(actual.length === names.length && actual.every(name => names.includes(name)), 'Unexpected release files are not uploaded.');
  const assets = [];
  for (const name of names) assets.push({ name, ...(await digest(path.join(output, name))) });
  const expectedSums = assets.filter(item => item.name !== 'SHA256SUMS.txt').sort((a, b) => a.name.localeCompare(b.name)).map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n';
  assert(await fsp.readFile(path.join(output, 'SHA256SUMS.txt'), 'utf8') === expectedSums, 'SHA256SUMS.txt does not match the installers.');
  return assets;
}
async function api(url, token, options = {}) {
  assert(url.startsWith('https://api.github.com/') || url.startsWith('https://uploads.github.com/'), 'Unsupported GitHub API destination.');
  const response = await fetch(url, { ...options, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'OpenVibeDesk release workflow', Authorization: `Bearer ${token}`, ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(options.body ? 300_000 : 30_000) });
  assert(response.ok, `GitHub ${options.method ?? 'GET'} failed with HTTP ${response.status}. Existing release assets have not been overwritten.`);
  return response.json();
}
async function currentRelease(context, token) {
  const base = `https://api.github.com/repos/${context.repository}`;
  const release = await api(`${base}/releases/${context.releaseId}`, token);
  assert(String(release.id) === context.releaseId && release.tag_name === context.tag && release.draft === false && release.published_at, 'The original published release no longer matches this run.');
  assert(!release.immutable, 'This release is immutable and cannot receive assets after publication. Disable immutable releases for this release-triggered workflow, or use a draft-first signing/publishing process.');
  let ref = await api(`${base}/git/ref/tags/${encodeURIComponent(context.tag)}`, token), object = ref.object;
  for (let depth = 0; object?.type === 'tag' && depth < 8; depth++) object = (await api(`${base}/git/tags/${object.sha}`, token)).object;
  assert(object?.type === 'commit' && object.sha === context.commit, 'The release tag moved after the build. No installer will be attached to a different source version.');
  return release;
}
async function upload(context) {
  assert(context.releaseId && context.tag && process.env.GITHUB_EVENT_NAME === 'release', 'Manual builds never upload or create releases.');
  const token = process.env.GITHUB_TOKEN;
  assert(typeof token === 'string' && token.length > 0, 'The job needs its scoped GITHUB_TOKEN with contents: write.');
  const assets = await verifiedAssets(context), release = await currentRelease(context, token);
  const uploadBase = `https://uploads.github.com/repos/${context.repository}/releases/${context.releaseId}/assets`;
  assert(release.upload_url?.split('{')[0] === uploadBase, 'Unexpected upload destination for the release.');
  const existing = [];
  for (let page = 1; page <= 100; page++) {
    const items = await api(`https://api.github.com/repos/${context.repository}/releases/${context.releaseId}/assets?per_page=100&page=${page}`, token);
    assert(Array.isArray(items), 'Invalid release asset listing.'); existing.push(...items);
    if (items.length < 100) break;
    assert(page < 100, 'The release has too many assets to safely inspect.');
  }
  // Reject all conflicts before starting uploads. Identical assets make partial reruns safe.
  for (const asset of assets) {
    const match = existing.find(item => item.name === asset.name);
    if (match) assert(match.state === 'uploaded' && match.size === asset.bytes && match.digest === `sha256:${asset.sha256}`, `Existing asset ${asset.name} differs or has no verifiable checksum. It will not be overwritten; inspect it before retrying.`);
  }
  for (const asset of assets) {
    if (existing.some(item => item.name === asset.name)) { console.log(`Already present with matching checksum: ${asset.name}`); continue; }
    await currentRelease(context, token);
    const uploaded = await api(`${uploadBase}?name=${encodeURIComponent(asset.name)}`, token, { method: 'POST', body: fs.createReadStream(path.join(output, asset.name)), duplex: 'half', headers: { 'Content-Type': asset.name.endsWith('.json') ? 'application/json' : asset.name.endsWith('.txt') ? 'text/plain' : 'application/octet-stream', 'Content-Length': String(asset.bytes) } });
    assert(uploaded.name === asset.name && uploaded.state === 'uploaded' && uploaded.size === asset.bytes && uploaded.digest === `sha256:${asset.sha256}`, `GitHub did not confirm the expected checksum for ${asset.name}; inspect the release before retrying.`);
    console.log(`Attached ${asset.name} to ${context.tag}.`);
  }
}
async function main() {
  const [command, target, ...extra] = process.argv.slice(2), context = releaseContext();
  assert(!extra.length, 'Unexpected release helper arguments.');
  if (command === 'collect') return collect(target, context);
  assert(!target, 'Unexpected release target.');
  if (command === 'assemble') return assemble(context);
  if (command === 'upload') return upload(context);
  throw Error('Usage: node scripts/release-assets.cjs collect <mac-arm64|mac-x64|win-x64> | assemble | upload');
}
module.exports = { collect, assemble, verifiedAssets, upload, releaseManifest };
if (require.main === module) main().catch(error => { console.error(error.message || String(error)); process.exitCode = 1; });
