[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PackageRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$root = [IO.Path]::GetFullPath($PackageRoot).TrimEnd('\')
if (-not (Test-Path -LiteralPath $root -PathType Container)) {
  throw "评委包目录不存在：$root"
}

$requiredFiles = @(
  '评委必读.md',
  'README.md',
  '一键部署.bat',
  '一键启动.bat',
  '一键停止.bat',
  'backend\package.json',
  'backend\package-lock.json',
  'backend\prisma\schema.prisma',
  'backend\prisma\seed.js',
  'backend\src\modules\ai-assistant\assistant-orchestrator.service.js',
  'backend\src\modules\ai-assistant\skill-registry.js',
  'backend\src\modules\ai-assistant\tool-registry.js',
  'backend\src\modules\agent-orchestration\orchestration-graph.service.js',
  'backend\src\modules\learning-agent\graph\learning-flow.graph.js',
  'backend\src\modules\compiler\judge0.service.js',
  'backend\src\modules\knowledge-base\bailian-knowledge.service.js',
  'frontend\package.json',
  'frontend\package-lock.json',
  'frontend\src\pages\student-compiler.js',
  'datasets\knowledge-408.jsonl',
  'datasets\multi-agent-evaluation.jsonl',
  'datasets\compiler-cases.json',
  'deploy\judge0\docker-compose.yml',
  'deploy\model\bailian.env.example',
  'docs\多智能体源码与运行说明.md',
  'scripts\judge-package\Install-Environment.ps1',
  'scripts\judge-package\Start-DisciMind.ps1',
  'scripts\judge-package\Stop-DisciMind.ps1'
)

$missing = @($requiredFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $root $_) -PathType Leaf) })
if ($missing.Count -gt 0) {
  throw ('评委包缺少必要文件：' + ($missing -join '，'))
}

$forbiddenDirectories = @('.git', '.judge-runtime', 'node_modules', '.codex', '.agents')
foreach ($name in $forbiddenDirectories) {
  $found = Get-ChildItem -LiteralPath $root -Recurse -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq $name } |
    Select-Object -First 1
  if ($null -ne $found) {
    throw "评委包包含禁止目录：$($found.FullName)"
  }
}

$forbiddenEnvironmentNames = @('.env', '.env.local', '.env.development', '.env.production', 'judge0.env')
$environmentFile = Get-ChildItem -LiteralPath $root -Recurse -Force -File |
  Where-Object { $forbiddenEnvironmentNames -contains $_.Name } |
  Select-Object -First 1
if ($null -ne $environmentFile) {
  throw "评委包包含真实运行环境文件：$($environmentFile.FullName)"
}

foreach ($runtimeDirectory in @('storage', 'backend\storage')) {
  $runtimeRoot = Join-Path $root $runtimeDirectory
  if (-not (Test-Path -LiteralPath $runtimeRoot -PathType Container)) {
    throw "评委包缺少空运行目录：$runtimeDirectory"
  }
  $runtimeFiles = @(Get-ChildItem -LiteralPath $runtimeRoot -Recurse -Force -File |
    Where-Object { $_.Name -ne '.gitkeep' })
  if ($runtimeFiles.Count -gt 0) {
    throw "评委包误带运行数据：$($runtimeFiles[0].FullName)"
  }
}

foreach ($scriptFile in (Get-ChildItem -LiteralPath (Join-Path $root 'scripts\judge-package') -Filter '*.ps1' -File)) {
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($scriptFile.FullName, [ref]$tokens, [ref]$parseErrors) | Out-Null
  if ($parseErrors.Count -gt 0) {
    throw "PowerShell 语法检查失败：$($scriptFile.Name) 第 $($parseErrors[0].Extent.StartLineNumber) 行 $($parseErrors[0].Message)"
  }
}

foreach ($jsonFile in @('datasets\compiler-cases.json')) {
  Get-Content -LiteralPath (Join-Path $root $jsonFile) -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
}
foreach ($jsonlFile in @('datasets\knowledge-408.jsonl', 'datasets\multi-agent-evaluation.jsonl')) {
  $lineNumber = 0
  foreach ($line in (Get-Content -LiteralPath (Join-Path $root $jsonlFile) -Encoding UTF8)) {
    $lineNumber++
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try { $line | ConvertFrom-Json | Out-Null } catch { throw "$jsonlFile 第 $lineNumber 行不是有效 JSON。" }
  }
}

$textExtensions = @('.env', '.js', '.json', '.jsonl', '.md', '.yml', '.yaml', '.ps1', '.bat', '.sh', '.sql', '.txt')
$secretPatterns = @(
  '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
  '\bLTAI[A-Za-z0-9]{12,}\b',
  '\bsk-[A-Za-z0-9_-]{20,}\b'
)
foreach ($file in (Get-ChildItem -LiteralPath $root -Recurse -Force -File |
  Where-Object { $textExtensions -contains $_.Extension.ToLowerInvariant() })) {
  $content = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
  foreach ($pattern in $secretPatterns) {
    if ($content -match $pattern) {
      throw "评委包疑似包含密钥或私钥：$($file.FullName)"
    }
  }
}

Write-Host '[验证通过] 源码、数据集、模型配置、脚本、空存储目录和脱敏规则均符合要求。' -ForegroundColor Green
