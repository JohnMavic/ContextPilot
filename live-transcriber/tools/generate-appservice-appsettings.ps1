# Generates an Azure App Service "Advanced edit" JSON array from .env.local
# - Reads live-transcriber/.env.local (next to this script's parent folder)
# - Writes live-transcriber/appservice-appsettings.generated.json
# - Does NOT print secrets unless you explicitly output the file yourself

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $projectRoot '.env.local'
$outPath = Join-Path $projectRoot 'appservice-appsettings.generated.json'
$outRedactedPath = Join-Path $projectRoot 'appservice-appsettings.generated.redacted.json'

if (-not (Test-Path $envPath)) {
  throw "Missing $envPath"
}

function Parse-DotEnvFile([string]$path) {
  $map = [ordered]@{}
  Get-Content -LiteralPath $path | ForEach-Object {
    $line = $_.Trim()
    if ([string]::IsNullOrWhiteSpace($line)) { return }
    if ($line.StartsWith('#')) { return }

    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }

    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1)

    # Remove surrounding quotes if present
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $map[$key] = $value
  }
  return $map
}

$env = Parse-DotEnvFile $envPath

function Should-Redact([string]$key) {
  $upper = $key.ToUpperInvariant()
  return (
    $upper -like '*KEY*' -or
    $upper -like '*SECRET*' -or
    $upper -like '*TOKEN*' -or
    $upper -like '*PASSWORD*' -or
    $upper -like '*CONNECTION_STRING*'
  )
}

function Redact-Value([string]$key, [string]$value) {
  if ([string]::IsNullOrEmpty($value)) { return $value }
  if (-not (Should-Redact $key)) { return $value }

  # Keep a hint of prefix for debugging, but never reveal full secret
  $prefix = $value
  if ($prefix.Length -gt 6) { $prefix = $prefix.Substring(0, 6) }
  return "${prefix}***REDACTED***"
}

# Map local client-style key to server-style key if present
# Proxy uses: VITE_OPENAI_API_KEY || OPENAI_API_KEY
if ($env.Contains('VITE_OPENAI_API_KEY') -and (-not $env.Contains('OPENAI_API_KEY'))) {
  $env['OPENAI_API_KEY'] = $env['VITE_OPENAI_API_KEY']
}

# Defaults for OpenAI realtime transcription model override (OpenAI provider only)
# These are safe defaults; the proxy also has the same defaults in code.
if (-not $env.Contains('OPENAI_TRANSCRIBE_MODEL')) {
  $env['OPENAI_TRANSCRIBE_MODEL'] = 'gpt-4o-mini-transcribe-2025-12-15'
}
if (-not $env.Contains('OPENAI_TRANSCRIBE_MODEL_FALLBACKS')) {
  $env['OPENAI_TRANSCRIBE_MODEL_FALLBACKS'] = 'gpt-4o-mini-transcribe,gpt-4o-transcribe'
}

# Ensure the proxy starts even if App Service ignores package.json scripts
# (package.json already has "start": "node proxy-server.js")
$settings = @()

# Keep these optional placeholders at the top (fill in only if you use App Insights)
$settings += [ordered]@{ name = 'APPLICATIONINSIGHTS_CONNECTION_STRING'; value = 'REPLACE_WITH_YOUR_APPLICATIONINSIGHTS_CONNECTION_STRING'; slotSetting = $false }
$settings += [ordered]@{ name = 'ApplicationInsightsAgent_EXTENSION_VERSION'; value = '~3'; slotSetting = $false }
$settings += [ordered]@{ name = 'XDT_MicrosoftApplicationInsights_Mode'; value = 'default'; slotSetting = $false }

$settings += [ordered]@{ name = 'WEBSITE_STARTUP_COMMAND'; value = 'node proxy-server.js'; slotSetting = $false }

# Write all env vars from .env.local except VITE_* (frontend build-time) and obvious local-only comments
foreach ($k in $env.Keys) {
  if ($k -like 'VITE_*') { continue }

  # App Service already sets PORT; no need to hardcode
  if ($k -eq 'PORT') { continue }

  $settings += [ordered]@{ name = $k; value = [string]$env[$k]; slotSetting = $false }
}

$settings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $outPath -Encoding UTF8

# Also write a redacted version safe to paste/share
$settingsRedacted = @()
foreach ($s in $settings) {
  $settingsRedacted += [ordered]@{
    name = [string]$s.name
    value = (Redact-Value $s.name ([string]$s.value))
    slotSetting = [bool]$s.slotSetting
  }
}
$settingsRedacted | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $outRedactedPath -Encoding UTF8

Write-Host "Wrote $outPath"
Write-Host "Wrote $outRedactedPath"
Write-Host "Next: App Service > Configuration > Advanced edit > paste file contents."
