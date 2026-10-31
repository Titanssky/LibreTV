import { NextResponse } from 'next/server';
import { handleCastStreamRequest } from '@/lib/cast/stream';

export const runtime = 'nodejs';

/**
 * 电视专用拉流口（DLNA 设备直接访问，不带浏览器 cookie，以 sid 令牌鉴权）。
 * 电视先访问本接口拿到重写后的 m3u8，再按绝对局域网地址 + sid 拉取分片。
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const sid = sp.get('sid') || '';
  const targetUrl = sp.get('url') || '';
  if (!sid || !targetUrl) {
    return new NextResponse('缺少 sid 或 url 参数', { status: 400 });
  }
  return handleCastStreamRequest(req, sid, targetUrl);
}
