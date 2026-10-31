import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { playOnDevice, setAvTransportUri } from '@/lib/cast/upnp';
import {
  createCastSession,
  deleteCastSession,
  getDiscoveredDevice,
  getLanBaseUrl,
} from '@/lib/cast/session';

export const runtime = 'nodejs';

/**
 * 建立投屏会话并推流到电视：
 * 1. 校验上游地址（SSRF 防护，与 /api/proxy 同一把尺子）；
 * 2. 校验设备来自最近一次 SSDP 发现；
 * 3. 生成 sid 令牌与电视可拉的绝对地址；
 * 4. 向电视 AVTransport 发 SetAVTransportURI + Play，电视开始主动拉流。
 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let body: { url?: unknown; deviceId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('无效的请求体', 400);
  }
  const { url, deviceId } = body;
  if (typeof url !== 'string' || !url || typeof deviceId !== 'string' || !deviceId) {
    return jsonError('缺少 url 或 deviceId', 400);
  }

  const verdict = await checkUpstreamAllowed(url);
  if (!verdict.ok) return jsonError(verdict.reason, 403);

  const device = getDiscoveredDevice(deviceId);
  if (!device) return jsonError('设备不在最近发现列表中，请先重新扫描', 400);

  const session = createCastSession(url, device);
  const base = await getLanBaseUrl();
  const castUrl = `${base}/api/cast/stream?sid=${encodeURIComponent(session.sid)}&url=${encodeURIComponent(url)}`;

  const uriResult = await setAvTransportUri(device.controlUrl, castUrl);
  if (!uriResult.ok) {
    deleteCastSession(session.sid);
    return jsonError(`无法通知电视播放：${uriResult.error || '未知错误'}`, 502);
  }
  const playResult = await playOnDevice(device.controlUrl);
  if (!playResult.ok) {
    deleteCastSession(session.sid);
    return jsonError(`电视未能开始播放：${playResult.error || '未知错误'}`, 502);
  }

  return NextResponse.json({ sid: session.sid, castUrl, deviceName: device.name });
}
