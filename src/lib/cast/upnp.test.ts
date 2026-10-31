import { describe, expect, it } from 'vitest';
import { buildSoapEnvelope, extractServices, parseSsdpResponse } from './upnp';

describe('parseSsdpResponse', () => {
  it('解析合法 SSDP 响应', () => {
    const buf = Buffer.from(
      [
        'HTTP/1.1 200 OK',
        'CACHE-CONTROL: max-age=1800',
        'LOCATION: http://192.168.1.50:49152/description.xml',
        'SERVER: Linux/4.4 UPnP/1.0',
        'USN: uuid:abc123::urn:schemas-upnp-org:device:MediaRenderer:1',
        'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
        '',
      ].join('\r\n')
    );
    const r = parseSsdpResponse(buf);
    expect(r).not.toBeNull();
    expect(r?.location).toBe('http://192.168.1.50:49152/description.xml');
    expect(r?.usn).toContain('abc123');
  });

  it('非 200 或缺失 LOCATION 返回 null', () => {
    expect(parseSsdpResponse(Buffer.from('NOTIFY * HTTP/1.1\r\nLOCATION: x\r\n'))).toBeNull();
    expect(parseSsdpResponse(Buffer.from('HTTP/1.1 200 OK\r\nSERVER: x\r\n'))).toBeNull();
    expect(parseSsdpResponse(Buffer.from('garbage'))).toBeNull();
  });
});

describe('extractServices', () => {
  const xml = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <friendlyName>HUAWEI VISION</friendlyName>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType>
        <controlURL>/upnp/control/ConnectionManager1</controlURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <controlURL>/upnp/control/AVTransport1</controlURL>
      </service>
    </serviceList>
  </device>
</root>`;

  it('找到 AVTransport 服务及其控制地址', () => {
    const svc = extractServices(xml).find((s) => s.serviceType?.includes('AVTransport'));
    expect(svc?.controlUrl).toBe('/upnp/control/AVTransport1');
  });

  it('无 AVTransport 服务的设备返回空数组', () => {
    const noAv = xml.replace(/<service>[\s\S]*?<\/service>/g, '');
    expect(extractServices(noAv)).toHaveLength(0);
  });
});

describe('buildSoapEnvelope', () => {
  it('包含命名空间、InstanceID 与参数', () => {
    const body = buildSoapEnvelope('SetAVTransportURI', { CurrentURI: 'http://tv/x', CurrentURIMetaData: '' });
    expect(body).toContain('urn:schemas-upnp-org:service:AVTransport:1');
    expect(body).toContain('<u:SetAVTransportURI');
    expect(body).toContain('<InstanceID>0</InstanceID>');
    expect(body).toContain('<CurrentURI>http://tv/x</CurrentURI>');
  });

  it('特殊字符被转义', () => {
    const body = buildSoapEnvelope('Play', { Speed: '1' });
    expect(body).toContain('<Speed>1</Speed>');
  });
});
