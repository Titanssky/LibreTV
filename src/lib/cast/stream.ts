/**
 * 电视专用拉流口（/api/cast/stream）：
 *
 * 与 /api/proxy 的区别：
 * - 鉴权用 sid 令牌（DLNA 设备拉流不带浏览器 cookie，不能走 cookie 会话）；
 * - m3u8 清单重写为「绝对局域网地址 + sid」，电视无需 cookie 即可拉取分片；
 * - 按直播长连接语义处理（仅头等待限时、body 不限时、客户端断开即终止），
 *   否则 8 秒总超时会把电视端的整片 mp4 / 长流掐断；
 * - 支持 Range（电视拖动进度条用）。
 */

import { NextResponse } from 'next/server';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { fetchWithSafeRedirects } from '@/lib/fetch-utils';
import { rewriteM3u8 } from '@/lib/m3u8';
import { getCastSession, getLanBaseUrl } from './session';

const HEADER_TIMEOUT_MS = 15_000;
const UA =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** m3u8 重写基座：绝对局域网地址 + sid（电视按此地址拉取清单/分片/key） */
export function buildCastPrefix(sid: string, baseUrl: string): string {
  return `${baseUrl}/api/cast/stream?sid=${encodeURIComponent(sid)}&url=`;
}

export async function handleCastStreamRequest(
  req: Request,
  sid: string,
  targetUrl: string
): Promise<Response> {
  const session = getCastSession(sid);
  if (!session) {
    return new NextResponse('投屏会话不存在或已过期', { status: 403 });
  }

  const verdict = await checkUpstreamAllowed(targetUrl);
  if (!verdict.ok) {
    return new NextResponse(verdict.reason, { status: 403 });
  }

  const controller = new AbortController();
  const onClientAbort = () => controller.abort();
  req.signal.addEventListener('abort', onClientAbort, { once: true });

  const headers: Record<string, string> = { 'User-Agent': UA, Accept: '*/*' };
  const range = req.headers.get('range');
  if (range) headers.Range = range;

  let response: Response;
  let finalUrl: string;
  try {
    const result = await fetchWithSafeRedirects(
      targetUrl,
      { headers, signal: controller.signal },
      { headerTimeoutMs: HEADER_TIMEOUT_MS }
    );
    response = result.res;
    finalUrl = result.finalUrl;
  } catch (err) {
    return new NextResponse(
      `拉流失败: ${err instanceof Error ? err.message : '未知错误'}`,
      { status: 502 }
    );
  }

  if (!response.ok && response.body) {
    try {
      await response.body.cancel();
    } catch {
      /* 忽略 */
    }
    return new NextResponse(`上游返回 ${response.status}`, { status: response.status });
  }

  const contentType = response.headers.get('content-type') || '';
  const isM3u8 =
    contentType.includes('mpegurl') ||
    targetUrl.toLowerCase().split('?')[0].endsWith('.m3u8');

  // HLS 清单：重写为「绝对局域网地址 + sid」的分片地址，电视免 cookie 直拉
  if (isM3u8) {
    const text = await response.text();
    const base = await getLanBaseUrl();
    const rewritten = rewriteM3u8(text, finalUrl, 0, buildCastPrefix(sid, base));
    return new NextResponse(rewritten, {
      status: response.status,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
      },
    });
  }

  // mp4 / ts / flv 等：流式透传，保留 Range 相关头（电视 seek 依赖）
  const outHeaders = new Headers();
  for (const name of ['content-type', 'accept-ranges', 'content-range', 'etag', 'last-modified']) {
    const v = response.headers.get(name);
    if (v) outHeaders.set(name, v);
  }
  if (!outHeaders.has('content-type')) outHeaders.set('Content-Type', contentType || 'video/mp2t');
  if (!outHeaders.has('accept-ranges')) outHeaders.set('Accept-Ranges', 'bytes');
  outHeaders.set('Cache-Control', 'no-store, no-transform');

  return new NextResponse(response.body, {
    status: response.status,
    headers: outHeaders,
  });
}
