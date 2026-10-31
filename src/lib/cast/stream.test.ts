import { describe, expect, it } from 'vitest';
import { rewriteM3u8 } from '@/lib/m3u8';
import { buildCastPrefix } from './stream';

describe('buildCastPrefix', () => {
  it('生成「绝对局域网地址 + sid」的拉流基座', () => {
    expect(buildCastPrefix('abc123', 'http://192.168.1.125:8080')).toBe(
      'http://192.168.1.125:8080/api/cast/stream?sid=abc123&url='
    );
  });
});

describe('投屏 m3u8 重写', () => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:10',
    '#EXT-X-KEY:METHOD=AES-128,URI="key0.key"',
    '#EXTINF:10,',
    'seg0.ts',
    '#EXTINF:10,',
    'https://cdn.example.com/video/seg1.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');

  it('分片与 key 全部改写为带 sid 的绝对拉流地址（电视免 cookie 直拉）', () => {
    const out = rewriteM3u8(
      playlist,
      'https://cdn.example.com/video/master.m3u8',
      0,
      buildCastPrefix('abc123', 'http://192.168.1.125:8080')
    );
    expect(out).toContain(
      'http://192.168.1.125:8080/api/cast/stream?sid=abc123&url=https%3A%2F%2Fcdn.example.com%2Fvideo%2Fseg0.ts'
    );
    expect(out).toContain(
      'http://192.168.1.125:8080/api/cast/stream?sid=abc123&url=https%3A%2F%2Fcdn.example.com%2Fvideo%2Fseg1.ts'
    );
    expect(out).toContain(
      'URI="http://192.168.1.125:8080/api/cast/stream?sid=abc123&url=https%3A%2F%2Fcdn.example.com%2Fvideo%2Fkey0.key"'
    );
  });

  it('已是本站代理地址的行不二次改写', () => {
    const withProxy = '#EXTM3U\n/api/proxy?url=https%3A%2F%2Fx%2F1.ts\n';
    const out = rewriteM3u8(
      withProxy,
      'https://cdn.example.com/video/master.m3u8',
      0,
      buildCastPrefix('abc123', 'http://192.168.1.125:8080')
    );
    expect(out).toContain('/api/proxy?url=');
  });
});
