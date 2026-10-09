# RefactorKit 安装入口（05 文档 入口 ①）
# 用法：pwsh scripts/install.ps1 [-Profile desktop] [-Yes]
#
# DSH Desktop 的 profile 由 Electron 应用独占管理（CLI 会拒绝改动），这种情况下本脚本只打印界面安装步骤；
# 其他 profile（web / tui / headless 或自建 profile）用 dsh CLI 安装。
param(
  [string]$Profile = $(if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }),
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoFwd = $repo -replace '\\', '/'
$spec = "dsh-plugin-refactorkit@link:$repoFwd"

# 依赖（唯一：yaml）必须在插件目录本地就绪：link 安装不会替插件装依赖
if (-not (Test-Path (Join-Path $repo 'node_modules\yaml'))) {
  Push-Location $repo
  try { npm install --no-audit --no-fund --loglevel=error } finally { Pop-Location }
}

if ($Profile -eq 'desktop') {
  Write-Host ''
  Write-Host 'desktop profile 由 DSH Desktop 应用管理，请在 DSH 窗口中安装（约 30 秒）：' -ForegroundColor Cyan
  Write-Host '  1. 左侧栏点「插件」'
  Write-Host '  2. 点「添加插件」，粘贴下面这个路径，回车：'
  Write-Host "       $repo" -ForegroundColor Yellow
  Write-Host '  3. 预览显示 dsh-plugin-refactorkit（RefactorKit 重构工具箱）后确认安装'
  Write-Host '  4. 新开一个会话（工作目录选新系统仓库），输入 /refactorkit'
  Write-Host ''
  Write-Host '回滚：插件页 → RefactorKit → 卸载。详见 docs/07-安装与使用.md'
  exit 0
}

$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if ($dsh) { $runner = @('dsh') }
else {
  $bin = @("$env:LOCALAPPDATA\Programs\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js",
           'D:\Users\23074\AppData\Local\Programs\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js') |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $bin) { throw '找不到 dsh CLI。请在 DSH 插件页用「添加插件」安装本目录。' }
  $runner = @('node', $bin)
}
Write-Host "将执行：$($runner -join ' ') plugin --profile $Profile add `"$spec`""
if (-not $Yes) {
  $ok = Read-Host '确认安装？(y/N)'
  if ($ok -notin @('y', 'Y', 'yes')) { Write-Host '已取消。'; exit 0 }
}
& $runner[0] @($runner | Select-Object -Skip 1) plugin --profile $Profile add $spec
if ($LASTEXITCODE -ne 0) { throw "安装失败（exit $LASTEXITCODE）" }
Write-Host '安装完成。新开会话，输入 /refactorkit。'
