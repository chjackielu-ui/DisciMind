[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

. (Join-Path $PSScriptRoot 'Common.ps1')

$nodeVersion = '22.23.1'
$nodeFolderName = "node-v$nodeVersion-win-x64"
$nodeArchiveName = "$nodeFolderName.zip"
$nodeArchiveUrl = "https://nodejs.org/dist/v$nodeVersion/$nodeArchiveName"
$nodeArchiveSha256 = '7df0bc9375723f4a86b3aa1b7cc73342423d9677a8df4538aca31a049e309c29'

$mariaDbVersion = '11.4.7'
$mariaDbFolderName = "mariadb-$mariaDbVersion-winx64"
$mariaDbArchiveName = "$mariaDbFolderName.zip"
$mariaDbArchiveUrl = "https://archive.mariadb.org/mariadb-$mariaDbVersion/winx64-packages/$mariaDbArchiveName"
$mariaDbArchiveSha256 = '983909230004df6c76088fb8869a5055698fd29d39a40fc64525b81db07f287c'

$paths = Get-JudgeRuntimePaths
Initialize-JudgeRuntimeDirectories -Paths $paths

$transcriptStarted = $false
try {
  Start-Transcript -LiteralPath (Join-Path $paths.LogsRoot 'install-environment.log') -Append | Out-Null
  $transcriptStarted = $true
} catch {
  Write-Warning '无法开启安装过程记录，将继续安装。'
}

function Assert-SupportedComputer {
  if (-not [Environment]::Is64BitOperatingSystem) {
    throw '评委便携版只支持 64 位 Windows 10/11。'
  }

  $rootDriveName = ([IO.Path]::GetPathRoot($paths.ProjectRoot)).TrimEnd('\').TrimEnd(':')
  $drive = Get-PSDrive -Name $rootDriveName -ErrorAction SilentlyContinue
  if ($null -ne $drive -and $null -ne $drive.Free -and $drive.Free -lt 3GB) {
    throw ('磁盘可用空间不足 3 GB。当前剩余约 {0:N1} GB，请清理空间后重试。' -f ($drive.Free / 1GB))
  }
}

function Test-ArchiveHash {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }
  $actualHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  return $actualHash -eq $ExpectedSha256.ToLowerInvariant()
}

function Get-VerifiedArchive {
  param(
    [Parameter(Mandatory = $true)][string]$ArchiveName,
    [Parameter(Mandatory = $true)][string]$DownloadUrl,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256
  )

  $destination = Join-Path $paths.DownloadsRoot $ArchiveName
  if (Test-ArchiveHash -Path $destination -ExpectedSha256 $ExpectedSha256) {
    Write-Host "[缓存] 已验证 $ArchiveName"
    return $destination
  }

  if (Test-Path -LiteralPath $destination) {
    Remove-Item -LiteralPath $destination -Force
  }

  $offlineSource = Join-Path (Join-Path $PSScriptRoot 'cache') $ArchiveName
  if (Test-Path -LiteralPath $offlineSource) {
    Write-Host "[离线缓存] 正在复制 $ArchiveName ..."
    Copy-Item -LiteralPath $offlineSource -Destination $destination -Force
  } else {
    $partialFile = "$destination.partial"
    if (Test-ArchiveHash -Path $partialFile -ExpectedSha256 $ExpectedSha256) {
      Move-Item -LiteralPath $partialFile -Destination $destination -Force
    } else {
      $curlCommand = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
      if ($null -ne $curlCommand) {
        if (Test-Path -LiteralPath $partialFile) {
          $partialSizeMb = (Get-Item -LiteralPath $partialFile).Length / 1MB
          Write-Host ("[续传] 已保留 {0:N1} MB，正在从断点继续下载 ..." -f $partialSizeMb)
        } else {
          Write-Host "[下载] $DownloadUrl"
        }
        $curlArguments = @(
          '--fail',
          '--location',
          '--retry', '5',
          '--retry-delay', '3',
          '--retry-all-errors',
          '--connect-timeout', '30',
          '--continue-at', '-',
          '--output', $partialFile,
          $DownloadUrl
        )
        & $curlCommand.Source @curlArguments
        if ($LASTEXITCODE -ne 0) {
          throw "下载 $ArchiveName 失败（curl 退出码 $LASTEXITCODE）。未完成文件已保留；检查网络后重新运行会自动断点续传。"
        }
      } else {
        $downloadSucceeded = $false
        $lastDownloadError = ''
        foreach ($downloadAttempt in 1..3) {
          Write-Host "[下载 $downloadAttempt/3] $DownloadUrl"
          try {
            Invoke-WebRequest -UseBasicParsing -Uri $DownloadUrl -OutFile $partialFile -TimeoutSec 1800
            $downloadSucceeded = $true
            break
          } catch {
            $lastDownloadError = $_.Exception.Message
            if ($downloadAttempt -lt 3) {
              Write-Warning "连接中断，5 秒后自动重试：$lastDownloadError"
              Start-Sleep -Seconds 5
            }
          }
        }
        if (-not $downloadSucceeded) {
          throw "下载 $ArchiveName 失败。请确认电脑可以访问互联网，或把官方压缩包放入 scripts\judge-package\cache。原始错误：$lastDownloadError"
        }
      }
      Move-Item -LiteralPath $partialFile -Destination $destination -Force
    }
  }

  if (-not (Test-ArchiveHash -Path $destination -ExpectedSha256 $ExpectedSha256)) {
    Remove-Item -LiteralPath $destination -Force
    throw "$ArchiveName 的 SHA-256 校验失败，文件可能下载不完整，已删除该文件。"
  }
  Write-JudgeSuccess "$ArchiveName 下载及完整性校验完成"
  return $destination
}

function Expand-PortableTool {
  param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [Parameter(Mandatory = $true)][string]$ExpectedFolderName,
    [Parameter(Mandatory = $true)][string]$TargetHome,
    [Parameter(Mandatory = $true)][string]$RequiredRelativeFile
  )

  $requiredFile = Join-Path $TargetHome $RequiredRelativeFile
  if (Test-Path -LiteralPath $requiredFile) {
    Write-Host "[已有] $TargetHome"
    return
  }

  $toolsRootFull = [IO.Path]::GetFullPath($paths.ToolsRoot).TrimEnd('\') + '\'
  $targetFull = [IO.Path]::GetFullPath($TargetHome)
  if (-not $targetFull.StartsWith($toolsRootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝清理运行目录以外的路径：$targetFull"
  }

  $extractRoot = Join-Path $paths.RuntimeRoot ("extract-" + [Guid]::NewGuid().ToString('N'))
  try {
    New-JudgeDirectory -Path $extractRoot
    Write-Host "[解压] $(Split-Path $ArchivePath -Leaf) ..."
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $extractRoot -Force
    $sourceHome = Join-Path $extractRoot $ExpectedFolderName
    if (-not (Test-Path -LiteralPath (Join-Path $sourceHome $RequiredRelativeFile))) {
      throw "压缩包结构不符合预期，缺少 $RequiredRelativeFile。"
    }
    if (Test-Path -LiteralPath $TargetHome) {
      Remove-Item -LiteralPath $TargetHome -Recurse -Force
    }
    Move-Item -LiteralPath $sourceHome -Destination $TargetHome
    Write-JudgeSuccess "已准备 $(Split-Path $TargetHome -Leaf)"
  } finally {
    if (Test-Path -LiteralPath $extractRoot) {
      Remove-Item -LiteralPath $extractRoot -Recurse -Force
    }
  }
}

function Get-OrCreateJudgeConfig {
  if (Test-Path -LiteralPath $paths.JudgeConfig) {
    $existingConfig = Read-JudgeConfig -Paths $paths
    foreach ($requiredProperty in @('databasePort', 'databaseName', 'databaseUser', 'databasePassword', 'databaseRootPassword', 'jwtSecret', 'aiEncryptionKey')) {
      if (-not ($existingConfig.PSObject.Properties.Name -contains $requiredProperty) -or -not [string]$existingConfig.$requiredProperty) {
        throw "已有评委配置缺少 $requiredProperty。请查看 $($paths.JudgeConfig)，不要删除已有数据库数据。"
      }
    }
    if (-not ($existingConfig.PSObject.Properties.Name -contains 'judge0DatabasePassword') -or
        [string]::IsNullOrWhiteSpace([string]$existingConfig.judge0DatabasePassword)) {
      $existingConfig | Add-Member -NotePropertyName judge0DatabasePassword -NotePropertyValue (Get-RandomAlphaNumericToken -Length 64) -Force
      Save-JudgeConfig -Paths $paths -Config $existingConfig
      Write-JudgeSuccess '已为现有评委配置补充 Judge0 随机数据库密码'
    }
    return $existingConfig
  }

  if (Test-Path -LiteralPath (Join-Path $paths.MariaDbData 'mysql')) {
    throw '检测到已有数据库数据，但运行配置已丢失。为保护数据，安装程序不会重置数据库；请找回 .judge-runtime\config\judge-config.json。'
  }

  $newConfig = [pscustomobject]@{
    schemaVersion          = 1
    createdAt              = [DateTime]::UtcNow.ToString('o')
    nodeVersion            = $nodeVersion
    mariaDbVersion         = $mariaDbVersion
    databasePort           = Get-AvailableJudgeDatabasePort
    databaseName           = 'discimind'
    databaseUser           = 'discimind_app'
    databasePassword       = Get-RandomAlphaNumericToken -Length 40
    databaseRootPassword   = Get-RandomAlphaNumericToken -Length 48
    jwtSecret              = Get-RandomAlphaNumericToken -Length 64
    aiEncryptionKey        = Get-RandomAlphaNumericToken -Length 64
    judge0DatabasePassword = Get-RandomAlphaNumericToken -Length 64
  }
  Save-JudgeConfig -Paths $paths -Config $newConfig
  Write-JudgeSuccess '已生成仅用于本机演示的随机安全配置'
  return $newConfig
}

function Initialize-PortableDatabase {
  param([Parameter(Mandatory = $true)]$Config)

  if (Test-Path -LiteralPath (Join-Path $paths.MariaDbData 'mysql')) {
    Write-Host '[已有] 数据库系统表已初始化'
    return
  }

  New-JudgeDirectory -Path $paths.MariaDbData
  $installer = Join-Path $paths.MariaDbHome 'bin\mariadb-install-db.exe'
  if (-not (Test-Path -LiteralPath $installer)) {
    $installer = Join-Path $paths.MariaDbHome 'bin\mysql_install_db.exe'
  }
  if (-not (Test-Path -LiteralPath $installer)) {
    throw 'MariaDB 压缩包中没有找到 mariadb-install-db.exe。'
  }

  Write-Host '[数据库] 正在初始化本项目专用数据目录 ...'
  & $installer "--datadir=$($paths.MariaDbData)" "--password=$($Config.databaseRootPassword)" "--port=$($Config.databasePort)"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $paths.MariaDbData 'mysql'))) {
    throw "数据库初始化失败（退出码 $LASTEXITCODE）。安装程序不会执行数据库重置，请查看 $($paths.LogsRoot)。"
  }
  Write-JudgeSuccess '数据库系统表初始化完成'
}

function Initialize-ApplicationDatabaseUser {
  param([Parameter(Mandatory = $true)]$Config)

  $databaseName = [string]$Config.databaseName
  $databaseUser = [string]$Config.databaseUser
  $databasePassword = [string]$Config.databasePassword
  if ($databaseName -notmatch '^[A-Za-z0-9_]+$' -or $databaseUser -notmatch '^[A-Za-z0-9_]+$' -or $databasePassword -notmatch '^[A-Za-z0-9]+$') {
    throw '评委数据库配置包含不受支持的字符，请删除尚未使用的 .judge-runtime 后重新安装。'
  }

  $client = Join-Path $paths.MariaDbHome 'bin\mariadb.exe'
  if (-not (Test-Path -LiteralPath $client)) {
    $client = Join-Path $paths.MariaDbHome 'bin\mysql.exe'
  }
  $sql = "CREATE DATABASE IF NOT EXISTS $databaseName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; " +
    "CREATE USER IF NOT EXISTS '$databaseUser'@'127.0.0.1' IDENTIFIED BY '$databasePassword'; " +
    "ALTER USER '$databaseUser'@'127.0.0.1' IDENTIFIED BY '$databasePassword'; " +
    "GRANT ALL PRIVILEGES ON $databaseName.* TO '$databaseUser'@'127.0.0.1'; FLUSH PRIVILEGES;"
  & $client "--defaults-file=$($paths.MariaDbRootClient)" "--execute=$sql"
  if ($LASTEXITCODE -ne 0) {
    throw "创建本项目数据库和专用账号失败（退出码 $LASTEXITCODE）。"
  }
  Write-JudgeSuccess '应用数据库及最小范围专用账号已就绪'
}

function Invoke-NpmCleanInstall {
  param(
    [Parameter(Mandatory = $true)][string]$Directory,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $npm = Join-Path $paths.NodeHome 'npm.cmd'
  Push-Location $Directory
  try {
    Write-Host ("[依赖] 正在安装{0}依赖 ..." -f $Label)
    & $npm ci --no-audit --no-fund --prefer-offline
    if ($LASTEXITCODE -ne 0) {
      Write-Warning '默认 npm 源安装失败，正在使用国内镜像重试一次。'
      & $npm ci --no-audit --no-fund --prefer-offline --registry=https://registry.npmmirror.com
    }
    if ($LASTEXITCODE -ne 0) {
      throw ("{0}依赖安装失败（退出码 {1}）。请检查网络或代理设置。" -f $Label, $LASTEXITCODE)
    }
  } finally {
    Pop-Location
  }
  Write-JudgeSuccess ("{0}依赖安装完成" -f $Label)
}

function Invoke-BackendSetup {
  $backendDirectory = Join-Path $paths.ProjectRoot 'backend'
  $npx = Join-Path $paths.NodeHome 'npx.cmd'
  $node = Join-Path $paths.NodeHome 'node.exe'
  Push-Location $backendDirectory
  try {
    Write-Host '[Prisma] 生成数据库客户端 ...'
    & $npx --no-install prisma generate
    if ($LASTEXITCODE -ne 0) { throw "Prisma 客户端生成失败（退出码 $LASTEXITCODE）。" }

    Write-Host '[Prisma] 安全应用尚未执行的数据库迁移 ...'
    & $npx --no-install prisma migrate deploy
    if ($LASTEXITCODE -ne 0) { throw "数据库迁移失败（退出码 $LASTEXITCODE）。安装程序未执行 reset。" }

    Write-Host '[演示数据] 正在幂等写入演示账号、课程和学习记录 ...'
    & $node 'prisma\seed.js'
    if ($LASTEXITCODE -ne 0) { throw "演示数据写入失败（退出码 $LASTEXITCODE）。" }

    $judgeSeed = Join-Path $backendDirectory 'prisma\seed-judge-demo.js'
    if (Test-Path -LiteralPath $judgeSeed) {
      Write-Host '[评委数据] 正在补齐三端通知与 AI 安全治理演示数据 ...'
      & $node $judgeSeed
      if ($LASTEXITCODE -ne 0) { throw "评委专项演示数据写入失败（退出码 $LASTEXITCODE）。" }
    }
  } finally {
    Pop-Location
  }
  Write-JudgeSuccess '数据库结构和演示数据已就绪'
}

function Invoke-FrontendBuildCheck {
  $frontendDirectory = Join-Path $paths.ProjectRoot 'frontend'
  $npm = Join-Path $paths.NodeHome 'npm.cmd'
  Push-Location $frontendDirectory
  try {
    Write-Host '[检查] 正在执行前端生产构建校验 ...'
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw "前端构建校验失败（退出码 $LASTEXITCODE）。" }
  } finally {
    Pop-Location
  }
  Write-JudgeSuccess '前端构建校验通过'
}

try {
  Write-Host ''
  Write-Host 'DisciMind（学研智擎）评委版环境安装' -ForegroundColor White
  Write-Host '所有运行环境均放在当前项目的 .judge-runtime 目录，不修改系统 PATH。' -ForegroundColor DarkGray
  Assert-SupportedComputer

  if (-not (Test-Path -LiteralPath (Join-Path $paths.ProjectRoot 'backend\package-lock.json')) -or
      -not (Test-Path -LiteralPath (Join-Path $paths.ProjectRoot 'frontend\package-lock.json'))) {
    throw '项目文件不完整：缺少前端或后端 package-lock.json。请重新解压完整评委包。'
  }

  Write-JudgeStep '1/7 准备便携 Node.js 与 MariaDB'
  $nodeArchive = Get-VerifiedArchive -ArchiveName $nodeArchiveName -DownloadUrl $nodeArchiveUrl -ExpectedSha256 $nodeArchiveSha256
  Expand-PortableTool -ArchivePath $nodeArchive -ExpectedFolderName $nodeFolderName -TargetHome $paths.NodeHome -RequiredRelativeFile 'node.exe'
  $mariaDbArchive = Get-VerifiedArchive -ArchiveName $mariaDbArchiveName -DownloadUrl $mariaDbArchiveUrl -ExpectedSha256 $mariaDbArchiveSha256
  Expand-PortableTool -ArchivePath $mariaDbArchive -ExpectedFolderName $mariaDbFolderName -TargetHome $paths.MariaDbHome -RequiredRelativeFile 'bin\mariadbd.exe'

  Write-JudgeStep '2/7 生成安全的本地演示配置并初始化数据库'
  $config = Get-OrCreateJudgeConfig
  Write-MariaDbConfiguration -Paths $paths -Config $config
  Initialize-PortableDatabase -Config $config
  [void](Start-JudgeDatabase -Paths $paths -Config $config)
  Initialize-ApplicationDatabaseUser -Config $config
  Set-JudgeProcessEnvironment -Paths $paths -Config $config

  Write-JudgeStep '3/7 安装后端依赖'
  Invoke-NpmCleanInstall -Directory (Join-Path $paths.ProjectRoot 'backend') -Label '后端'

  Write-JudgeStep '4/7 安装前端依赖'
  Invoke-NpmCleanInstall -Directory (Join-Path $paths.ProjectRoot 'frontend') -Label '前端'

  Write-JudgeStep '5/7 应用迁移并注入完整演示数据'
  Invoke-BackendSetup

  Write-JudgeStep '6/7 完成启动前构建检查'
  Invoke-FrontendBuildCheck

  Write-JudgeStep '7/7 检查并启动 C / Python 在线编译沙箱'
  [void](Start-Judge0IfAvailable -Paths $paths -Config $config)
  [DateTime]::UtcNow.ToString('o') | Set-Content -LiteralPath (Join-Path $paths.RuntimeRoot 'installed.ok') -Encoding ASCII

  Write-Host ''
  Write-Host '环境部署完成！现在请双击“一键启动.bat”。' -ForegroundColor Green
  Write-Host '演示账号：admin_demo / teacher_demo / student_demo，密码均为 123456。' -ForegroundColor Yellow
  Write-Host ("详细日志：{0}" -f $paths.LogsRoot) -ForegroundColor DarkGray
  exit 0
} catch {
  Write-Host ''
  Write-Host ('[安装失败] ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host ("请查看日志：{0}" -f (Join-Path $paths.LogsRoot 'install-environment.log')) -ForegroundColor Yellow
  exit 1
} finally {
  if ($transcriptStarted) {
    try { Stop-Transcript | Out-Null } catch {}
  }
}
