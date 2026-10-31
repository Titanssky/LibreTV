'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client-api';
import type { CastAction, CastControlResponse, CastDevice, CastSessionResponse } from '@/lib/cast/types';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/states';

/**
 * 局域网 DLNA 投屏面板：播放页「投屏」按钮 + 设备列表 + 迷你遥控。
 *
 * - 通用 DLNA 方案：任何支持 AVTransport 的电视（华为智慧屏等）都可投；
 * - 切集（url 变化）自动经 setUri 同步到电视，无需重新操作；
 * - 离开播放页时自动停止投屏并作废会话。
 */
interface CastState {
  sid: string;
  deviceName: string;
  playing: boolean;
}

export function CastPanel({ currentUrl }: { currentUrl: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<CastDevice[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [cast, setCast] = useState<CastState | null>(null);
  const [busy, setBusy] = useState(false);

  // 最近一次投屏/切集使用的 url：url 变化且投屏中 → 自动同步
  const lastUrlRef = useRef('');
  const castRef = useRef<CastState | null>(null);
  castRef.current = cast;

  const discover = async () => {
    setDiscovering(true);
    try {
      const res = await api.castDiscover();
      setDevices(res.devices);
      if (res.devices.length === 0) toast('未发现可投屏的电视，请确认电视已开机并连上同一局域网', 'error');
    } catch (err) {
      toast(err instanceof Error ? err.message : '扫描设备失败', 'error');
    } finally {
      setDiscovering(false);
    }
  };

  const openPanel = () => {
    setOpen((v) => !v);
    if (!open && devices === null && !cast) void discover();
  };

  const startCast = async (device: CastDevice) => {
    if (!currentUrl) return;
    setBusy(true);
    lastUrlRef.current = currentUrl;
    try {
      const res: CastSessionResponse = await api.castStart(currentUrl, device.id);
      setCast({ sid: res.sid, deviceName: res.deviceName, playing: true });
      toast(`已投屏到 ${res.deviceName}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '投屏失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const control = async (action: CastAction) => {
    const c = castRef.current;
    if (!c || busy) return;
    setBusy(true);
    try {
      await api.castControl(c.sid, action);
      if (action === 'play') setCast({ ...c, playing: true });
      if (action === 'pause') setCast({ ...c, playing: false });
      if (action === 'stop') setCast(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : '遥控失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  // 切集自动同步：投屏中且 currentUrl 变化 → 通知电视切换新地址（服务端签发新 sid）
  useEffect(() => {
    const c = castRef.current;
    if (!c || !currentUrl || currentUrl === lastUrlRef.current) return;
    const prev = lastUrlRef.current;
    lastUrlRef.current = currentUrl;
    api
      .castControl(c.sid, 'setUri', currentUrl)
      .then((res: CastControlResponse) => {
        if (res.ok && res.sid) setCast({ ...castRef.current!, sid: res.sid, playing: true });
      })
      .catch((err) => {
        // 切换失败：回滚基准，避免后续同地址反复重试
        lastUrlRef.current = prev;
        toast(err instanceof Error ? err.message : '电视切集失败', 'error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl]);

  // 离开播放页：停止投屏并作废会话（fire-and-forget）
  useEffect(
    () => () => {
      const c = castRef.current;
      if (c) void api.castControl(c.sid, 'stop').catch(() => {});
    },
    []
  );

  const tvIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm5 14l3-3 3 3" />
    </svg>
  );

  return (
    <div className="relative">
      <button
        type="button"
        className={cn('btn-ghost btn-sm', cast && 'text-accent')}
        disabled={!currentUrl}
        onClick={openPanel}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={currentUrl ? '投屏到局域网内的电视（DLNA）' : '当前没有可播放的地址'}
      >
        {tvIcon}
        {cast ? '投屏中' : '投屏'}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border border-line bg-surface-raised shadow-lg p-2">
          {cast ? (
            <div className="space-y-2">
              <div className="text-sm font-medium text-content">已投屏到 {cast.deviceName}</div>
              <p className="text-[11px] text-muted leading-relaxed">
                电脑上切集会自动同步到电视；本页播放进度与电视互不影响。
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-sm flex-1"
                  disabled={busy}
                  onClick={() => void control(cast.playing ? 'pause' : 'play')}
                >
                  {cast.playing ? '暂停' : '继续'}
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm flex-1"
                  disabled={busy}
                  onClick={() => void control('stop')}
                >
                  停止投屏
                </button>
              </div>
            </div>
          ) : discovering ? (
            <div className="flex items-center justify-center gap-2 py-6 text-muted text-sm">
              <Spinner size="sm" />
              正在扫描局域网设备…
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between px-1 pb-1.5">
                <span className="text-sm font-medium text-content">选择投屏设备</span>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={discovering}
                  onClick={() => void discover()}
                >
                  重新扫描
                </button>
              </div>
              {devices && devices.length > 0 ? (
                <ul className="max-h-52 overflow-y-auto scrollbar-thin space-y-1">
                  {devices.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className="w-full text-left px-2 py-1.5 rounded-md hover:bg-hover transition-colors flex items-center justify-between gap-2"
                        disabled={busy}
                        onClick={() => void startCast(d)}
                      >
                        <span className="min-w-0 truncate text-sm text-content">{d.name}</span>
                        {d.modelName && (
                          <span className="shrink-0 text-[11px] text-faint">{d.modelName}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted px-1 pb-1">
                  未发现设备。请确认电视已开机、投屏开关已开启，且与电脑连接同一局域网。
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
