# buildNsave.ps1
# Builds the air-gapped Docker image and saves it to a .tar archive.
#
# Mirrors the two commands:
#   docker build -f Dockerfile.airgap -t ltx:<TAG> .
#   docker save -o ltx-<TAG>.tar ltx:<TAG>
#
# Usage:
#   .\buildNsave.ps1 airgap-v1.12.0
#   .\buildNsave.ps1 -Tag airgap-v1.12.0

param(
    [Parameter(Mandatory = $true, Position = 0, HelpMessage = "Image tag, e.g. airgap-v1.12.0")]
    [ValidateNotNullOrEmpty()]
    [string]$Tag
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dockerfile = Join-Path $ScriptDir "Dockerfile.airgap"
$ImageRef = "ltx:$Tag"
$OutputTar = Join-Path $ScriptDir "ltx-$Tag.tar"

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Info {
    param([string]$Message)
    Write-Host "    $Message" -ForegroundColor Gray
}

function Write-Done {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

$startTime = Get-Date

Write-Host @"

  buildNsave - Air-gapped image build & save
  ===========================================
  Tag         : $Tag
  Image       : $ImageRef
  Dockerfile  : $Dockerfile
  Output      : $OutputTar

"@ -ForegroundColor Cyan

Set-Location $ScriptDir

# ============================================================
# Preflight: verify Docker is available
# ============================================================
Write-Step "Checking prerequisites"

$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCmd) {
    Write-Error "Docker CLI not found on PATH. Install Docker and try again."
    exit 1
}
Write-Info "docker found: $($dockerCmd.Source)"

try {
    docker info --format '{{.ServerVersion}}' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker info exited with code $LASTEXITCODE" }
}
catch {
    Write-Error "Docker daemon does not appear to be running. Start Docker and try again."
    exit 1
}
Write-Info "Docker daemon is responsive."

if (-not (Test-Path $Dockerfile)) {
    Write-Error "Dockerfile not found: $Dockerfile"
    exit 1
}
Write-Info "Dockerfile located."

Write-Done "Prerequisites satisfied."

# ============================================================
# Step 1: Build the image
# ============================================================
Write-Step "[1/2] Building image '$ImageRef'"
Write-Info "Running: docker build -f `"$Dockerfile`" -t $ImageRef ."

$buildStart = Get-Date
docker build -f "$Dockerfile" -t $ImageRef .
if ($LASTEXITCODE -ne 0) {
    Write-Error "docker build failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}
$buildElapsed = (Get-Date) - $buildStart
Write-Done ("Image built in {0:mm\:ss}." -f $buildElapsed)

# ============================================================
# Step 2: Save the image to a tar archive
# ============================================================
Write-Step "[2/2] Saving image to '$OutputTar'"

if (Test-Path $OutputTar) {
    Write-Info "Existing archive found; it will be overwritten."
}
Write-Info "Running: docker save -o `"$OutputTar`" $ImageRef"

$saveStart = Get-Date
docker save -o "$OutputTar" $ImageRef
if ($LASTEXITCODE -ne 0) {
    Write-Error "docker save failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}
$saveElapsed = (Get-Date) - $saveStart

$sizeBytes = (Get-Item $OutputTar).Length
$sizeGB = [math]::Round($sizeBytes / 1GB, 2)
Write-Done ("Image saved in {0:mm\:ss} ({1} GB)." -f $saveElapsed, $sizeGB)

# ============================================================
# Summary
# ============================================================
$totalElapsed = (Get-Date) - $startTime
Write-Host "`n===========================================" -ForegroundColor Green
Write-Done "All steps complete."
Write-Info "Archive : $OutputTar"
Write-Info ("Size    : {0} GB" -f $sizeGB)
Write-Info ("Total   : {0:hh\:mm\:ss}" -f $totalElapsed)
Write-Host "===========================================`n" -ForegroundColor Green
