// Quy tắc key, loại và kích thước file theo C6 (CLAUDE.md).

const MB = 1024 * 1024;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export interface MediaKind {
  contentType: string;
  maxBytes: number;
  matchesMagic: (head: Uint8Array) => boolean;
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

const WEBP: MediaKind = {
  contentType: "image/webp",
  maxBytes: 2 * MB,
  // RIFF....WEBP
  matchesMagic: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP"),
};

const MP3: MediaKind = {
  contentType: "audio/mpeg",
  maxBytes: 10 * MB,
  // Thẻ ID3 hoặc frame sync MPEG (11 bit 1).
  matchesMagic: (b) => ascii(b, 0, "ID3") || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
};

const M4A: MediaKind = {
  contentType: "audio/mp4",
  maxBytes: 10 * MB,
  // Hộp ISO BMFF đầu tiên: ....ftyp
  matchesMagic: (b) => ascii(b, 4, "ftyp"),
};

const KEY_PATTERNS: [RegExp, MediaKind][] = [
  [new RegExp(`^content/${UUID}-(?:large|small)\\.webp$`), WEBP],
  [new RegExp(`^content/${UUID}\\.mp3$`), MP3],
  [new RegExp(`^content/${UUID}\\.m4a$`), M4A],
];

// R2 key = pathname bỏ "/" đầu: /content/<uuid>-large.webp ↔ content/<uuid>-large.webp.
export function keyFromPath(pathname: string): string | null {
  return pathname.startsWith("/content/") ? pathname.slice(1) : null;
}

export function mediaKind(key: string): MediaKind | null {
  for (const [pattern, kind] of KEY_PATTERNS) {
    if (pattern.test(key)) return kind;
  }
  return null;
}
