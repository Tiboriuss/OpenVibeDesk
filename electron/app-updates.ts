import { z } from 'zod';
import { defaultUpdateChannel, updateVersionSchema, type AppUpdateStatus, type AvailableAppUpdate, type UpdateChannel } from '../shared/app-updates';
import { compareVersions } from '../shared/semver';

const repository = 'Tiboriuss/OpenVibeDesk';
const releaseBase = `https://github.com/${repository}/releases`;
const releasesApi = `https://api.github.com/repos/${repository}/releases`;
const maxResponseBytes = 2_000_000;

const releaseSchema = z.object({
  tag_name: z.string().max(81),
  draft: z.boolean(),
  prerelease: z.boolean(),
  body: z.string().nullish(),
  assets: z.array(z.object({
    name: z.string(),
    state: z.string(),
    size: z.number().nonnegative()
  })).max(100)
});

type InstallerTarget = 'mac-arm64' | 'mac-x64' | 'win-x64';
type Release = AvailableAppUpdate & { tag: string; installer: string };

function installerTarget(platform: NodeJS.Platform, arch: string): InstallerTarget | undefined {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return `mac-${arch}`;
  if (platform === 'win32' && arch === 'x64') return 'win-x64';
}

function readyRelease(input: unknown, currentVersion: string, channel: UpdateChannel, target: InstallerTarget): Release | undefined {
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success || parsed.data.draft) return;
  const { tag_name: tag, body, assets } = parsed.data;
  const version = updateVersionSchema.safeParse(tag.replace(/^v/, ''));
  if (!version.success || compareVersions(version.data, currentVersion) <= 0) return;
  const prerelease = parsed.data.prerelease || version.data.includes('-');
  if (channel === 'stable' && prerelease) return;
  const installer = `OpenVibeDesk-${version.data}-${target}.${target === 'win-x64' ? 'exe' : 'dmg'}`;
  const uploaded = new Set(assets.filter(asset => asset.state === 'uploaded' && asset.size > 0).map(asset => asset.name));
  // The release workflow uploads the checksums last, after all three installers.
  if (![installer, 'RELEASE.json', 'SHA256SUMS.txt'].every(name => uploaded.has(name))) return;
  const summary = body?.slice(0, 4000).split(/\r?\n/).map(line => line.trim())
    .find(line => /^[\p{L}\p{N}]/u.test(line))?.slice(0, 360)
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
  return { version: version.data, prerelease, summary, tag, installer };
}

async function readReleases(response: Response): Promise<unknown[]> {
  if (!response.ok || Number(response.headers.get('content-length')) > maxResponseBytes || !response.body) throw new Error('Release list unavailable.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxResponseBytes) { await reader.cancel(); throw new Error('Release list is too large.'); }
    chunks.push(value);
  }
  return z.array(z.unknown()).max(30).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

async function findUpdate(version: string, channel: UpdateChannel, target: InstallerTarget, signal: AbortSignal): Promise<Release | undefined> {
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  let best: Release | undefined;
  // GitHub orders releases by date, so use version precedence within the recent list.
  for (let page = 1; page <= 4; page++) {
    const response = await fetch(`${releasesApi}?per_page=30&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenVibeDesk' },
      signal: timeout, redirect: 'error'
    });
    for (const raw of await readReleases(response)) {
      const release = readyRelease(raw, version, channel, target);
      if (release && (!best || compareVersions(release.version, best.version) > 0)) best = release;
    }
    if (!response.headers.get('link')?.includes('rel="next"')) break;
  }
  return best;
}

export class AppUpdates {
  private readonly target: InstallerTarget | undefined;
  private channel: UpdateChannel;
  private latest?: Release;
  private phase: AppUpdateStatus['phase'];
  private pending?: { abort: AbortController; result: Promise<AppUpdateStatus> };

  constructor(
    private readonly version: string,
    private readonly packaged: boolean,
    channel: UpdateChannel | undefined,
    private readonly ignoredVersions: () => readonly string[],
    private readonly onChange: () => void
  ) {
    this.channel = channel ?? defaultUpdateChannel;
    this.target = installerTarget(process.platform, process.arch);
    this.phase = this.initialPhase();
  }

  private initialPhase(): AppUpdateStatus['phase'] {
    if (!this.packaged) return 'development';
    return this.target && updateVersionSchema.safeParse(this.version).success ? 'idle' : 'unsupported';
  }

  status(): AppUpdateStatus {
    const { latest } = this;
    const update = latest && { version: latest.version, prerelease: latest.prerelease, summary: latest.summary };
    return {
      currentVersion: this.version, channel: this.channel, phase: this.phase, update,
      ignored: !!update && this.ignoredVersions().includes(update.version)
    };
  }

  setChannel(channel: UpdateChannel): void {
    if (channel === this.channel) return;
    this.pending?.abort.abort();
    this.pending = undefined;
    this.latest = undefined;
    this.channel = channel;
    this.phase = this.initialPhase();
    this.onChange();
  }

  check(): Promise<AppUpdateStatus> {
    if (!this.target || this.phase === 'development' || this.phase === 'unsupported') return Promise.resolve(this.status());
    if (this.pending) return this.pending.result;
    const abort = new AbortController();
    const result = findUpdate(this.version, this.channel, this.target, abort.signal)
      .then(release => {
        if (abort.signal.aborted) return;
        this.latest = release;
        this.phase = release ? 'available' : 'current';
      }, () => {
        if (!abort.signal.aborted) this.phase = 'error';
      }).then(() => {
        if (this.pending?.abort === abort) { this.pending = undefined; this.onChange(); }
        return this.status();
      });
    this.pending = { abort, result };
    this.phase = 'checking';
    this.onChange();
    return result;
  }

  urlFor(version: string, destination: 'release' | 'installer'): string | undefined {
    const release = this.latest;
    if (!release || release.version !== version) return;
    // URLs are constructed exclusively from the fixed repository and validated tag and asset names.
    return destination === 'release'
      ? `${releaseBase}/tag/${encodeURIComponent(release.tag)}`
      : `${releaseBase}/download/${encodeURIComponent(release.tag)}/${release.installer}`;
  }

  dispose(): void {
    this.pending?.abort.abort();
    this.pending = undefined;
  }
}
