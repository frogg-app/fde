$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path "$ScriptDir\..\..").Path
Set-Location $RepoRoot
$env:PATH = "$RepoRoot\node_modules\.bin;$env:PATH"
node --import tsx scripts/dev/brand.mts prepare
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$brand = Get-Content -LiteralPath "$RepoRoot\.generated\branding\brand.json" -Raw | ConvertFrom-Json
$homeKey = "$($brand.envPrefix)_HOME"
$stateHome = [Environment]::GetEnvironmentVariable($homeKey)
if (-not $stateHome -and $brand.legacyFde) { $stateHome = $env:PASEO_HOME }
if (-not $stateHome) {
    $stateName = if ($brand.legacyFde) { "paseo-home" } else { "$($brand.id)-home" }
    $stateHome = Join-Path "$RepoRoot\.dev" $stateName
}
[Environment]::SetEnvironmentVariable($homeKey, $stateHome, "Process")
$env:PASEO_HOME = $stateHome
New-Item -ItemType Directory -Force -Path $stateHome | Out-Null
if (-not $env:PASEO_LOCAL_MODELS_DIR) { $env:PASEO_LOCAL_MODELS_DIR = Join-Path $stateHome "models\local-speech" }
$port = if ($brand.legacyFde) { 6768 } else { $brand.daemonPort }
$metroPort = if ($brand.legacyFde) { 8081 } elseif ($port -eq 65535) { 65534 } else { $port + 1 }
if (-not $env:PASEO_LISTEN) { $env:PASEO_LISTEN = "0.0.0.0:$port" }
if (-not $env:EXPO_PORT) { $env:EXPO_PORT = "$metroPort" }
$env:APP_VARIANT = "development"
$env:EXPO_PUBLIC_LOCAL_DAEMON = if ($env:PASEO_DEV_DAEMON_ENDPOINT) { $env:PASEO_DEV_DAEMON_ENDPOINT } else { $env:PASEO_LISTEN -replace '^0\.0\.0\.0:', 'localhost:' }
$env:EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL = (git branch --show-current).Trim()
$env:BROWSER = "none"
$env:PASEO_CORS_ORIGINS = "*"
Write-Host "$($brand.name) development | state: $stateHome | daemon: $env:PASEO_LISTEN | Metro: $env:EXPO_PORT"
npm run build:server-deps
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run build:app-deps
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
concurrently --names "daemon,metro" --prefix-colors "cyan,magenta" `
    "npm run dev:server:watch" `
    "npm run start:expo --workspace=@fde/app -- --port $env:EXPO_PORT"
exit $LASTEXITCODE
