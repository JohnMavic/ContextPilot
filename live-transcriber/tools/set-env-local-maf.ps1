param(
  [string]$EnvLocalPath = (Join-Path $PSScriptRoot '..\\.env.local'),
  [string]$TriageAgentId,
  [string]$ModelDeploymentName,
  [string]$ProjectApiKey,
  [string]$MfaFunctionKey,
  [string]$MfaFallbackWorkflowId,
  [switch]$EnableLocalMfaRoute
)

$values = [ordered]@{
  'AZURE_AI_PROJECT_ENDPOINT' = 'https://contextpilot-resource.services.ai.azure.com/api/projects/contextpilot'
  'AURA_WEB_AGENT_ID' = 'AURAContextPilotWeb:19'
  'AURA_CONTEXT_AGENT_ID' = 'AURAContextPilot:12'
  'AURA_SYNTHESIZER_AGENT_ID' = 'AURAContextPilotResponseSynthesizer:15'
}

if ($TriageAgentId) {
  $values['AURA_TRIAGE_AGENT_ID'] = $TriageAgentId
}

if ($ModelDeploymentName) {
  $values['AZURE_AI_MODEL_DEPLOYMENT_NAME'] = $ModelDeploymentName
}

# Optional: only set if you explicitly pass it (never echoed)
if ($ProjectApiKey) {
  $values['AZURE_AI_PROJECT_API_KEY'] = $ProjectApiKey
}

if ($EnableLocalMfaRoute) {
  # Local Azure Functions host default
  $values['MFA_1_NAME'] = 'AURA-MFA'
  $values['MFA_1_LABEL'] = 'Multi-Agent (Parallel with Triage)'
  $values['MFA_1_ENDPOINT'] = 'http://localhost:7071/api/mfa'
  # NOTE: If auth_level=FUNCTION, set MFA_1_FUNCTION_KEY (x-functions-key)
}

if ($MfaFunctionKey) {
  $values['MFA_1_FUNCTION_KEY'] = $MfaFunctionKey
}

if ($MfaFallbackWorkflowId) {
  $values['MFA_1_FALLBACK_WORKFLOW_ID'] = $MfaFallbackWorkflowId
}

if (-not (Test-Path -LiteralPath $EnvLocalPath)) {
  New-Item -ItemType File -Path $EnvLocalPath -Force | Out-Null
}

# Read file without printing it
$lines = Get-Content -LiteralPath $EnvLocalPath -ErrorAction Stop

foreach ($key in $values.Keys) {
  $value = $values[$key]
  $pattern = "^" + [regex]::Escape($key) + "="
  $newLine = "${key}=${value}"

  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $pattern) {
      $lines[$i] = $newLine
      $found = $true
      break
    }
  }

  if (-not $found) {
    $lines += $newLine
  }
}

Set-Content -LiteralPath $EnvLocalPath -Value $lines -Encoding UTF8

# Print only the non-secret keys we touched
$echoKeys = @(
  'AZURE_AI_PROJECT_ENDPOINT',
  'AZURE_AI_MODEL_DEPLOYMENT_NAME',
  'AURA_TRIAGE_AGENT_ID',
  'AURA_WEB_AGENT_ID',
  'AURA_CONTEXT_AGENT_ID',
  'AURA_SYNTHESIZER_AGENT_ID'
)

$escapedKeys = $echoKeys | ForEach-Object { [regex]::Escape($_) }
$pattern = '^(' + ($escapedKeys -join '|') + ')='
Get-Content -LiteralPath $EnvLocalPath | Select-String -Pattern $pattern | ForEach-Object { $_.Line }
