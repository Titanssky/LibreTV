import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { discoverRenderers } from '@/lib/cast/upnp';
import { rememberDevices } from '@/lib/cast/session';

export const runtime = 'nodejs';

/**
 * 发现局域网内 DLNA 媒体接收端（电视）。
 * 结果同时写入会话模块的设备缓存，供建会时校验 deviceId 确实来自发现。
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const devices = await discoverRenderers();
  rememberDevices(devices);
  return NextResponse.json({ devices });
}
