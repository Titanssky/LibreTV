/**
 * DLNA/UPnP 协议最小实现：SSDP 设备发现 + AVTransport SOAP 遥控。
 *
 * 不引入第三方依赖：SSDP 用 node:dgram 组播，设备描述用轻量正则解析
 * （UPnP 描述 XML 结构固定、无命名空间歧义，足够可靠），SOAP 用标准 POST。
 */

import dgram from 'node:dgram';
import type { CastDevice } from './types';

const SSDP_HOST = '239.255.255.250';
const SSDP_PORT = 1900;
const SOAP_SERVICE = 'urn:schemas-upnp-org:service:AVTransport:1';
const UA =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** SSDP 单次 M-SEARCH 报文 */
function mSearchPacket(st: string): Buffer {
  return Buffer.from(
    [
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_HOST}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      'MX: 2',
      `ST: ${st}`,
      `USER-AGENT: ${UA}`,
      '',
      '',
    ].join('\r\n')
  );
}

interface SsdpResponse {
  location: string;
  usn?: string;
  st?: string;
}

/** 解析 SSDP 响应报文，非法/缺失 LOCATION 返回 null（导出供单测） */
export function parseSsdpResponse(buf: Buffer): SsdpResponse | null {
  const text = buf.toString('utf8');
  if (!text.startsWith('HTTP/1.1 200 OK')) return null;
  const headers: Record<string, string> = {};
  for (const line of text.split('\r\n').slice(1)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  if (!headers.location) return null;
  return { location: headers.location, usn: headers.usn, st: headers.st };
}

/** 提取 XML 首个同名标签的内层内容（不区分大小写、容忍属性） */
function extractFirst(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m?.[1]?.trim();
}

/** 提取 <service> 块列表中的 serviceType / controlURL（导出供单测） */
export function extractServices(
  xml: string
): { serviceType?: string; controlUrl?: string }[] {
  const out: { serviceType?: string; controlUrl?: string }[] = [];
  const re = /<service>([\s\S]*?)<\/service>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    out.push({
      serviceType: extractFirst(block, 'serviceType'),
      controlUrl: extractFirst(block, 'controlURL'),
    });
  }
  return out;
}

/**
 * 拉取设备描述文档，提取 friendlyName 与 AVTransport 控制地址。
 * 只有提供 AVTransport 服务的设备才可作为投屏接收端。
 */
async function fetchDeviceDescription(
  locationUrl: string
): Promise<Pick<CastDevice, 'name' | 'udn' | 'modelName'> & { controlUrl?: string } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    let res: Response;
    try {
      res = await fetch(locationUrl, {
        headers: { 'User-Agent': UA, Accept: 'text/xml' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const xml = await res.text();
    const name = extractFirst(xml, 'friendlyName');
    if (!name) return null;
    const av = extractServices(xml).find((s) => s.serviceType?.includes('AVTransport'));
    let controlUrl = av?.controlUrl?.trim();
    if (controlUrl) {
      try {
        controlUrl = new URL(controlUrl, locationUrl).href;
      } catch {
        controlUrl = undefined;
      }
    }
    if (!controlUrl) return null;
    return {
      name,
      udn: extractFirst(xml, 'UDN'),
      modelName: extractFirst(xml, 'modelName'),
      controlUrl,
    };
  } catch {
    return null;
  }
}

/**
 * 局域网 SSDP 发现媒体接收端（MediaRenderer 或任意携带 AVTransport 的设备）。
 * 返回按 controlUrl 去重后的设备列表；发现缓存由会话模块维护。
 */
export async function discoverRenderers(timeoutMs = 3500): Promise<CastDevice[]> {
  const found = new Map<string, SsdpResponse>();
  const socket = dgram.createSocket('udp4');
  socket.on('message', (msg) => {
    const r = parseSsdpResponse(msg);
    if (r && !found.has(r.location)) found.set(r.location, r);
  });
  socket.on('error', () => {
    /* 组播错误不致命，等待超时收口 */
  });

  await new Promise<void>((resolve) => {
    socket.bind(0, () => {
      try {
        socket.setMulticastTTL(2);
      } catch {
        /* 部分平台不支持设置 TTL，忽略 */
      }
      // ssdp:all 覆盖任意应答；再补一个 MediaRenderer 精确 ST，兼容只按需应答的设备
      for (const st of ['ssdp:all', 'urn:schemas-upnp-org:device:MediaRenderer:1']) {
        try {
          socket.send(mSearchPacket(st), SSDP_PORT, SSDP_HOST);
        } catch {
          /* 忽略单次发送失败 */
        }
      }
      resolve();
    });
  });

  // 等待收集响应（MX:2 的设备应在 2s 内应答，多留余量）
  await new Promise((r) => setTimeout(r, timeoutMs));
  try {
    socket.close();
  } catch {
    /* 忽略 */
  }

  const locations = [...found.keys()].slice(0, 30);
  const devices = await Promise.all(
    locations.map(async (location): Promise<CastDevice | null> => {
      const desc = await fetchDeviceDescription(location);
      if (!desc?.controlUrl) return null;
      return {
        id: desc.controlUrl,
        name: desc.name,
        udn: desc.udn,
        locationUrl: location,
        controlUrl: desc.controlUrl,
        modelName: desc.modelName,
      };
    })
  );
  return devices.filter((d): d is CastDevice => d !== null);
}

// —— AVTransport SOAP 遥控 ——

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface SoapResult {
  ok: boolean;
  error?: string;
}

/** 构造 AVTransport SOAP 请求体（导出供单测） */
export function buildSoapEnvelope(action: string, args: Record<string, string>): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    '  <s:Body>',
    `    <u:${action} xmlns:u="${SOAP_SERVICE}">`,
    '      <InstanceID>0</InstanceID>',
    ...Object.entries(args).map(([k, v]) => `      <${k}>${escapeXml(v)}</${k}>`),
    `    </u:${action}>`,
    '  </s:Body>',
    '</s:Envelope>',
  ].join('\n');
}

/** 向设备 AVTransport 服务发送一次 SOAP 动作 */
export async function sendSoapAction(
  controlUrl: string,
  action: string,
  args: Record<string, string>
): Promise<SoapResult> {
  const body = buildSoapEnvelope(action, args);
  try {
    const res = await fetch(controlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPAction: `"${SOAP_SERVICE}#${action}"`,
        'User-Agent': UA,
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    if (!res.ok) {
      const fault = text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)?.[1]?.trim();
      return { ok: false, error: fault || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '设备无响应' };
  }
}

/** 告知电视拉取并播放指定 URL */
export function setAvTransportUri(controlUrl: string, uri: string): Promise<SoapResult> {
  return sendSoapAction(controlUrl, 'SetAVTransportURI', {
    CurrentURI: uri,
    CurrentURIMetaData: '',
  });
}

export function playOnDevice(controlUrl: string): Promise<SoapResult> {
  return sendSoapAction(controlUrl, 'Play', { Speed: '1' });
}

export function pauseDevice(controlUrl: string): Promise<SoapResult> {
  return sendSoapAction(controlUrl, 'Pause', {});
}

export function stopDevice(controlUrl: string): Promise<SoapResult> {
  return sendSoapAction(controlUrl, 'Stop', {});
}
