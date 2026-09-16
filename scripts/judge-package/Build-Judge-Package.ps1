[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [string]$PackageName
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Common.ps1')

$projectRoot = Get-DisciMindProjectRoot
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $projectRoot 'release'
}
if (-not $PackageName) {
  $PackageName = 'DisciMind-软件杯复活赛-完整源码-{0}.zip' -f (Get-Date -Format 'yyyyMMdd-HHmm')
}
if ([IO.Path]::GetExtension($PackageName) -ne '.zip') {
  throw 'PackageName 必须以 .zip 结尾。'
}

New-JudgeDirectory -Path $OutputDirectory
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\')
$stagingRoot = Join-Path $outputRoot 'DisciMind-评委版'
$packagePath = Join-Path $outputRoot $PackageName
$hashPath = "$packagePath.sha256.txt"

if ($outputRoot -eq [IO.Path]::GetFullPath($projectRoot).TrimEnd('\')) {
  throw '输出目录不能直接设为项目根目录，请使用项目外目录或默认的 release 目录。'
}
if ($stagingRoot -eq $projectRoot -or -not $stagingRoot.StartsWith($outputRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw '打包暂存目录不安全，已拒绝执行。'
}

if (Test-Path -LiteralPath $stagingRoot) {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}
if (Test-Path -LiteralPath $packagePath) {
  Remove-Item -LiteralPath $packagePath -Force
}
if (Test-Path -LiteralPath $hashPath) {
  Remove-Item -LiteralPath $hashPath -Force
}
New-JudgeDirectory -Path $stagingRoot

foreach ($scriptFile in (Get-ChildItem -LiteralPath (Join-Path $projectRoot 'scripts\judge-package') -Filter '*.ps1' -File)) {
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($scriptFile.FullName, [ref]$tokens, [ref]$parseErrors) | Out-Null
  if ($parseErrors.Count -gt 0) {
    $details = ($parseErrors | ForEach-Object { "第 $($_.Extent.StartLineNumber) 行：$($_.Message)" }) -join '；'
    throw "PowerShell 脚本语法检查失败（$($scriptFile.Name)）：$details"
  }
}

$excludedDirectories = @(
  $outputRoot,
  (Join-Path $projectRoot '.git'),
  (Join-Path $projectRoot '.agents'),
  (Join-Path $projectRoot '.codex'),
  (Join-Path $projectRoot '.judge-runtime'),
  (Join-Path $projectRoot '.vite'),
  (Join-Path $projectRoot '.codex-browser-logs'),
  (Join-Path $projectRoot 'release'),
  (Join-Path $projectRoot 'artifacts'),
  (Join-Path $projectRoot 'tmp'),
  (Join-Path $projectRoot 'logs'),
  (Join-Path $projectRoot 'storage'),
  (Join-Path $projectRoot 'backend\storage'),
  (Join-Path $projectRoot 'backend\node_modules'),
  (Join-Path $projectRoot 'backend\tmp'),
  (Join-Path $projectRoot 'backend\dist'),
  (Join-Path $projectRoot 'backend\storage\generated-artifacts'),
  (Join-Path $projectRoot 'backend\storage\learning-cards'),
  (Join-Path $projectRoot 'backend\storage\learning-flow-preloads'),
  (Join-Path $projectRoot 'backend\storage\langgraph'),
  (Join-Path $projectRoot 'backend\storage\uploads'),
  (Join-Path $projectRoot 'frontend\node_modules'),
  (Join-Path $projectRoot 'frontend\dist'),
  (Join-Path $projectRoot 'storage\agent-knowledge'),
  (Join-Path $projectRoot 'storage\course-files'),
  (Join-Path $projectRoot 'storage\learning-cards'),
  (Join-Path $projectRoot 'storage\learning-flow-preloads'),
  (Join-Path $projectRoot 'storage\lesson-plans'),
  (Join-Path $projectRoot 'storage\langgraph'),
  (Join-Path $projectRoot 'storage\learning-narration'),
  (Join-Path $projectRoot 'storage\temp'),
  (Join-Path $projectRoot 'storage\uploads')
)

Write-Host '[打包] 正在复制评委运行所需的源文件 ...' -ForegroundColor Cyan
$robocopyArguments = @(
  $projectRoot,
  $stagingRoot,
  '/E',
  '/R:1',
  '/W:1',
  '/NFL',
  '/NDL',
  '/NJH',
  '/NJS',
  '/NP',
  '/XD'
) + $excludedDirectories + @(
  '/XF',
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '*.log',
  'test-ztc.txt'
)

& robocopy.exe @robocopyArguments | Out-Host
$robocopyExitCode = $LASTEXITCODE
if ($robocopyExitCode -gt 7) {
  throw "复制项目文件失败（Robocopy 退出码 $robocopyExitCode）。"
}

foreach ($requiredFile in @('一键安装环境.bat', '一键启动.bat', 'scripts\judge-package\Install-Environment.ps1', 'scripts\judge-package\Start-DisciMind.ps1')) {
  if (-not (Test-Path -LiteralPath (Join-Path $stagingRoot $requiredFile))) {
    throw "评委包缺少必要文件：$requiredFile"
  }
}

foreach ($runtimeDirectory in @('storage', 'backend\storage')) {
  $directoryPath = Join-Path $stagingRoot $runtimeDirectory
  New-JudgeDirectory -Path $directoryPath
  Set-Content -LiteralPath (Join-Path $directoryPath '.gitkeep') -Value '' -Encoding ASCII
}

$sourceCommit = 'unknown'
$sourceDirty = $true
try {
  $sourceCommit = (& git -C $projectRoot rev-parse HEAD 2>$null).Trim()
  $sourceDirty = [bool](& git -C $projectRoot status --porcelain 2>$null)
} catch {}

$buildInfo = [ordered]@{
  packageFormatVersion = 2
  project              = 'DisciMind（学研智擎）'
  competition          = '中国大学生服务外包创新创业大赛（软件杯复活赛提交版）'
  generatedAt          = [DateTime]::UtcNow.ToString('o')
  sourceCommit         = $sourceCommit
  sourceWorkingTreeDirty = $sourceDirty
  runtime              = 'Windows 10/11 x64; Node.js 22; MariaDB 11.4; optional Docker Desktop + Judge0'
  secretsIncluded      = $false
}
$buildInfo | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stagingRoot 'BUILD-INFO.json') -Encoding UTF8

$manifestPath = Join-Path $stagingRoot 'SOURCE-MANIFEST.sha256'
$manifestLines = Get-ChildItem -LiteralPath $stagingRoot -Recurse -Force -File |
  Where-Object { $_.FullName -ne $manifestPath } |
  Sort-Object FullName |
  ForEach-Object {
    $relativePath = $_.FullName.Substring($stagingRoot.Length + 1).Replace('\', '/')
    $fileHash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    '{0}  {1}' -f $fileHash, $relativePath
  }
$manifestLines | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host '[打包] 正在执行提交完整性与脱敏检查 ...' -ForegroundColor Cyan
& powershell.exe `
  -NoLogo `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File (Join-Path $stagingRoot 'scripts\judge-package\Test-Judge-Package.ps1') `
  -PackageRoot $stagingRoot
if ($LASTEXITCODE -ne 0) {
  throw "评委包完整性检查失败（退出码 $LASTEXITCODE）。"
}

Write-Host '[打包] 正在生成 ZIP，过程可能需要几分钟 ...' -ForegroundColor Cyan
Compress-Archive -LiteralPath $stagingRoot -DestinationPath $packagePath -CompressionLevel Optimal
$hash = Get-FileHash -LiteralPath $packagePath -Algorithm SHA256
("{0}  {1}" -f $hash.Hash.ToLowerInvariant(), (Split-Path $packagePath -Leaf)) | Set-Content -LiteralPath $hashPath -Encoding UTF8

try {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force
} catch {
  Write-Warning "ZIP 已成功生成，但暂存目录未能自动清理：$stagingRoot"
}

$packageSize = (Get-Item -LiteralPath $packagePath).Length / 1MB
Write-Host ''
Write-Host '评委包生成完成：' -ForegroundColor Green
Write-Host $packagePath -ForegroundColor White
Write-Host ('大小：{0:N1} MB' -f $packageSize) -ForegroundColor White
Write-Host ('SHA-256：{0}' -f $hash.Hash.ToLowerInvariant()) -ForegroundColor DarkGray
