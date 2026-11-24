# Offline integration test for ALDECKOT's complete migration chain.
# Requires an already-cached postgres:16-alpine image in rootful Podman WSL.
# No ports, mounts, or network are exposed to the database container.
$ErrorActionPreference = 'Stop'

function Invoke-LocalPodman {
  param([string[]]$PodmanArgs)
  & wsl.exe -d podman-uosserver -u root -- podman @PodmanArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Local Podman command failed with exit code $LASTEXITCODE."
  }
}

$repoRoot = [string](Resolve-Path (Join-Path $PSScriptRoot '..\..'))
$drive = $repoRoot.Substring(0, 1).ToLowerInvariant()
$wslRepoRoot = '/mnt/' + $drive + $repoRoot.Substring(2).Replace('\', '/')
$containerName = 'aldeckot-local-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$testPassword = [guid]::NewGuid().ToString('N')
$started = $false

try {
  Invoke-LocalPodman -PodmanArgs @('run', '--rm', '--pull=never',
    '--name', $containerName, '--network', 'none',
    '-e', "POSTGRES_PASSWORD=$testPassword", '-d',
    'docker.io/library/postgres:16-alpine') | Out-Null
  $started = $true
  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    & wsl.exe -d podman-uosserver -u root -- podman exec -u postgres `
      $containerName pg_isready *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Local PostgreSQL did not become ready.' }

  Invoke-LocalPodman -PodmanArgs @('cp', "$wslRepoRoot/supabase", "${containerName}:/tmp/migrations") | Out-Null
  Invoke-LocalPodman -PodmanArgs @('cp', "$wslRepoRoot/tests/sql", "${containerName}:/tmp/sql") | Out-Null
  Invoke-LocalPodman -PodmanArgs @('exec', '-u', 'postgres', $containerName,
    'psql', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres',
    '-f', '/tmp/sql/local-supabase-bootstrap.sql') | Out-Null
  Invoke-LocalPodman -PodmanArgs @('exec', '-u', 'postgres', $containerName,
    'sh', '/tmp/sql/run-migrations.sh')
  Invoke-LocalPodman -PodmanArgs @('exec', '-u', 'postgres', $containerName,
    'psql', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres',
    '-f', '/tmp/sql/control-case-backfill.sql') | Out-Null
  Invoke-LocalPodman -PodmanArgs @('exec', '-u', 'postgres', $containerName,
    'psql', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres',
    '-f', '/tmp/sql/control-case-integration.sql') | Out-Null
  Invoke-LocalPodman -PodmanArgs @('exec', '-u', 'postgres', $containerName,
    'psql', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres',
    '-f', '/tmp/sql/control-case-components.sql') | Out-Null
  Invoke-LocalPodman -PodmanArgs @('exec', '-u', 'postgres', $containerName,
    'psql', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres',
    '-f', '/tmp/sql/control-case-durations.sql') | Out-Null
  Invoke-LocalPodman -PodmanArgs @('exec', '-u', 'postgres', $containerName,
    'psql', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres',
    '-f', '/tmp/sql/control-case-reopen.sql') | Out-Null
  Invoke-LocalPodman -PodmanArgs @('exec', '-u', 'postgres', $containerName,
    'psql', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres',
    '-f', '/tmp/sql/inventory-replacement-cross-sector.sql') | Out-Null
  Invoke-LocalPodman -PodmanArgs @('exec', '-u', 'postgres', $containerName,
    'psql', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres',
    '-f', '/tmp/sql/inventory-sector-catalog.sql') | Out-Null
  Invoke-LocalPodman -PodmanArgs @('exec', '-u', 'postgres', $containerName,
    'psql', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres',
    '-f', '/tmp/sql/agenda-retention.sql') | Out-Null
  Invoke-LocalPodman -PodmanArgs @('exec', '-u', 'postgres', $containerName,
    'psql', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres',
    '-f', '/tmp/sql/equipment-photos-131-transaction.sql') | Out-Null
  Write-Output 'PASS: offline migrations, fictional backfill, case transitions, components, durations, structured resolution, manual reopen, stable-ID recurrence, external service, distinct-case reporting, cross-sector inventory replacement and rollback, central sector catalog, legacy preservation, and equipment photo identity and upload guards.'
}
finally {
  if ($started) {
    & wsl.exe -d podman-uosserver -u root -- podman stop --time 2 $containerName *> $null
  }
}
