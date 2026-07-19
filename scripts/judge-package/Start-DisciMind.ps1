[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Common.ps1')

$paths = Get-JudgeRuntimePaths
$transcriptStarted = $false

if (Test-Path -LiteralPath $paths.LogsRoot) {
  try {
    Start-Transcript -LiteralPath (Join-Path $paths.LogsRoot 'start-discimind.log') -Append | Out-Null
    $transcriptStarted = $true
  } catch {
    Write-Warning '无法开启启动过程记录，将继续启动。'
  }
}

function Assert-JudgeInstallationReady {
  $requiredFiles = @(
    (Join-Path $paths.RuntimeRoot 'installed.ok'),
    (Join-Path $paths.NodeHome 'node.exe'),
    (Join-Path $paths.MariaDbHome 'bin\mariadbd.exe'),
    (Join-Path $paths.ProjectRoot 'backend\node_modules\@prisma\client\package.json'),
    (Join-Path $paths.ProjectRoot 'frontend\node_modules\vite\package.json')
  )
  $missing = @($requiredFiles | Where-Object { -not (Test-Path -LiteralPath $_) })
  if ($missing.Count -gt 0) {
    throw '运行环境尚未完整安装，请先双击“一键安装环境.bat”，等待其显示安装完成。'
  }
}

function Start-BackendIfNeeded {
  if (Test-DisciMindBackend) {
    Write-JudgeSuccess '后端已在运行'
    return $null
  }
  if (Test-LocalTcpPort -Port 3000) {
    throw '端口 3000 已被其他程序占用。请关闭占用程序后重新双击“一键启动.bat”。'
  }

  $node = Join-Path $paths.NodeHome 'node.exe'
  $backendDirectory = Join-Path $paths.ProjectRoot 'backend'
  $stdoutLog = Join-Path $paths.LogsRoot 'backend.log'
  $stderrLog = Join-Path $paths.LogsRoot 'backend-error.log'
  Write-Host '[后端] 正在启动 ...'
  $process = Start-Process `
    -FilePath $node `
    -ArgumentList 'src/server.js' `
    -WorkingDirectory $backendDirectory `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru
  $process.Id | Set-Content -LiteralPath $paths.BackendPid -Encoding ASCII

  try {
    Wait-ForJudgeService -Probe { Test-DisciMindBackend } -ServiceName 'DisciMind 后端' -TimeoutSeconds 120 -Process $process
  } catch {
    $logDetails = Get-LogTail -Path $stderrLog
    if ($logDetails -eq '（没有生成日志文件）') {
      $logDetails = Get-LogTail -Path $stdoutLog
    }
    throw "$($_.Exception.Message)`n后端日志末尾：`n$logDetails"
  }
  Write-JudgeSuccess '后端已就绪：http://127.0.0.1:3000'
  return $process
}

function Start-FrontendIfNeeded {
  if (Test-DisciMindFrontend) {
    Write-JudgeSuccess '前端已在运行'
    return $null
  }
  if (Test-LocalTcpPort -Port 5173) {
    throw '端口 5173 已被其他程序占用。请关闭占用程序后重新双击“一键启动.bat”。'
  }

  $node = Join-Path $paths.NodeHome 'node.exe'
  $frontendDirectory = Join-Path $paths.ProjectRoot 'frontend'
  $viteEntry = Join-Path $frontendDirectory 'node_modules\vite\bin\vite.js'
  $stdoutLog = Join-Path $paths.LogsRoot 'frontend.log'
  $stderrLog = Join-Path $paths.LogsRoot 'frontend-error.log'
  $argumentLine = '"{0}" --host 127.0.0.1 --port 5173 --strictPort' -f $viteEntry
  Write-Host '[前端] 正在启动 ...'
  $process = Start-Process `
    -FilePath $node `
    -ArgumentList $argumentLine `
    -WorkingDirectory $frontendDirectory `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru
  $process.Id | Set-Content -LiteralPath $paths.FrontendPid -Encoding ASCII

  try {
    Wait-ForJudgeService -Probe { Test-DisciMindFrontend } -ServiceName 'DisciMind 前端' -TimeoutSeconds 90 -Process $process
  } catch {
    $logDetails = Get-LogTail -Path $stderrLog
    if ($logDetails -eq '（没有生成日志文件）') {
      $logDetails = Get-LogTail -Path $stdoutLog
    }
    throw "$($_.Exception.Message)`n前端日志末尾：`n$logDetails"
  }
  Write-JudgeSuccess '前端已就绪：http://127.0.0.1:5173'
  return $process
}

try {
  Write-Host ''
  Write-Host 'DisciMind（学研智擎）评委版一键启动' -ForegroundColor White
  Assert-JudgeInstallationReady
  $config = Read-JudgeConfig -Paths $paths
  Write-MariaDbConfiguration -Paths $paths -Config $config
  Set-JudgeProcessEnvironment -Paths $paths -Config $config

  Write-JudgeStep '1/3 启动便携数据库'
  [void](Start-JudgeDatabase -Paths $paths -Config $config)

  Write-JudgeStep '2/3 启动后端服务'
  [void](Start-BackendIfNeeded)

  Write-JudgeStep '3/3 启动前端并打开浏览器'
  [void](Start-FrontendIfNeeded)

  Write-Host ''
  Write-Host '项目启动成功，正在打开浏览器……' -ForegroundColor Green
  Write-Host '演示账号：admin_demo / teacher_demo / student_demo，密码均为 123456。' -ForegroundColor Yellow
  Write-Host ("运行日志：{0}" -f $paths.LogsRoot) -ForegroundColor DarkGray
  Start-Process 'http://127.0.0.1:5173/'
  exit 0
} catch {
  Write-Host ''
  Write-Host ('[启动失败] ' + $_.Exception.Message) -ForegroundColor Red
  if (Test-Path -LiteralPath $paths.LogsRoot) {
    Write-Host ("请查看日志目录：{0}" -f $paths.LogsRoot) -ForegroundColor Yellow
  }
  exit 1
} finally {
  if ($transcriptStarted) {
    try { Stop-Transcript | Out-Null } catch {}
  }
}
