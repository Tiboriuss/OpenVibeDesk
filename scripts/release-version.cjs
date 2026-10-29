#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

/** Windows installer version fields also need a bounded major/minor/patch. */
function releaseVersion(value) {
  if (typeof value !== 'string' || value.length > 80) throw Error('Use a semantic version such as 0.2.0 or 0.2.0-beta.1.');
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match || match[0] !== value || match.slice(1, 4).some(part => BigInt(part) > 65535n) || match[4]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) throw Error('Use MAJOR.MINOR.PATCH[-prerelease], with numeric version fields from 0 to 65535 and no leading zeroes or build metadata.');
  return value;
}
function releaseContext(env = process.env, event) {
  event ??= env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit) || env.GITHUB_SHA && env.GITHUB_SHA !== commit) throw Error('The checked-out commit does not match the workflow source.');
  if (env.GITHUB_EVENT_NAME === 'release') {
    const release = event.release;
    if (event.action !== 'published' || !release || release.draft !== false || !Number.isSafeInteger(release.id) || release.id <= 0) throw Error('Only a published release can receive installer assets.');
    if (typeof release.tag_name !== 'string') throw Error('Release tags must be semantic versions, for example 0.2.0 or v0.2.0-beta.1.');
    const version = releaseVersion(release.tag_name.startsWith('v') ? release.tag_name.slice(1) : release.tag_name);
    const taggedCommit = execFileSync('git', ['rev-parse', '--verify', `refs/tags/${release.tag_name}^{commit}`], { encoding: 'utf8' }).trim();
    if (taggedCommit !== commit) throw Error('The release tag does not point to the checked-out commit.');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY ?? '') || event.repository?.full_name?.toLowerCase() !== env.GITHUB_REPOSITORY.toLowerCase()) throw Error('The release repository does not match the workflow repository.');
    return { version, commit, tag: release.tag_name, releaseId: String(release.id), repository: env.GITHUB_REPOSITORY };
  }
  if (env.GITHUB_EVENT_NAME && env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw Error('This packaging helper supports release publication and manual build-only runs.');
  return { version: releaseVersion(env.RELEASE_DRY_RUN_VERSION?.trim() || pkg.version), commit, tag: '', releaseId: '', repository: env.GITHUB_REPOSITORY ?? '' };
}
function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--write') || args.length > 1) throw Error('Usage: node scripts/release-version.cjs [--write]');
  const context = releaseContext();
  if (args.includes('--write')) {
    const target = path.resolve('package.json'), pkg = JSON.parse(fs.readFileSync(target, 'utf8'));
    pkg.version = context.version;
    fs.writeFileSync(target, JSON.stringify(pkg, null, 2) + '\n');
  }
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${context.version}\ncommit=${context.commit}\ntag=${context.tag}\nrelease_id=${context.releaseId}\n`);
  console.log(`${context.tag || 'Build only'}: ${context.version} from ${context.commit}`);
}
module.exports = { releaseVersion, releaseContext };
if (require.main === module) try { main(); } catch (error) { console.error(error.message || String(error)); process.exitCode = 1; }
