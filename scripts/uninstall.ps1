# RefactorKit 卸载：powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1 [-Profile desktop]
param([string]$Profile = $(if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }))
$ErrorActionPreference = 'Stop'
$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if ($dsh) { $runner = @('dsh') }
else {
  $bin = @("$env:LOCALAPPDATA\Programs\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js",
           'D:\Users\23074\AppData\Local\Programs\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js') |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $bin) { throw '找不到 dsh CLI。' }
  $runner = @('node', $bin)
}
& $runner[0] @($runner | Select-Object -Skip 1) plugin --profile $Profile remove dsh-plugin-refactorkit
Write-Host '已卸载。项目中的 refactorkit.yaml 与 .refactorkit/ 保留，可手动删除。'
