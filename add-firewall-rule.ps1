# LibreTV 局域网投屏辅助脚本：放行 TCP 8080 入站（需管理员权限运行）
# 用途：让局域网内的电视（DLNA 接收端）能访问本机 8080 端口拉流。
# 以管理员身份运行：powershell -ExecutionPolicy Bypass -File add-firewall-rule.ps1
$ErrorActionPreference = 'Stop'
$ruleName = 'LibreTV LAN Cast (TCP 8080)'
$resultFile = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'firewall-result.txt'
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($null -ne $existing) {
  'EXISTS' | Out-File -FilePath $resultFile -Encoding ascii
  exit 0
}
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Any -ErrorAction Stop | Out-Null
'CREATED' | Out-File -FilePath $resultFile -Encoding ascii
