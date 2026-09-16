[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Common.ps1')

$paths = Get-JudgeRuntimePaths

function Stop-JudgeProcessFromPidFile {
  param(
    [Parameter(Mandatory = $true)][string]$PidFile,
    [Parameter(Mandatory = $true)][string[]]$ExpectedExecutables,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Host "[跳过] $Label 没有 PID 文件"
    return
  }

  $rawProcessId = (Get-Content -LiteralPath $PidFile -Raw -ErrorAction SilentlyContinue).Trim()
  $parsedProcessId = 0
  if (-not [int]::TryParse($rawProcessId, [ref]$parsedProcessId) -or $parsedProcessId -le 0) {
    Remove-Item -LiteralPath $PidFile -Force
    Write-Warning "$Label PID 文件无效，已清理。"
    return
  }

  $process = Get-Process -Id $parsedProcessId -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    Remove-Item -LiteralPath $PidFile -Force
    Write-Host "[已停止] $Label"
    return
  }

  $actualPath = ''
  try { $actualPath = [IO.Path]::GetFullPath($process.Path) } catch {}
  $matchesExpected = $false
  foreach ($expected in $ExpectedExecutables) {
    if ((Test-Path -LiteralPath $expected) -and
        $actualPath.Equals([IO.Path]::GetFullPath($expected), [StringComparison]::OrdinalIgnoreCase)) {
      $matchesExpected = $true
      break
    }
  }
  if (-not $matchesExpected) {
    Remove-Item -LiteralPath $PidFile -Force
    Write-Warning "$Label 的旧 PID 已被其他程序复用；为保护评委电脑，没有结束该进程。"
    return
  }

  Stop-Process -Id $parsedProcessId -ErrorAction Stop
  Remove-Item -LiteralPath $PidFile -Force
  Write-JudgeSuccess "$Label 已停止"
}

try {
  Write-Host ''
  Write-Host 'DisciMind（学研智擎）评委版一键停止' -ForegroundColor White

  Stop-JudgeProcessFromPidFile `
    -PidFile $paths.FrontendPid `
    -ExpectedExecutables @((Join-Path $paths.NodeHome 'node.exe')) `
    -Label '前端'
  Stop-JudgeProcessFromPidFile `
    -PidFile $paths.BackendPid `
    -ExpectedExecutables @((Join-Path $paths.NodeHome 'node.exe')) `
    -Label '后端'
  Stop-Judge0IfAvailable -Paths $paths
  Stop-JudgeProcessFromPidFile `
    -PidFile $paths.MariaDbPid `
    -ExpectedExecutables @(
      (Join-Path $paths.MariaDbHome 'bin\mariadbd.exe'),
      (Join-Path $paths.MariaDbHome 'bin\mysqld.exe')
    ) `
    -Label '数据库'

  Write-Host ''
  Write-Host 'DisciMind 相关服务已停止，数据库和演示数据均已保留。' -ForegroundColor Green
  exit 0
} catch {
  Write-Host ('[停止失败] ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
