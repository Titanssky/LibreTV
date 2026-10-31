import { describe, expect, it } from 'vitest';
import {
  createCastSession,
  deleteCastSession,
  getCastSession,
  getDiscoveredDevice,
  rememberDevices,
} from './session';
import type { CastDevice } from './types';

const device: CastDevice = {
  id: 'http://tv.local:49152/upnp/control/AVTransport1',
  name: 'HUAWEI VISION',
  udn: 'uuid:test-device',
  locationUrl: 'http://tv.local:49152/desc.xml',
  controlUrl: 'http://tv.local:49152/upnp/control/AVTransport1',
};

describe('投屏会话', () => {
  it('创建 / 读取 / 删除', () => {
    const s = createCastSession('https://cdn.example.com/video/master.m3u8', device);
    expect(getCastSession(s.sid)?.upstreamUrl).toBe('https://cdn.example.com/video/master.m3u8');
    expect(getCastSession(s.sid)?.device.name).toBe('HUAWEI VISION');
    deleteCastSession(s.sid);
    expect(getCastSession(s.sid)).toBeUndefined();
  });

  it('过期会话自动作废', () => {
    const s = createCastSession('https://x.example.com/1.m3u8', device);
    s.expiresAt = Date.now() - 1;
    expect(getCastSession(s.sid)).toBeUndefined();
  });

  it('无效 sid 返回 undefined', () => {
    expect(getCastSession(null)).toBeUndefined();
    expect(getCastSession('')).toBeUndefined();
    expect(getCastSession('not-a-sid')).toBeUndefined();
  });
});

describe('设备发现缓存', () => {
  it('未记住不可取；记住后可取', () => {
    expect(getDiscoveredDevice(device.id)).toBeUndefined();
    rememberDevices([device]);
    expect(getDiscoveredDevice(device.id)?.name).toBe('HUAWEI VISION');
    expect(getDiscoveredDevice('http://other/control')).toBeUndefined();
  });
});
