# LibreTV 局域网投屏（DLNA）使用说明

本地定制功能：把正在观看的点播影片投屏到局域网内的电视（DLNA 接收端，如华为智慧屏，无需在电视上安装任何应用）。

## 使用步骤

1. 电脑与电视连接到**同一局域网**（同一路由器 / 同一 Wi-Fi）。
2. 电视开机，保持默认投屏开关开启（华为智慧屏：设置 > 网络与联接 > 投屏）。
3. 在 LibreTV 播放页（`/watch`）右上角点击「投屏」按钮，等待扫描（约 3 秒）。
4. 在设备列表中选择你的电视（如 HUAWEI VISION），电视开始播放当前影片。
5. 面板内可暂停 / 继续 / 停止；在电脑上切换集数会自动同步到电视。

## 工作原理

- 通用 DLNA/UPnP 方案：服务端 SSDP 发现设备 → 向电视的 AVTransport 服务发
  SetAVTransportURI + Play，电视**主动**从电脑拉流，无需第三方投屏 App。
- 电视拉流走专用接口 `/api/cast/stream?sid=…`：sid 是随机一次性令牌（代替
  cookie，因为电视不带浏览器 Cookie），24 小时自动作废。
- m3u8 清单被重写为「绝对局域网地址 + sid」，电视免登录直拉分片；直链 mp4 透传并支持 Range（拖动进度）。

## 安全设计

- 发现 / 建会 / 遥控接口均要求站内登录（同现有鉴权），外人无法遥控你的电视。
- 建会只接受「最近 SSDP 发现列表」中的设备，遥控地址不可任意指定（防 SSRF）。
- 拉流上游仍走与 `/api/proxy` 相同的 SSRF 防护（仅公网 http/https）。

## 网络要求

- 服务需可从局域网访问：已添加防火墙入站规则「LibreTV LAN Cast (TCP 8080)」
  （TCP 8080，所有网络配置文件）。若更换机器或重装系统，以管理员身份运行
  `add-firewall-rule.ps1` 重新添加。
- 电视拉流地址使用电脑的局域网 IP（自动探测默认路由接口）。若自动探测的地址
  不对（例如多网卡），可在 `.env` 中设置 `CAST_BASE_URL=http://<你的局域网IP>:8080` 覆盖。

## 已知限制

- **仅点播支持投屏**；直播页暂未接入。
- 部分电视型号的 DLNA 对 HLS（m3u8）兼容性依赖固件；若电视无法播放，可换用
  提供 mp4 直链的视频源再投。后续可加 ffmpeg 转 TS 兜底（本机当前未安装 ffmpeg）。
- 少数校验 Referer 的防盗链源可能投屏失败（源站限制），失败时换源即可。

## 修改的文件

新增：
- `src/lib/cast/types.ts`（类型）
- `src/lib/cast/upnp.ts`（SSDP 发现 + SOAP 遥控）
- `src/lib/cast/session.ts`（会话 / 设备缓存 / 局域网地址探测）
- `src/lib/cast/stream.ts`（电视专用拉流，m3u8 重写为绝对地址）
- `src/app/api/cast/{discover,session,control,stream}/route.ts`
- `src/components/cast-panel.tsx`（播放页投屏面板）
- `src/lib/cast/{upnp,session,stream}.test.ts`（单测）

修改：
- `src/app/watch/page.tsx`（头部加投屏按钮）
- `src/lib/client-api.ts`（投屏 API 封装）
