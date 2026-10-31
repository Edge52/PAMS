/** Read pixel dimensions from PNG, JPEG, GIF, WebP or SVG bytes without any dependency. Pure. */

export type ImageInfo = { type: "png" | "jpeg" | "gif" | "webp" | "svg"; width: number; height: number };

export function imageSize(buf: Uint8Array): ImageInfo | null {
  const u16be = (o: number) => (buf[o] << 8) | buf[o + 1];
  const u32be = (o: number) => ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
  const u16le = (o: number) => buf[o] | (buf[o + 1] << 8);
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { type: "png", width: u32be(16), height: u32be(20) };
  }
  if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { type: "gif", width: u16le(6), height: u16le(8) };
  }
  if (buf.length >= 30 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45) {
    const chunk = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
    if (chunk === "VP8X") return { type: "webp", width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
    if (chunk === "VP8 ") return { type: "webp", width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = buf.subarray(21, 25);
      return { type: "webp", width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0xf) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
    }
    return null;
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const marker = buf[o + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
      const len = u16be(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: "jpeg", height: u16be(o + 5), width: u16be(o + 7) };
      }
      o += 2 + len;
    }
    return null;
  }
  const head = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 4096)));
  if (/<svg[\s>]/i.test(head)) {
    const tag = head.match(/<svg[^>]*>/i)?.[0] ?? "";
    const vb = tag.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    const w = tag.match(/\swidth\s*=\s*["']([\d.]+)/i), h = tag.match(/\sheight\s*=\s*["']([\d.]+)/i);
    if (w && h) return { type: "svg", width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) };
    if (vb) return { type: "svg", width: Math.round(Number(vb[1])), height: Math.round(Number(vb[2])) };
    return { type: "svg", width: 0, height: 0 };
  }
  return null;
}

/** Scale image pixels to a plan size whose long side is at most `maxSide` units (keeps aspect ratio). */
export function planSizeFor(img: { width: number; height: number }, maxSide = 1600): { w: number; h: number } | null {
  if (!img.width || !img.height) return null;
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  return { w: Math.max(100, Math.round(img.width * k)), h: Math.max(100, Math.round(img.height * k)) };
}
