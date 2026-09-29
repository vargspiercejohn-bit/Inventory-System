param(
  [string]$HostName = "localhost",
  [int]$Port = 5433,
  [string]$Username = "postgres",
  [string]$Database = "inventory_db"
)

$ErrorActionPreference = "Stop"

if ($Database -notmatch '^[a-zA-Z][a-zA-Z0-9_]*$') {
  throw "Database name must start with a letter and contain only letters, numbers, or underscores."
}

$psqlCandidates = @(
  "C:\Program Files\PostgreSQL\17\bin\psql.exe",
  "C:\Program Files\PostgreSQL\18\bin\psql.exe"
)
$psql = $psqlCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $psql) {
  throw "PostgreSQL psql was not found. Install PostgreSQL, then run this command again."
}

Write-Host "Configuring local PostgreSQL for the Inventory System..." -ForegroundColor Cyan
$securePassword = Read-Host "Password for PostgreSQL user '$Username'" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $env:PGPASSWORD = $plainPassword

  $exists = & $psql --host=$HostName --port=$Port --username=$Username --dbname=postgres --no-password --tuples-only --no-align --command="SELECT 1 FROM pg_database WHERE datname = '$Database'"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not connect to PostgreSQL. Check the password and make sure the PostgreSQL service is running."
  }

  if (($exists | Out-String).Trim() -ne "1") {
    & $psql --host=$HostName --port=$Port --username=$Username --dbname=postgres --no-password --command="CREATE DATABASE `"$Database`""
    if ($LASTEXITCODE -ne 0) { throw "The inventory database could not be created." }
    Write-Host "Created database '$Database'." -ForegroundColor Green
  } else {
    Write-Host "Database '$Database' already exists." -ForegroundColor DarkGreen
  }

  $encodedUser = [Uri]::EscapeDataString($Username)
  $encodedPassword = [Uri]::EscapeDataString($plainPassword)
  $connection = "postgresql://${encodedUser}:${encodedPassword}@${HostName}:${Port}/${Database}"
  Set-Content -LiteralPath ".env.local" -Value "DATABASE_URL=$connection" -Encoding utf8
  Write-Host "Local PostgreSQL is configured. Run 'npm run dev' to start the system." -ForegroundColor Green
} finally {
  $env:PGPASSWORD = $null
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  $plainPassword = $null
}
