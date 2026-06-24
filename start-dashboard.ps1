$ErrorActionPreference = "Stop"

$localNode = "node"
$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if (Get-Command $localNode -ErrorAction SilentlyContinue) {
  & $localNode server.js
  exit $LASTEXITCODE
}

if (Test-Path $bundledNode) {
  & $bundledNode server.js
  exit $LASTEXITCODE
}

Write-Error "Node.js was not found. Install Node.js 18+ or run this from a Codex workspace with bundled dependencies."

