$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$releaseDate = Get-Date -Format 'yyyyMMdd'
$buildTime = Get-Date -Format 'HHmmss'
$outputRoot = Join-Path $repositoryRoot 'output'
$releaseDirectory = Join-Path $outputRoot "noloader-api2-local-$releaseDate-$buildTime"
$launcherStage = Join-Path $releaseDirectory 'launcher-stage'
$modsStage = Join-Path $releaseDirectory 'mods-stage'
$launcherArchiveName = "NoLoader-Launcher-API2-Windows-x64-0.6.29-local-$releaseDate.zip"
$modsArchiveName = "NoLoader-Mod-Samples-API2-$releaseDate.zip"
$launcherArchive = Join-Path $releaseDirectory $launcherArchiveName
$modsArchive = Join-Path $releaseDirectory $modsArchiveName

if (Test-Path -LiteralPath $releaseDirectory) {
    throw "Output folder already exists: $releaseDirectory"
}

$launcherExecutable = Join-Path $repositoryRoot 'src-tauri\target\release\noriskclient-launcher-v3.exe'
$binaryDirectory = Join-Path $repositoryRoot 'src-tauri\binaries'
$requiredLauncherFiles = @(
    'noriskclient-launcher-v3.exe',
    'norisk-capture-x86_64-pc-windows-msvc.exe',
    'avcodec-62.dll',
    'avformat-62.dll',
    'avutil-60.dll',
    'swresample-6.dll',
    'graphics-hook64.dll',
    'graphics-hook32.dll',
    'ffmpeg-LICENSE.txt',
    'ffmpeg-NOTICE.txt',
    'graphics-hook-NOTICE.txt',
    'graphics-hook-GPL-2.0.txt'
)
if (!(Test-Path -LiteralPath $launcherExecutable -PathType Leaf)) {
    throw 'The API 2 launcher executable has not been built.'
}
foreach ($name in $requiredLauncherFiles | Where-Object { $_ -ne 'noriskclient-launcher-v3.exe' }) {
    if (!(Test-Path -LiteralPath (Join-Path $binaryDirectory $name) -PathType Leaf)) {
        throw "Required runtime file is missing: $name"
    }
}

New-Item -ItemType Directory -Path $launcherStage, $modsStage -Force | Out-Null
$licensesStage = Join-Path $launcherStage 'licenses'
New-Item -ItemType Directory -Path $licensesStage -Force | Out-Null
foreach ($name in $requiredLauncherFiles) {
    $source = if ($name -eq 'noriskclient-launcher-v3.exe') { $launcherExecutable } else { Join-Path $binaryDirectory $name }
    $destination = if ($name -in @('ffmpeg-LICENSE.txt', 'ffmpeg-NOTICE.txt', 'graphics-hook-NOTICE.txt', 'graphics-hook-GPL-2.0.txt')) {
        Join-Path $licensesStage $name
    } else {
        Join-Path $launcherStage $name
    }
    Copy-Item -LiteralPath $source -Destination $destination
}
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'LICENSE') -Destination (Join-Path $launcherStage 'LICENSE')
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'NOLOADER-BUILD-NOTICE.txt') -Destination (Join-Path $launcherStage 'NOLOADER-BUILD-NOTICE.txt')
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'THIRD_PARTY_ICONS.md') -Destination (Join-Path $launcherStage 'THIRD_PARTY_ICONS.md')
$thirdPartyLicenses = Join-Path $releaseDirectory 'THIRD-PARTY-LICENSES.txt'
Push-Location $repositoryRoot
try {
    yarn licenses generate-disclaimer | Set-Content -LiteralPath $thirdPartyLicenses -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate third-party license notices.' }
} finally {
    Pop-Location
}
Copy-Item -LiteralPath $thirdPartyLicenses -Destination (Join-Path $launcherStage 'THIRD-PARTY-LICENSES.txt')

$launcherReadme = @'
NoLoader API 2 local Windows build

Launcher version: NoRisk 0.6.29
NoLoader API: 2 (continues to load API 1 extensions)
Build type: local, unsigned

This archive contains the prepared launcher and its required native runtime files. The official installer still points at its signed release catalog; this local archive is not in that catalog. Do not replace an existing launcher folder with an unsigned local archive unless you have made a full backup and understand how to restore it. The signed release workflow is required for a normal installer update.

See the sibling NoLoader-Mod-Samples archive for the Quick Join, game-mod import, performance controls, and Fabric starter examples.
'@
Set-Content -LiteralPath (Join-Path $launcherStage 'LOCAL-BUILD-README.txt') -Value $launcherReadme -Encoding utf8
Compress-Archive -Path (Join-Path $launcherStage '*') -DestinationPath $launcherArchive -CompressionLevel Optimal

$modPackages = @(
    @{ Source = 'sdk\quick-join-mod'; Name = 'Quick-Join-Probe' },
    @{ Source = 'sdk\game-mod-import'; Name = 'Game-Mod-Import' },
    @{ Source = 'sdk\performance-mod'; Name = 'Performance-Controls' }
)
foreach ($package in $modPackages) {
    $sourceDirectory = Join-Path $repositoryRoot $package.Source
    $destinationDirectory = Join-Path $modsStage $package.Name
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    foreach ($file in @('noloader.mod.json', 'README.md', 'styles.css')) {
        $sourceFile = Join-Path $sourceDirectory $file
        if (Test-Path -LiteralPath $sourceFile -PathType Leaf) {
            Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $destinationDirectory $file)
        }
    }
    $distDirectory = Join-Path $sourceDirectory 'dist'
    if (!(Test-Path -LiteralPath (Join-Path $distDirectory 'index.js') -PathType Leaf)) {
        throw "SDK bundle is missing for $($package.Name). Build all SDK examples before packaging."
    }
    Copy-Item -LiteralPath $distDirectory -Destination (Join-Path $destinationDirectory 'dist') -Recurse
}
$templateSource = Join-Path $repositoryRoot 'sdk\game-mod-template'
$templateDestination = Join-Path $modsStage 'Fabric-Game-Mod-Template'
New-Item -ItemType Directory -Path $templateDestination -Force | Out-Null
Get-ChildItem -LiteralPath $templateSource -Force |
    Where-Object { $_.Name -notin @('.gradle', 'build') } |
    Copy-Item -Destination $templateDestination -Recurse
Compress-Archive -Path (Join-Path $modsStage '*') -DestinationPath $modsArchive -CompressionLevel Optimal

$launcherHash = (Get-FileHash -LiteralPath $launcherArchive -Algorithm SHA256).Hash.ToLowerInvariant()
$modsHash = (Get-FileHash -LiteralPath $modsArchive -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
    product = 'NoLoader'
    launcherVersion = '0.6.29'
    coreVersion = '1.0.0'
    apiVersion = 2
    buildType = 'local-unsigned'
    releaseDateUtc = [DateTime]::UtcNow.ToString('o')
    upstreamCommit = 'bfc2e0564f9c0c96d3ce9062deab316647932c64'
    launcherArchive = [ordered]@{
        file = $launcherArchiveName
        sha256 = $launcherHash
        sizeBytes = (Get-Item -LiteralPath $launcherArchive).Length
    }
    modsArchive = [ordered]@{
        file = $modsArchiveName
        sha256 = $modsHash
        sizeBytes = (Get-Item -LiteralPath $modsArchive).Length
    }
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $releaseDirectory 'build-manifest.json') -Encoding utf8

$installerExecutable = Join-Path $outputRoot 'NoLoader-Installer-1.0.2\NoLoader.exe'
if (Test-Path -LiteralPath $installerExecutable -PathType Leaf) {
    Copy-Item -LiteralPath $installerExecutable -Destination (Join-Path $releaseDirectory 'NoLoader-Installer-1.0.2.exe')
    $installInstructions = @'
NoLoader API 2 – lokales Installerpaket

1. NoLoader-Installer-1.0.2.exe starten.
2. Unter „Local API 2 package (unsigned)“ die build-manifest.json aus diesem Ordner auswählen.
3. Den bestehenden NoRisk-Launcher-Ordner beibehalten (normalerweise %LOCALAPPDATA%\NoRisk Launcher).
4. „Install local API 2“ wählen und die Installation des unsignierten lokalen Builds bestätigen.

Der Installer prüft Dateigröße und SHA-256, entpackt sicher, behält den bisherigen Launcher-Ordner als Rückfallkopie und erstellt den NoLoader-Mods-Ordner. Der lokale Build ist nicht vom Herausgeber signiert. Der Hash belegt nicht, wer das Paket erstellt hat.

NoLoader-Mod-Samples-API2-$releaseDate.zip enthält die Quick-Join-Probe, ein Beispiel zum Importieren von Spielmods, Performance-Steuerung und eine Fabric-Spielmod-Vorlage. Diese Beispiele werden nicht automatisch aktiviert.
'@
    Set-Content -LiteralPath (Join-Path $releaseDirectory 'README-INSTALL-DE.txt') -Value $installInstructions -Encoding utf8
}

Remove-Item -LiteralPath $launcherStage, $modsStage -Recurse -Force
Write-Output "Launcher archive: $launcherArchive"
Write-Output "Mod samples: $modsArchive"
Write-Output "Build manifest: $(Join-Path $releaseDirectory 'build-manifest.json')"
if (Test-Path -LiteralPath (Join-Path $releaseDirectory 'NoLoader-Installer-1.0.2.exe') -PathType Leaf) {
    Write-Output "Installer: $(Join-Path $releaseDirectory 'NoLoader-Installer-1.0.2.exe')"
}
