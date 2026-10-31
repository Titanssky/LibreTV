/**
 * 局域网 DLNA 投屏（通用方案）类型定义。
 *
 * 面向任何支持 DLNA/UPnP 的媒体接收端（华为智慧屏、小米电视、当贝等均可），
 * 不依赖任何厂商私有协议。
 */

/** 局域网内发现到的 DLNA/UPnP 媒体接收端（MediaRenderer，含 AVTransport 服务） */
export interface CastDevice {
  /** 稳定标识：AVTransport 控制地址（绝对 URL），同时用作 deviceId */
  id: string;
  /** 设备显示名（UPnP friendlyName），如「HUAWEI VISION」 */
  name: string;
  /** UPnP 唯一设备标识 UDN */
  udn?: string;
  /** 设备描述文档地址（SSDP 响应的 LOCATION） */
  locationUrl: string;
  /** AVTransport 控制地址（绝对 URL），SOAP 遥控目标 */
  controlUrl: string;
  /** 设备型号（可选） */
  modelName?: string;
}

/** POST /api/cast/session 的响应 */
export interface CastSessionResponse {
  /** 一次性投屏会话令牌（电视拉流凭证，代替浏览器 cookie） */
  sid: string;
  /** 电视将要主动拉取的绝对地址（http://<PC局域网IP>:8080/api/cast/stream?sid=…&url=…） */
  castUrl: string;
  deviceName: string;
}

/** POST /api/cast/control 的响应（setUri 会签发新的会话） */
export interface CastControlResponse {
  ok: boolean;
  /** setUri 成功后的新会话（旧会话已作废） */
  sid?: string;
  castUrl?: string;
  deviceName?: string;
  error?: string;
}

/** 遥控动作 */
export type CastAction = 'play' | 'pause' | 'stop' | 'setUri';
