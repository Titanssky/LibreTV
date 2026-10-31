import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { pauseDevice, playOnDevice, setAvTransportUri, stopDevice } from '@/lib/cast/upnp';
import {
  createCastSession,
  deleteCastSession,
  getCastSession,
  getLanBaseUrl,
} from '@/lib/cast/session';
import type { CastAction } from '@/lib/cast/types';

export const runtime = 'nodejs';

const ACTIONS: CastAction[] = ['play', 'pause', 'stop', 'setUri'];

/**
 * 投屏遥控：play / pause / stop / setUri（切集）。
 * setUri 会为新地址签发新 sid 并作废旧 sid（保持一 sid 绑一地址的约束）。
 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let body: { sid?: unknown; action?: unknown; url?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('无效的请求体', 400);
  }
  const { sid, action, url } = body;
  if (
    typeof sid !== 'string' ||
    !sid ||
    typeof action !== 'string' ||
    !ACTIONS.includes(action as CastAction)
  ) {
    return jsonError('缺少 sid 或无效的 action', 400);
  }

  const session = getCastSession(sid);
  if (!session) return jsonError('投屏会话不存在或已过期', 403);

  switch (action as CastAction) {
    case 'play': {
      const r = await playOnDevice(session.device.controlUrl);
      return r.ok ? NextResponse.json({ ok: true }) : jsonError(`遥控失败：${r.error}`, 502);
    }
    case 'pause': {
      const r = await pauseDevice(session.device.controlUrl);
      return r.ok ? NextResponse.json({ ok: true }) : jsonError(`遥控失败：${r.error}`, 502);
    }
    case 'stop': {
      const r = await stopDevice(session.device.controlUrl);
      deleteCastSession(session.sid);
      return r.ok ? NextResponse.json({ ok: true }) : jsonError(`停止失败：${r.error}`, 502);
    }
    case 'setUri': {
      if (typeof url !== 'string' || !url) return jsonError('缺少 url', 400);
      const verdict = await checkUpstreamAllowed(url);
      if (!verdict.ok) return jsonError(verdict.reason, 403);

      const next = createCastSession(url, session.device);
      const base = await getLanBaseUrl();
      const castUrl = `${base}/api/cast/stream?sid=${encodeURIComponent(next.sid)}&url=${encodeURIComponent(url)}`;

      const uriResult = await setAvTransportUri(session.device.controlUrl, castUrl);
      if (!uriResult.ok) {
        deleteCastSession(next.sid);
        return jsonError(`切换失败：${uriResult.error || '未知错误'}`, 502);
      }
      const playResult = await playOnDevice(session.device.controlUrl);
      if (!playResult.ok) {
        deleteCastSession(next.sid);
        return jsonError(`切换失败：${playResult.error || '未知错误'}`, 502);
      }
      // 旧会话作废：避免 sid 无限堆积，也保证新地址只能用新 sid 拉取
      deleteCastSession(session.sid);
      return NextResponse.json({ ok: true, sid: next.sid, castUrl, deviceName: session.device.name });
    }
  }
}
