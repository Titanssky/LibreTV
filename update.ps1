param(
  [string]$Target = ''
)
# ============================================================
# LibreTV 局域网投屏 增量更新脚本
# 把本更新包内的 cast 投屏功能文件合并进目标 LibreTV 项目。
# 用法（在目标电脑上，PowerShell 窗口）：
#   .\update.ps1 -Target D:\LibreTV\LibreTV-main
# 说明：
#   - 不改动 .env（保留目标机器自己的密码/源配置）
#   - 被覆盖的 watch/page.tsx 与 client-api.ts 会先备份
#   - 新增文件为纯增量，不触碰其它文件
# ============================================================
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$filesDir = Join-Path $here 'files'

if (-not $Target) {
  Write-Host ''
  Write-Host '用法: .\update.ps1 -Target <LibreTV项目目录>'
  Write-Host '示例: .\update.ps1 -Target D:\LibreTV\LibreTV-main'
  exit 1
}
$Target = $Target.TrimEnd('\')
if (-not (Test-Path -LiteralPath $Target)) { Write-Host "错误：目标目录不存在 -> $Target"; exit 1 }
if (-not (Test-Path -LiteralPath (Join-Path $Target 'package.json'))) {
  Write-Host '错误：目标目录不是 LibreTV 项目（未找到 package.json）'; exit 1
}

# 1) 版本提示
$pkg = Get-Content -LiteralPath (Join-Path $Target 'package.json') -Raw | ConvertFrom-Json
Write-Host ("目标项目版本: {0}（更新包基于 2.21.0 修改；大版本不一致时请谨慎）" -f $pkg.version)

# 2) 备份将被覆盖的现有文件
# 注意：备份目录必须放在项目根目录【外】（同级目录），否则会被 tsconfig 的
# **/*.ts 全量包含，导致 tsc / next build 因备份文件的相对导入失效而失败。
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$leaf = Split-Path -Leaf $Target
$parent = Split-Path -Parent $Target
$bakDir = Join-Path $parent "$leaf-cast-update-backup-$ts"
New-Item -ItemType Directory -Path $bakDir | Out-Null
foreach ($rel in @('src\app\watch\page.tsx', 'src\lib\client-api.ts')) {
  $old = Join-Path $Target $rel
  if (Test-Path -LiteralPath $old) {
    $dstDir = Join-Path $bakDir (Split-Path -Parent $rel)
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    Copy-Item -LiteralPath $old -Destination (Join-Path $dstDir (Split-Path -Leaf $rel)) -Force
  }
}
Write-Host "已备份被覆盖文件 -> $bakDir"

# 3) 复制更新文件（新增 + 覆盖）
$count = 0
Get-ChildItem -LiteralPath $filesDir -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($filesDir.Length + 1)
  $dst = Join-Path $Target $rel
  New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force | Out-Null
  Copy-Item -LiteralPath $_.FullName -Destination $dst -Force
  $count++
}
Write-Host "已写入 $count 个文件（新增 cast 模块 + 更新播放页/API 封装）"

# 4) 防火墙脚本一并带过去（后续以管理员运行）
Copy-Item -LiteralPath (Join-Path $here 'add-firewall-rule.ps1') -Destination (Join-Path $Target 'add-firewall-rule.ps1') -Force
Write-Host '已将 add-firewall-rule.ps1 复制到项目根目录'

Write-Host ''
Write-Host '下一步（在目标电脑上）：'
Write-Host '  1. cd 到目标项目目录'
Write-Host '  2. npm run build'
Write-Host '  3. 停止旧服务后 npm start（服务在 8080 端口）'
Write-Host '  4. 管理员身份运行 add-firewall-rule.ps1，放行局域网 8080'
Write-Host '  5. 浏览器打开播放页，点右上角「投屏」'
Write-Host '注意：本次更新未新增任何 npm 依赖，无需 npm install。'
