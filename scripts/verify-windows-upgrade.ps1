# Manual release-build verification on an otherwise clean GitHub Windows runner.
# Installs the release artifact, then a newer temporary build; never publishes it.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTIONS -ne 'true' -or
    -not [Environment]::Is64BitProcess -or [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  throw 'Installer upgrade verification is restricted to disposable GitHub Windows x64 runners.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
if ($package.name -ne 'ai-workspace' -or $package.build.appId -ne 'org.openworkspace.desktop') {
  throw 'The existing application or installer identity changed. Review upgrade compatibility before releasing.'
}
$validatedVersion = & node -e "process.stdout.write(require('./scripts/release-version.cjs').releaseVersion(process.argv[1]))" $Version
if ($LASTEXITCODE -ne 0 -or $validatedVersion -ne $Version) { throw 'A validated release version is required.' }
$parts = @($validatedVersion.Split('-')[0].Split('.') | ForEach-Object { [int]::Parse($_) })
# Always choose a strictly newer stable version, including after a prerelease.
if ($parts[2] -lt 65535) { $parts[2]++ }
elseif ($parts[1] -lt 65535) { $parts[1]++; $parts[2] = 0 }
elseif ($parts[0] -lt 65535) { $parts[0]++; $parts[1] = 0; $parts[2] = 0 }
else { throw 'No higher Windows-compatible fixture version is available.' }
$newVersion = $parts -join '.'

$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$expectedInstaller = Join-Path $projectRoot "release/OpenVibeDesk-$Version-win-x64.exe"
if (-not [string]::Equals($installer, [IO.Path]::GetFullPath($expectedInstaller), [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The verification target must be the expected release installer inside release/.'
}
$originalInstallerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash

# This GUID is electron-builder's UUID-v5 result for the existing appId.
# Changing either identity would break recognition of installations already in use.
$guid = '50beeaca-06af-5439-963f-1656981f3c25'
$installKey = "HKCU:\Software\$guid"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$machineInstallKey = "HKLM:\Software\$guid"
$machineUninstallKey = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$profile = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'ai-workspace'
if ((Test-Path -LiteralPath $profile) -or (Test-Path -LiteralPath $installKey) -or
    (Test-Path -LiteralPath $uninstallKey) -or (Test-Path -LiteralPath $machineInstallKey) -or
    (Test-Path -LiteralPath $machineUninstallKey)) {
  throw 'An OVD profile or installation already exists. Refusing to modify potentially non-fixture data.'
}

function Invoke-Installer([string]$Path) {
  $process = Start-Process -FilePath $Path -ArgumentList '/S' -PassThru
  try {
    if (-not $process.WaitForExit(180000)) {
      $process.Kill($true)
      throw 'The silent installer did not finish within three minutes.'
    }
    if ($process.ExitCode -ne 0) { throw "The installer failed with exit code $($process.ExitCode)." }
  }
  finally { $process.Dispose() }
}

function Assert-InstalledVersion([string]$ExpectedVersion, [string]$ExpectedPath = '') {
  if ((Test-Path -LiteralPath $machineInstallKey) -or (Test-Path -LiteralPath $machineUninstallKey)) {
    throw 'The per-user installer unexpectedly created a parallel machine-wide installation.'
  }
  $registration = Get-ItemProperty -LiteralPath $installKey
  $uninstall = Get-ItemProperty -LiteralPath $uninstallKey
  $location = [string]$registration.InstallLocation
  if ([string]::IsNullOrWhiteSpace($location) -or -not (Test-Path -LiteralPath $location -PathType Container)) {
    throw 'The stable installer registry key has no valid installation directory.'
  }
  if ($ExpectedPath -and -not [string]::Equals($location, $ExpectedPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The newer installer created a different installation directory.'
  }
  if ($uninstall.DisplayVersion -ne $ExpectedVersion) { throw 'The registered installed version is incorrect.' }
  $asar = Join-Path $location 'resources/app.asar'
  $readVersion = @'
const {createRequire} = require('node:module');
const requireBuilder = createRequire(require.resolve('electron-builder/package.json'));
const requireAppBuilder = createRequire(requireBuilder.resolve('app-builder-lib/package.json'));
const asar = requireAppBuilder('@electron/asar');
const info = JSON.parse(asar.extractFile(process.argv[1], 'package.json').toString('utf8'));
process.stdout.write(info.version);
'@
  $actualVersion = & node -e $readVersion $asar
  if ($LASTEXITCODE -ne 0 -or $actualVersion -ne $ExpectedVersion) {
    throw 'The installed application package does not contain the expected version.'
  }
  return $location
}

Invoke-Installer $installer
$location = Assert-InstalledVersion $Version
if (Test-Path -LiteralPath $profile) {
  throw 'The silent installer unexpectedly created or launched an application profile.'
}
New-Item -ItemType Directory -Path $profile | Out-Null
$notesFolder = Join-Path $profile 'module-data/sample-notes'
New-Item -ItemType Directory -Path $notesFolder -Force | Out-Null
Set-Content -LiteralPath (Join-Path $profile '.release-upgrade-fixture') -Value 'Synthetic installer verification only.' -Encoding utf8
Set-Content -LiteralPath (Join-Path $profile 'mail-accounts.json') -Value '[{"id":"30e97202-3dbd-46e1-8709-814464ba7ec8","name":"Installer QA","email":"installer@example.org","host":"imap.example.org","port":993,"security":"tls","username":"installer@example.org","pollIntervalSeconds":0}]' -Encoding utf8NoBOM
Set-Content -LiteralPath (Join-Path $profile 'module-settings.json') -Value '{"version":1,"disabled":[],"approvals":{}}' -Encoding utf8NoBOM
Set-Content -LiteralPath (Join-Path $notesFolder 'notes.json') -Value '[{"id":"installer-qa","text":"Preserve this synthetic note across an upgrade.","createdAt":"2026-10-29T00:00:00.000Z"}]' -Encoding utf8NoBOM

$makeWorkspace = @'
const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');
(async () => {
  const SQL = await initSqlJs({wasmBinary: fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))});
  const database = new SQL.Database();
  database.run('CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const state = require(path.resolve('dist-electron/shared/actions.js')).initialState();
  state.mails = []; state.drafts = []; state.chat = [];
  state.sessions = [{id: 'installer-qa', title: 'Synthetic installer QA', createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z', historyStart: 0, messages: []}];
  state.activeSessionId = 'installer-qa';
  state.settings.textSize = 'large';
  database.run('INSERT INTO app_state (key, value) VALUES (?, ?)', ['workspace', JSON.stringify(state)]);
  fs.writeFileSync(path.join(process.argv[1], 'workspace.sqlite'), Buffer.from(database.export()));
  database.close();
})().catch(error => {console.error(error.message); process.exitCode = 1;});
'@
& node -e $makeWorkspace $profile
if ($LASTEXITCODE -ne 0) { throw 'The synthetic workspace could not be prepared.' }
$profileHashes = @{}
Get-ChildItem -LiteralPath $profile -File -Recurse -Force | ForEach-Object {
  $profileHashes[$_.FullName] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
}

$tempOutput = Join-Path $env:RUNNER_TEMP ("ovd-upgrade-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tempOutput | Out-Null
Write-Host "Verifying an in-place upgrade from $Version to temporary fixture $newVersion."
& pnpm exec electron-builder --win nsis --x64 --publish never "--config.extraMetadata.version=$newVersion" "--config.directories.output=$tempOutput"
if ($LASTEXITCODE -ne 0) { throw 'The newer temporary installer could not be built.' }
$newInstaller = Join-Path $tempOutput "OpenVibeDesk-$newVersion-win-x64.exe"
if (-not (Test-Path -LiteralPath $newInstaller -PathType Leaf)) { throw 'The newer fixture installer is missing.' }
Invoke-Installer $newInstaller
$upgradedLocation = Assert-InstalledVersion $newVersion $location
foreach ($file in $profileHashes.Keys) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or
      (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $profileHashes[$file]) {
    throw 'An upgrade removed or changed synthetic workspace, account or module data.'
  }
}
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $originalInstallerHash) {
  throw 'The verification changed the release artifact.'
}
Write-Host "Upgrade verified: same installer identity and directory, newer app version, $($profileHashes.Count) unchanged profile files."
Write-Host 'The temporary fixture installer remains outside release artifacts and is never uploaded.'
