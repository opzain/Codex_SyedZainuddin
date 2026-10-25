param(
  [Parameter(Mandatory = $true)] [string] $ApiKey,
  [string] $Repo = "https://github.com/opzain/Codex_SyedZainuddin",
  [string] $Branch = "main",
  [string] $ServiceName = "cyberser-command-center"
)

# Deploys the CyberSER command center to Render as a free static site.
# Requires a Render API key: Dashboard -> Account Settings -> API Keys.

$ErrorActionPreference = "Stop"
$base = "https://api.render.com/v1"
$headers = @{
  Authorization  = "Bearer $ApiKey"
  Accept         = "application/json"
  "User-Agent"   = "cyberser-deploy"
}

function Invoke-Render {
  param([string] $Method, [string] $Path, $Body)
  $args = @{ Uri = "$base$Path"; Headers = $headers; Method = $Method; TimeoutSec = 60 }
  if ($null -ne $Body) {
    $args.Body = ($Body | ConvertTo-Json -Depth 8 -Compress)
    $args.ContentType = "application/json"
  }
  Invoke-RestMethod @args
}

Write-Host "1/4  Resolving Render workspace owner..." -ForegroundColor Cyan
$owners = Invoke-Render GET "/owners"
if (-not $owners -or $owners.Count -eq 0) { throw "No Render workspace found for this API key." }
$ownerId = $owners[0].owner.id
Write-Host "     owner: $($owners[0].owner.name) ($ownerId)"

Write-Host "2/4  Checking for an existing '$ServiceName' service..." -ForegroundColor Cyan
$existing = $null
try {
  $list = Invoke-Render GET "/services?limit=100"
  $existing = $list | Where-Object { $_.service.name -eq $ServiceName } | Select-Object -First 1
} catch {
  Write-Host "     service lookup skipped: $($_.Exception.Message)"
}

if ($existing) {
  $service = $existing.service
  $serviceId = $service.id
  Write-Host "     reusing existing service $serviceId"
  Invoke-Render POST "/services/$serviceId/deploys" @{ clearCache = "do_not_clear" } | Out-Null
} else {
  Write-Host "3/4  Creating static site..." -ForegroundColor Cyan
  $payload = @{
    type           = "static"
    name           = $ServiceName
    ownerId        = $ownerId
    repo           = $Repo
    branch         = $Branch
    autoDeploy     = "yes"
    serviceDetails = @{
      buildCommand      = "npm ci && npm run build"
      staticPublishPath = "./dist"
    }
  }
  $created = Invoke-Render POST "/services" $payload
  $service = if ($created.service) { $created.service } else { $created }
  $serviceId = $service.id
  Write-Host "     created service $serviceId"
}

Write-Host "4/4  Waiting for the deploy to go live (max 10 min)..." -ForegroundColor Cyan
$finalStatus = $null
for ($attempt = 1; $attempt -le 40; $attempt++) {
  Start-Sleep -Seconds 15
  try {
    $deploys = Invoke-Render GET "/services/$serviceId/deploys?limit=1"
    $deploy = if ($deploys.Count -gt 0) { $deploys[0].deploy } else { $null }
    if ($deploy) {
      $finalStatus = $deploy.status
      Write-Host ("     [{0}] {1}" -f $attempt, $finalStatus)
      if ($finalStatus -in @("live", "deactivated", "canceled", "failed")) { break }
    } else {
      Write-Host ("     [{0}] waiting for first deploy..." -f $attempt)
    }
  } catch {
    Write-Host ("     [{0}] poll failed: {1}" -f $attempt, $_.Exception.Message)
  }
}

$details = Invoke-Render GET "/services/$serviceId"
$url = if ($details.serviceDetails -and $details.serviceDetails.url) { $details.serviceDetails.url } else { $details.url }
Write-Host ""
Write-Host "Service: $ServiceName ($serviceId)" -ForegroundColor Green
Write-Host "Status : $finalStatus" -ForegroundColor Green
Write-Host "URL    : $url" -ForegroundColor Green
