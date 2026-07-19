Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-DisciMindProjectRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Get-JudgeRuntimePaths {
  param([string]$ProjectRoot = (Get-DisciMindProjectRoot))

  $runtimeRoot = Join-Path $ProjectRoot '.judge-runtime'
  $configRoot = Join-Path $runtimeRoot 'config'
  $logsRoot = Join-Path $runtimeRoot 'logs'
  $toolsRoot = Join-Path $runtimeRoot 'tools'
  $downloadsRoot = Join-Path $runtimeRoot 'downloads'

  return [pscustomobject]@{
    ProjectRoot       = $ProjectRoot
    RuntimeRoot       = $runtimeRoot
    ConfigRoot        = $configRoot
    LogsRoot          = $logsRoot
    ToolsRoot         = $toolsRoot
    DownloadsRoot     = $downloadsRoot
    NodeHome          = Join-Path $toolsRoot 'node'
    MariaDbHome       = Join-Path $toolsRoot 'mariadb'
    MariaDbData       = Join-Path $runtimeRoot 'data\mariadb'
    JudgeConfig       = Join-Path $configRoot 'judge-config.json'
    MariaDbConfig     = Join-Path $configRoot 'mariadb.ini'
    MariaDbRootClient = Join-Path $configRoot 'mariadb-root-client.ini'
    MariaDbPid        = Join-Path $runtimeRoot 'mariadb.pid'
    BackendPid        = Join-Path $runtimeRoot 'backend.pid'
    FrontendPid       = Join-Path $runtimeRoot 'frontend.pid'
    NpmCache          = Join-Path $runtimeRoot 'npm-cache'
  }
}

function New-JudgeDirectory {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Initialize-JudgeRuntimeDirectories {
  param([Parameter(Mandatory = $true)]$Paths)
  foreach ($directory in @(
    $Paths.RuntimeRoot,
    $Paths.ConfigRoot,
    $Paths.LogsRoot,
    $Paths.ToolsRoot,
    $Paths.DownloadsRoot,
    (Split-Path $Paths.MariaDbData -Parent),
    $Paths.NpmCache
  )) {
    New-JudgeDirectory -Path $directory
  }
}

function Write-JudgeStep {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Host ''
  Write-Host ('=' * 68) -ForegroundColor DarkCyan
  Write-Host ("  {0}" -f $Message) -ForegroundColor Cyan
  Write-Host ('=' * 68) -ForegroundColor DarkCyan
}

function Write-JudgeSuccess {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Host ("[成功] {0}" -f $Message) -ForegroundColor Green
}

function Get-RandomAlphaNumericToken {
  param([int]$Length = 48)

  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $bytes = New-Object byte[] $Length
    $generator.GetBytes($bytes)
    $builder = New-Object System.Text.StringBuilder
    foreach ($value in $bytes) {
      [void]$builder.Append($alphabet[$value % $alphabet.Length])
    }
    return $builder.ToString()
  } finally {
    $generator.Dispose()
  }
}

function Test-LocalTcpPort {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$TimeoutMilliseconds = 500
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $asyncResult = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $asyncResult.AsyncWaitHandle.WaitOne($TimeoutMilliseconds, $false)) {
      return $false
    }
    $client.EndConnect($asyncResult)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Get-AvailableJudgeDatabasePort {
  param(
    [int]$FirstPort = 3307,
    [int]$LastPort = 3399
  )

  foreach ($candidate in $FirstPort..$LastPort) {
    if (-not (Test-LocalTcpPort -Port $candidate)) {
      return $candidate
    }
  }
  throw "未找到可用的本地数据库端口（已检查 $FirstPort-$LastPort）。"
}

function Read-JudgeConfig {
  param([Parameter(Mandatory = $true)]$Paths)

  if (-not (Test-Path -LiteralPath $Paths.JudgeConfig)) {
    throw '评委运行配置尚未生成，请先双击“一键安装环境.bat”。'
  }
  try {
    return Get-Content -LiteralPath $Paths.JudgeConfig -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "评委运行配置无法读取：$($_.Exception.Message)"
  }
}

function Save-JudgeConfig {
  param(
    [Parameter(Mandatory = $true)]$Paths,
    [Parameter(Mandatory = $true)]$Config
  )

  $Config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Paths.JudgeConfig -Encoding UTF8
}

function Write-MariaDbConfiguration {
  param(
    [Parameter(Mandatory = $true)]$Paths,
    [Parameter(Mandatory = $true)]$Config
  )

  # MariaDB 在 Windows 上会按单字节编码读取部分 option-file 路径。
  # 使用相对于便携 MariaDB 工作目录的 ASCII 路径，避免中文用户名/目录被替换成 ???。
  $baseDirectory = '.'
  $dataDirectory = '../../data/mariadb'
  $errorLog = '../../logs/mariadb-error.log'
  $port = [int]$Config.databasePort

  @"
[mariadbd]
basedir="$baseDirectory"
datadir="$dataDirectory"
port=$port
bind-address=127.0.0.1
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
max_connections=100
max_allowed_packet=64M
log_error="$errorLog"
skip_name_resolve=ON

[client]
host=127.0.0.1
port=$port
protocol=tcp
default-character-set=utf8mb4
skip-ssl
"@ | Set-Content -LiteralPath $Paths.MariaDbConfig -Encoding ASCII

  @"
[client]
host=127.0.0.1
port=$port
protocol=tcp
user=root
password=$($Config.databaseRootPassword)
default-character-set=utf8mb4
skip-ssl
"@ | Set-Content -LiteralPath $Paths.MariaDbRootClient -Encoding ASCII
}

function Test-JudgeDatabaseConnection {
  param(
    [Parameter(Mandatory = $true)]$Paths,
    [Parameter(Mandatory = $true)]$Config
  )

  $adminExecutable = Join-Path $Paths.MariaDbHome 'bin\mariadb-admin.exe'
  if (-not (Test-Path -LiteralPath $adminExecutable)) {
    $adminExecutable = Join-Path $Paths.MariaDbHome 'bin\mysqladmin.exe'
  }
  if (-not (Test-Path -LiteralPath $adminExecutable)) {
    return $false
  }

  $oldPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $adminExecutable "--defaults-file=$($Paths.MariaDbRootClient)" ping --silent 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $oldPreference
  }
}

function Start-JudgeDatabase {
  param(
    [Parameter(Mandatory = $true)]$Paths,
    [Parameter(Mandatory = $true)]$Config,
    [int]$TimeoutSeconds = 60
  )

  if (Test-JudgeDatabaseConnection -Paths $Paths -Config $Config) {
    Write-JudgeSuccess '便携数据库已在运行'
    return $null
  }

  $port = [int]$Config.databasePort
  if (Test-LocalTcpPort -Port $port) {
    throw "端口 $port 已被其他程序占用，且不是本项目数据库。请关闭占用程序后重试。"
  }

  $serverExecutable = Join-Path $Paths.MariaDbHome 'bin\mariadbd.exe'
  if (-not (Test-Path -LiteralPath $serverExecutable)) {
    $serverExecutable = Join-Path $Paths.MariaDbHome 'bin\mysqld.exe'
  }
  if (-not (Test-Path -LiteralPath $serverExecutable)) {
    throw '没有找到便携 MariaDB，请先双击“一键安装环境.bat”。'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $Paths.MariaDbData 'mysql'))) {
    throw '数据库尚未初始化，请先双击“一键安装环境.bat”。'
  }

  Write-Host ("[数据库] 正在启动 127.0.0.1:{0} ..." -f $port)
  $stdoutLog = Join-Path $Paths.LogsRoot 'mariadb-console.log'
  $stderrLog = Join-Path $Paths.LogsRoot 'mariadb-console-error.log'
  $argumentLine = '--defaults-file="{0}" --console' -f $Paths.MariaDbConfig
  $databaseProcess = Start-Process `
    -FilePath $serverExecutable `
    -ArgumentList $argumentLine `
    -WorkingDirectory $Paths.MariaDbHome `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  $databaseProcess.Id | Set-Content -LiteralPath $Paths.MariaDbPid -Encoding ASCII
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-JudgeDatabaseConnection -Paths $Paths -Config $Config) {
      Write-JudgeSuccess ("便携数据库已启动（端口 {0}）" -f $port)
      return $databaseProcess
    }
    if ($databaseProcess.HasExited) {
      break
    }
    Start-Sleep -Milliseconds 500
  }

  $details = ''
  foreach ($logFile in @($stderrLog, (Join-Path $Paths.LogsRoot 'mariadb-error.log'), $stdoutLog)) {
    if (Test-Path -LiteralPath $logFile) {
      $tail = (Get-Content -LiteralPath $logFile -Tail 15 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
      if ($tail) {
        $details = $tail
        break
      }
    }
  }
  throw "便携数据库启动失败。日志：$details"
}

function Set-JudgeProcessEnvironment {
  param(
    [Parameter(Mandatory = $true)]$Paths,
    [Parameter(Mandatory = $true)]$Config
  )

  $databaseUser = [Uri]::EscapeDataString([string]$Config.databaseUser)
  $databasePassword = [Uri]::EscapeDataString([string]$Config.databasePassword)
  $databaseName = [Uri]::EscapeDataString([string]$Config.databaseName)
  $env:DATABASE_URL = 'mysql://{0}:{1}@127.0.0.1:{2}/{3}' -f $databaseUser, $databasePassword, $Config.databasePort, $databaseName
  $env:DATABASE_CONNECTION_LIMIT = '5'
  $env:NODE_ENV = 'development'
  $env:HOST = '127.0.0.1'
  $env:PORT = '3000'
  $env:JWT_SECRET = [string]$Config.jwtSecret
  $env:AI_CONFIG_ENCRYPTION_KEY = [string]$Config.aiEncryptionKey
  $env:AI_CONFIG_DB_ENABLED = 'true'
  $env:AI_CONFIG_ENV_FALLBACK_ENABLED = 'false'
  $env:CORS_ORIGIN = 'http://localhost:5173,http://127.0.0.1:5173'
  $env:REFRESH_TOKEN_COOKIE_SECURE = 'false'
  $env:REFRESH_TOKEN_SAME_SITE = 'lax'
  $env:PUBLIC_TEACHER_REGISTRATION_ENABLED = 'false'
  $env:VITE_PUBLIC_TEACHER_REGISTRATION_ENABLED = 'false'
  $env:VITE_SHOW_DEMO_ACCOUNTS = 'true'
  $env:VITE_API_BASE_URL = '/api'
  $env:PPT_GENERATION_PROVIDER = 'demo'
  $env:IMAGE_GENERATION_ENABLED = 'false'
  $env:DIFY_EXPLAINER_ENABLED = 'false'
  $env:DIFY_DIAGNOSTICIAN_ENABLED = 'false'
  $env:ARTIFACT_CLEANUP_ENABLED = 'false'
  $env:NPM_CONFIG_CACHE = $Paths.NpmCache
  $env:Path = $Paths.NodeHome + [IO.Path]::PathSeparator + $env:Path
}

function Test-DisciMindBackend {
  try {
    $result = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 3 -Method Get
    return $result.code -eq 200 -and $result.data.name -eq 'DisciMind Backend'
  } catch {
    return $false
  }
}

function Test-DisciMindFrontend {
  try {
    $result = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 3 -Method Get
    return $result.StatusCode -eq 200 -and $result.Content -match 'DisciMind'
  } catch {
    return $false
  }
}

function Wait-ForJudgeService {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Probe,
    [Parameter(Mandatory = $true)][string]$ServiceName,
    [int]$TimeoutSeconds = 90,
    [System.Diagnostics.Process]$Process
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (& $Probe) {
      return
    }
    if ($null -ne $Process -and $Process.HasExited) {
      throw "$ServiceName 进程已提前退出（退出码 $($Process.ExitCode)）。"
    }
    Start-Sleep -Milliseconds 700
  }
  throw "$ServiceName 在 $TimeoutSeconds 秒内未就绪。"
}

function Get-LogTail {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$Lines = 30
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    return '（没有生成日志文件）'
  }
  return (Get-Content -LiteralPath $Path -Tail $Lines -ErrorAction SilentlyContinue) -join [Environment]::NewLine
}
