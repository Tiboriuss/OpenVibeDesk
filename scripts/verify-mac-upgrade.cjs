#!/usr/bin/env node
'use strict';
// Exercise real packaged apps in a disposable Applications folder and profile.
// Inspector access is confined to loopback and removed when each fixture exits.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { releaseVersion } = require('./release-version.cjs');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const assert = (condition, message) => { if (!condition) throw Error(message); };

function argumentsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!['--app', '--next-app', '--version', '--work-dir'].includes(key) || !argv[index + 1] || result[key]) throw Error('Usage: node scripts/verify-mac-upgrade.cjs --app <OpenVibeDesk.app> [--version <version>] [--next-app <newer.app>] [--work-dir <new-empty-directory>]');
    result[key] = argv[index + 1];
  }
  if (!result['--app']) throw Error('A packaged OpenVibeDesk.app is required.');
  return result;
}
function info(app, property) {
  return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print ${property}`, path.join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
}
async function appInfo(requested) {
  const app = await fs.realpath(requested), stat = await fs.lstat(app);
  assert(stat.isDirectory() && path.basename(app) === 'OpenVibeDesk.app', 'Use a prebuilt OpenVibeDesk.app bundle.');
  const version = releaseVersion(info(app, 'CFBundleShortVersionString'));
  assert(info(app, 'CFBundleIdentifier') === 'org.openworkspace.desktop', 'The package application ID changed.');
  const executable = info(app, 'CFBundleExecutable');
  assert(executable === 'OpenVibeDesk', 'The package executable name changed.');
  return { app, version, executable: path.join(app, 'Contents', 'MacOS', executable) };
}
function nextVersion(version) {
  const fields = version.split('-')[0].split('.').map(Number);
  for (let index = 2; index >= 0; index--) if (fields[index] < 65535) { fields[index]++; for (let after = index + 1; after < 3; after++) fields[after] = 0; return fields.join('.'); }
  throw Error('No higher Windows-compatible fixture version is available.');
}
function newerThan(version, old) {
  releaseVersion(version); releaseVersion(old);
  const parse = value => /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(value);
  const a = parse(version), b = parse(old);
  for (let index = 1; index <= 3; index++) if (a[index] !== b[index]) return Number(a[index]) > Number(b[index]);
  if (a[4] === undefined || b[4] === undefined) return a[4] !== b[4] && a[4] === undefined;
  const left = a[4].split('.'), right = b[4].split('.');
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    if (left[index] === right[index]) continue;
    if (left[index] === undefined || right[index] === undefined) return left[index] !== undefined;
    const ln = /^\d+$/.test(left[index]), rn = /^\d+$/.test(right[index]);
    if (ln && rn) return BigInt(left[index]) > BigInt(right[index]);
    if (ln !== rn) return !ln;
    return left[index] > right[index];
  }
  return false;
}

async function run(file, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(Error('Temporary package build exceeded ten minutes.')); }, 600_000);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-16000); });
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-16000); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(`Temporary package build failed (${code}): ${output.slice(-2000)}`)); });
  });
}
class Inspector {
  constructor(socket) {
    this.socket = socket; this.pending = new Map(); this.sequence = 0; this.pauses = []; this.waiters = []; this.scripts = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        message.error ? pending.reject(Error(message.error.message)) : pending.resolve(message.result);
      } else if (message.method === 'Debugger.scriptParsed') this.scripts.set(message.params.scriptId, message.params.url);
      else if (message.method === 'Debugger.paused') { const waiter = this.waiters.shift(); waiter ? waiter(message.params) : this.pauses.push(message.params); }
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    return new Inspector(socket);
  }
  call(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`Inspector command timed out: ${method}`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async paused() {
    if (this.pauses.length) return this.pauses.shift();
    return new Promise((resolve, reject) => {
      const waiter = value => { clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => { this.waiters = this.waiters.filter(item => item !== waiter); reject(Error('The package did not pause at its main entry point.')); }, 20000);
      this.waiters.push(waiter);
    });
  }
  async value(expression) {
    const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(Error('Inspector closed.')); } this.pending.clear(); this.socket.close(); }
}
async function launch(app, appData) {
  const userData = path.join(appData, 'ai-workspace'); await fs.mkdir(userData, { recursive: true });
  const child = spawn(app.executable, [`--user-data-dir=${userData}`, '--inspect-brk=127.0.0.1:0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', exited = false, inspector;
  const exit = new Promise(resolve => child.once('exit', (code, signal) => { exited = true; resolve({ code, signal }); }));
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-64000); });
  child.stdout.on('data', () => {});
  let spawnError; child.once('error', error => { spawnError = error; });
  const until = async (label, check, timeout = 30000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (spawnError) throw spawnError;
      if (exited) throw Error(`Packaged app exited before ${label}: ${stderr.slice(-1800)}`);
      const result = await check(); if (result) return result;
      await pause(50);
    }
    throw Error(`Packaged app did not reach ${label}: ${stderr.slice(-1800)}`);
  };
  try {
    const url = await until('loopback inspector', () => stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/)?.[0]);
    inspector = await Inspector.connect(url);
    await inspector.call('Debugger.enable');
    await inspector.call('Debugger.setBreakpointByUrl', { urlRegex: '[/\\\\]dist-electron[/\\\\]electron[/\\\\]main\\.js$', lineNumber: 0 });
    await inspector.call('Runtime.runIfWaitingForDebugger');
    let mainFrame;
    for (let attempts = 0; attempts < 8; attempts++) {
      const paused = await inspector.paused(), frame = paused.callFrames[0];
      const url = frame.url || inspector.scripts.get(frame.location.scriptId) || '';
      if (/[/\\]dist-electron[/\\]electron[/\\]main\.js$/.test(url)) { mainFrame = frame; break; }
      await inspector.call('Debugger.resume');
    }
    assert(mainFrame, 'Could not isolate the profile before application main code.');
    const redirected = await inspector.call('Debugger.evaluateOnCallFrame', { callFrameId: mainFrame.callFrameId, returnByValue: true, expression: `(()=>{const electron=require('electron');if(electron.app.isReady())throw Error('Profile redirect happened too late');electron.app.setPath('appData',${JSON.stringify(appData)});electron.app.setPath('userData',${JSON.stringify(userData)});globalThis.__ovdUpgradeQA={electron,require};return {packaged:electron.app.isPackaged,appData:electron.app.getPath('appData'),userData:electron.app.getPath('userData')}})()` });
    assert(!redirected.exceptionDetails && redirected.result.value?.packaged && redirected.result.value?.appData === appData && redirected.result.value?.userData === userData, 'Could not redirect the packaged app to its disposable profile.');
    await inspector.call('Debugger.resume');
    const status = await until('working packaged window', () => inspector.value(`(()=>{const {electron,require}=globalThis.__ovdUpgradeQA;const dock=electron.BrowserWindow.getAllWindows().find(w=>{try{return new URL(w.webContents.getURL()).searchParams.get('view')==='dock'}catch{return false}});if(!electron.app.isReady()||!dock)return null;return dock.webContents.executeJavaScript('!!window.workspace && !!document.body && document.body.textContent.length>0').then(ready=>ready?{packaged:electron.app.isPackaged,version:electron.app.getVersion(),userData:electron.app.getPath('userData'),nativeKeyring:typeof require('@napi-rs/keyring').AsyncEntry==='function'}:null)})()`));
    assert(status.packaged && status.version === app.version && status.userData === userData && status.nativeKeyring, 'Packaged identity, native keyring, version or profile was incorrect.');
    return {
      status,
      ui: (expression, view = 'dock') => inspector.value(`(()=>{const {electron}=globalThis.__ovdUpgradeQA;const window=electron.BrowserWindow.getAllWindows().find(w=>{try{return new URL(w.webContents.getURL()).searchParams.get('view')===${JSON.stringify(view)}}catch{return false}});if(!window)throw Error('Fixture window missing');return window.webContents.executeJavaScript(${JSON.stringify(expression)},true)})()`),
      async close() {
        // A connected Node inspector can hold process exit; allow the app's normal
        // asynchronous quit/save path to finish, then detach to release that hold.
        await inspector.value('globalThis.__ovdUpgradeQA.electron.app.quit();true');
        await pause(750); inspector.close();
        const outcome = await Promise.race([exit, pause(15000).then(() => { throw Error('The packaged app did not quit and save normally.'); })]);
        assert(outcome.code === 0, `The packaged app did not exit normally (${outcome.code ?? outcome.signal}).`);
      },
      kill() { inspector?.close(); if (!exited) child.kill('SIGTERM'); }
    };
  } catch (error) { inspector?.close(); if (!exited) child.kill('SIGTERM'); throw error; }
}

async function main() {
  assert(process.platform === 'darwin', 'This check requires macOS.');
  const args = argumentsOf(process.argv.slice(2)), first = await appInfo(args['--app']);
  if (args['--version']) assert(first.version === releaseVersion(args['--version']), 'The supplied package has a different release version.');
  const parent = process.env.RUNNER_TEMP || os.tmpdir();
  const work = args['--work-dir'] ? path.resolve(args['--work-dir']) : await fs.mkdtemp(path.join(parent, 'ovd-mac-upgrade-'));
  if (args['--work-dir']) await fs.mkdir(work, { recursive: false });
  const applications = path.join(work, 'Applications'), installed = path.join(applications, 'OpenVibeDesk.app'), appData = path.join(work, 'appData');
  await fs.mkdir(applications); await fs.mkdir(appData);
  const report = { fromVersion: first.version, toVersion: '', checks: [], errors: [] };
  const pass = message => { report.checks.push(message); console.log(`PASS ${message}`); };
  let active;
  try {
    execFileSync('/usr/bin/ditto', [first.app, installed]);
    active = await launch(await appInfo(installed), appData);
    pass('First real packaged app opens from the disposable Applications folder with native keyring and renderer assets.');
    const sentinel = await active.ui(`(async()=>{const api=window.workspace;await api.updateSettings({textSize:'large'});const sessionId=await api.createChatSession();await api.renameChatSession(sessionId,'Synthetic installer upgrade QA');await api.dispatchAction({type:'create_draft'});const state=await api.loadState();const draftId=state.activeDraftId;await api.dispatchAction({type:'update_draft',draftId,patch:{to:'upgrade@example.org',subject:'Retain this synthetic draft',body:'Synthetic package upgrade fixture. Never send.'}});return{sessionId,draftId}})()`);
    assert(sentinel?.sessionId && sentinel.draftId, 'Could not create synthetic data through the actual packaged window API.');
    await active.ui(`window.workspace.saveDraft(${JSON.stringify(sentinel.draftId)})`, 'draft');
    await active.close(); active = undefined;
    const notes = path.join(appData, 'ai-workspace', 'module-data', 'sample-notes', 'notes.json'); await fs.mkdir(path.dirname(notes), { recursive: true });
    const noteData = JSON.stringify([{ id: 'upgrade-fixture', text: 'Retain synthetic module data.', createdAt: '2026-10-29T00:00:00.000Z' }]); await fs.writeFile(notes, noteData);
    pass('Packaged UI creates and saves real settings, a chat and an unsent draft before a normal quit.');
    let next;
    if (args['--next-app']) next = await appInfo(args['--next-app']);
    else {
      const version = nextVersion(first.version), output = path.join(work, 'newer-package');
      console.log(`Building temporary upgrade fixture ${version}; it will not be published.`);
      await run('pnpm', ['exec', 'electron-builder', '--mac', '--dir', `--${process.arch}`, '--publish', 'never', `--config.extraMetadata.version=${version}`, `--config.directories.output=${output}`], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
      next = await appInfo(path.join(output, `mac${process.arch === 'arm64' ? '-arm64' : ''}`, 'OpenVibeDesk.app'));
    }
    assert(newerThan(next.version, first.version), 'The replacement must have a newer version.'); report.toVersion = next.version;
    // Remove only our copied app; the source bundles and profile remain untouched.
    await fs.rm(installed, { recursive: true }); execFileSync('/usr/bin/ditto', [next.app, installed]);
    active = await launch(await appInfo(installed), appData);
    const restored = await active.ui('window.workspace.loadState()');
    assert(restored.settings.textSize === 'large', 'The upgrade lost settings.');
    assert(restored.sessions.some(session => session.id === sentinel.sessionId && session.title === 'Synthetic installer upgrade QA'), 'The upgrade lost the saved chat.');
    const draft = restored.drafts.find(draft => draft.id === sentinel.draftId);
    assert(draft && draft.to === 'upgrade@example.org' && draft.subject === 'Retain this synthetic draft' && draft.body === 'Synthetic package upgrade fixture. Never send.', 'The upgrade lost the saved draft.');
    assert(await fs.readFile(notes, 'utf8') === noteData, 'The upgrade changed module-owned data.');
    pass('Replacing the app with a newer real package retains settings, chat identity, draft content and module data in the same profile.');
    await active.close(); active = undefined;
    assert((await fs.stat(path.join(appData, 'ai-workspace', 'workspace.sqlite'))).size > 0, 'The packaged workspace was not persisted.');
    pass('Newer app exits normally and leaves its SQLite workspace outside the application bundle.');
  } catch (error) { report.errors.push(error.message || String(error)); throw error; }
  finally {
    active?.kill();
    await fs.writeFile(path.join(work, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(`Disposable upgrade report: ${path.join(work, 'report.json')}`);
  }
}
if (require.main === module) main().catch(error => { console.error(error.message || String(error)); process.exitCode = 1; });
module.exports = { nextVersion, newerThan };
