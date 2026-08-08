import dgram from 'react-native-udp';
import { Buffer } from 'buffer';

// Xbox 360 / XInput button bitmasks (exact ViGEm/XInput wire format)
export const Buttons = {
  UP:    0x0001,
  DOWN:  0x0002,
  LEFT:  0x0004,
  RIGHT: 0x0008,
  START: 0x0010,
  BACK:  0x0020,
  LS:    0x0040,  // Left Stick Click
  RS:    0x0080,  // Right Stick Click
  LB:    0x0100,
  RB:    0x0200,
  GUIDE: 0x0400,
  A:     0x1000,
  B:     0x2000,
  X:     0x4000,
  Y:     0x8000,

  // Sentinel keys used ONLY by client toggle logic — never written to packet.buttons
  LT:    0x10000, // out-of-band sentinel
  RT:    0x20000, // out-of-band sentinel
};

export class GamepadNetwork {
  constructor(ip, port, playerId = 0) {
    this.ip = ip;
    this.port = port;
    this.playerId = playerId;
    this.sequence = 0;

    this.socket = dgram.createSocket('udp4');
    this.socket.bind(0);

    // PRE-ALLOCATED BUFFERS — zero GC pressure at 60 Hz
    this.arrayBuffer = new ArrayBuffer(24);
    this.view = new DataView(this.arrayBuffer);
    this.nodeBuffer = Buffer.from(this.arrayBuffer);

    // Fixed header bytes (never change)
    this.view.setUint8(0, 0x47); // MAGIC
    this.view.setUint8(1, 0x01); // VERSION
    this.view.setUint8(2, this.playerId);
    this.view.setUint8(3, 0x00); // flags (overwritten each send)
  }

  /**
   * @param {number} buttons  16-bit XInput button bitmask (no trigger bits)
   * @param {number} lt       Left  trigger 0-255
   * @param {number} rt       Right trigger 0-255
   * @param {number} lx       Left  stick X  -32767..+32767
   * @param {number} ly       Left  stick Y  -32767..+32767
   * @param {number} rx       Right stick X  -32767..+32767
   * @param {number} ry       Right stick Y  -32767..+32767
   * @param {number} flags    Mode flags byte (bit0 = mouse mode)
   */
  send(buttons, lt, rt, lx, ly, rx, ry, flags) {
    this.sequence = (this.sequence + 1) >>> 0;

    this.view.setUint8(3, flags & 0xff);
    this.view.setUint32(4, this.sequence, true);
    this.view.setUint16(8,  buttons & 0xffff, true); // mask to 16-bit — triggers are separate
    this.view.setInt16(10,  lx, true);
    this.view.setInt16(12,  ly, true);
    this.view.setInt16(14,  rx, true);
    this.view.setInt16(16,  ry, true);
    this.view.setUint8(18,  lt & 0xff);
    this.view.setUint8(19,  rt & 0xff);
    this.view.setUint32(20, (Date.now() >>> 0), true);

    this.socket.send(this.nodeBuffer, 0, 24, this.port, this.ip);
  }

  close() {
    try {
      this.socket.close();
    } catch (e) {
      console.warn('Socket close error:', e);
    }
  }
}
