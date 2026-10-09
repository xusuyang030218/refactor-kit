# RefactorKit 安装入口（05 文档 入口 ①）
# 用法：pwsh scripts/install.ps1 [-Profile desktop] [-Yes]
# 先打印将执行的命令；不带 -Yes 时需要确认。安装后在 DSH 中输入 /refactorkit 开始。
param(
  [string]$Profile = $(if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }),
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path -replace '\\', '/'
$spec = "dsh-plugin-refactorkit@link:$repo"

$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if ($dsh) { $runner = @('dsh') }
else {
  $candidates = @(
    "$env:LOCALAPPDATA\Programs\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js",
    'D:\Users\23074\AppData\Local\Programs\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js'
  )
  $bin = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $bin) { throw '找不到 dsh CLI。请把 dsh 加入 PATH，或在 DSH 插件管理页用 install_bundle 安装本目录。' }
  $runner = @('node', $bin)
}

Write-Host "将执行：$($runner -join ' ') plugin --profile $Profile add `"$spec`""
Write-Host '注意：这会修改该 profile 的 package.json；新插件通常需要重启 DSH 后生效。'
if (-not $Yes) {
  $ok = Read-Host '确认安装？(y/N)'
  if ($ok -notin @('y', 'Y', 'yes')) { Write-Host '已取消。'; exit 0 }
}
Push-Location $repo
try {
  if (-not (Test-Path (Join-Path $repo 'node_modules\yaml'))) { npm install --no-audit --no-fund --loglevel=error }
  & $runner[0] @($runner | Select-Object -Skip 1) plugin --profile $Profile add $spec
  if ($LASTEXITCODE -ne 0) { throw "安装失败（exit $LASTEXITCODE）" }
  Write-Host '安装完成。重启 DSH 后，在任意项目会话中输入 /refactorkit。'
} finally { Pop-Location }
