/**
 * 投屏会话与设备发现缓存（内存实现，单实例本地部署足够）。
 *
 * - 会话：sid 令牌绑定一个点播地址与一台设备，电视凭 sid 拉流（不依赖 cookie）；
 * - 设备缓存：建会前校验 deviceId 确实来自最近的 SSDP 发现，防止遥控地址被任意指定（SSRF）。
 */

import crypto from 'node:crypto';
import dgram from 'node:dgram';
import os from 'node:os';
import type { CastDevice } from './types';

/** 会话有效期：一次投屏最长 24h，超时自动作废 */
export const CAST_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** 设备发现缓存有效期：15 分钟内有效，避免拿旧地址遥控已离线的设备 */
export const DEVICE_CACHE_TTL_MS = 15 * 60 * 1000;

export interface CastSession {
  sid: string;
  /** 绑定的上游播放地址（点播直链 / m3u8） */
  upstreamUrl: string;
  /** 投屏目标设备（含 SOAP 控制地址） */
  device: CastDevice;
  createdAt: number;
  expiresAt: number;
}

const sessions = new Map<string, CastSession>();
const devices = new Map<string, { device: CastDevice; discoveredAt: number }>();

/** 记录最近一次发现结果（覆盖式更新，顺带清理过期条目） */
export function rememberDevices(list: CastDevice[]): void {
  const now = Date.now();
  for (const d of list) devices.set(d.id, { device: d, discoveredAt: now });
  for (const [k, v] of devices) {
    if (now - v.discoveredAt > DEVICE_CACHE_TTL_MS) devices.delete(k);
  }
}

/** 按 deviceId（=AVTransport 控制地址）取最近发现的设备 */
export function getDiscoveredDevice(deviceId: string): CastDevice | undefined {
  const entry = devices.get(deviceId);
  if (!entry) return undefined;
  if (Date.now() - entry.discoveredAt > DEVICE_CACHE_TTL_MS) {
    devices.delete(deviceId);
    return undefined;
  }
  return entry.device;
}

export function createCastSession(upstreamUrl: string, device: CastDevice): CastSession {
  const sid = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const session: CastSession = {
    sid,
    upstreamUrl,
    device,
    createdAt: now,
    expiresAt: now + CAST_SESSION_TTL_MS,
  };
  sessions.set(sid, session);
  return session;
}

export function getCastSession(sid: string | null | undefined): CastSession | undefined {
  if (!sid) return undefined;
  const s = sessions.get(sid);
  if (!s) return undefined;
  if (Date.now() > s.expiresAt) {
    sessions.delete(sid);
    return undefined;
  }
  return s;
}

export function deleteCastSession(sid: string): void {
  sessions.delete(sid);
}

// 定期清理过期会话，防止长期运行下 Map 膨胀
if (typeof setInterval === 'function') {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, s] of sessions) if (now > s.expiresAt) sessions.delete(k);
  }, 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
}

// —— 局域网基址探测：电视拉流地址必须用 PC 的局域网 IP（localhost 对电视不可达） ——

let lanBaseUrlCache: string | null = null;

/** 探测本机局域网 IPv4（默认路由接口：UDP 连公网地址，内核自动选出网接口） */
function detectLanIPv4(): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      const sock = dgram.createSocket('udp4');
      let settled = false;
      const finish = (ip?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        try {
          sock.close();
        } catch {
          /* 忽略 */
        }
        resolve(ip);
      };
      // 兜底：异常情况下 2s 内未连上则不阻塞
      const guard = setTimeout(() => finish(undefined), 2000);
      sock.once('connect', () => {
        let ip: string | undefined;
        try {
          ip = sock.address().address;
        } catch {
          ip = undefined;
        }
        finish(ip);
      });
      sock.once('error', () => finish(undefined));
      sock.connect(1900, '8.8.8.8');
    } catch {
      resolve(undefined);
    }
  });
}

/** 枚举兜底：取第一个非回环 IPv4（排除链路本地） */
function enumLanIPv4(): string | undefined {
  try {
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
          return a.address;
        }
      }
    }
  } catch {
    /* 忽略 */
  }
  return undefined;
}

/**
 * 电视可访问的本站基址，如 http://192.168.1.125:8080。
 * 优先级：环境变量 CAST_BASE_URL > 默认路由接口探测 > 接口枚举 > 回环兜底。
 */
export async function getLanBaseUrl(): Promise<string> {
  if (lanBaseUrlCache) return lanBaseUrlCache;
  const fromEnv = process.env.CAST_BASE_URL;
  if (fromEnv) {
    lanBaseUrlCache = fromEnv.replace(/\/+$/, '');
    return lanBaseUrlCache;
  }
  const port = process.env.PORT || '8080';
  const ip = (await detectLanIPv4()) || enumLanIPv4();
  lanBaseUrlCache = ip ? `http://${ip}:${port}` : `http://127.0.0.1:${port}`;
  return lanBaseUrlCache;
}
