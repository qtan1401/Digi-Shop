param([switch]$Seed)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($env:NEON_DIRECT_URL)) {
    throw 'Set NEON_DIRECT_URL in this PowerShell session to the Neon direct connection URL first.'
}
if (-not $env:NEON_DIRECT_URL.StartsWith('postgresql://') -and -not $env:NEON_DIRECT_URL.StartsWith('postgres://')) {
    throw 'NEON_DIRECT_URL must be a PostgreSQL connection URL.'
}
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 24 and project dependencies first.'
}

$previousDatabaseUrl = [Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process')
$previousAdminPassword = [Environment]::GetEnvironmentVariable('ADMIN_DEFAULT_PASSWORD', 'Process')
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    $env:DATABASE_URL = $env:NEON_DIRECT_URL
    # Suppress CLI output: PostgreSQL errors can contain the connection URL.
    $ErrorActionPreference = 'Continue'
    try {
        & npx prisma migrate deploy *> $null
        $migrationExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = 'Stop'
    }
    if ($migrationExitCode -ne 0) { throw 'Neon migration failed; inspect the database and rerun safely.' }
    Write-Host 'Neon migrations applied.'

    if ($Seed) {
        $securePassword = Read-Host -Prompt 'Initial admin password (use the same value as ADMIN_DEFAULT_PASSWORD on Render)' -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        try {
            $env:ADMIN_DEFAULT_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
        if ([string]::IsNullOrWhiteSpace($env:ADMIN_DEFAULT_PASSWORD)) { throw 'Initial admin password is required for seeding.' }
        $ErrorActionPreference = 'Continue'
        try {
            & node prisma/seed.js *> $null
            $seedExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = 'Stop'
        }
        if ($seedExitCode -ne 0) { throw 'Neon seed failed; inspect the database before rerunning.' }
        Write-Host 'Neon seed completed.'
    }
} finally {
    [Environment]::SetEnvironmentVariable('DATABASE_URL', $previousDatabaseUrl, 'Process')
    if ($Seed) { [Environment]::SetEnvironmentVariable('ADMIN_DEFAULT_PASSWORD', $previousAdminPassword, 'Process') }
    Pop-Location
}
