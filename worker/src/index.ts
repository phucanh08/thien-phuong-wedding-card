// Worker phục vụ ảnh/nhạc thiệp trên R2 theo C6 (CLAUDE.md):
// GET/HEAD /content/<key> công khai; PUT/DELETE chỉ cho admin (C5).

import { AuthError, requireAdmin } from "./auth";
import { keyFromPath, mediaKind, type MediaKind } from "./media";

const IMMUTABLE = "public, max-age=31536000, immutable";
const ALLOWED_ORIGIN = /^(?:https:\/\/(?:phucanh08\.github\.io|thien-phuong-weddingcard\.anhlp\.com)|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?)$/;

function json(status: number, body: unknown, headers?: HeadersInit): Response {
  const response = Response.json(body, { status, headers });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function writeCors(origin: string | null, headers: Headers): void {
  if (origin && ALLOWED_ORIGIN.test(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  headers.append("Vary", "Origin");
}

function preflight(request: Request): Response {
  const origin = request.headers.get("Origin");
  const method = request.headers.get("Access-Control-Request-Method");
  if (method === "GET" || method === "HEAD") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD",
        "Access-Control-Allow-Headers": "Range, If-None-Match",
        "Access-Control-Max-Age": "600",
      },
    });
  }
  if (!origin || !ALLOWED_ORIGIN.test(origin)) {
    return json(403, { error: "origin not allowed" });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, HEAD, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    },
  });
}

async function serve(request: Request, env: Env, key: string): Promise<Response> {
  if (!mediaKind(key)) return json(404, { error: "not found" });

  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "ETag, Content-Length, Content-Range, Accept-Ranges",
  });
  let object: R2Object | R2ObjectBody | null;
  try {
    object = await env.MEDIA.get(key, { onlyIf: request.headers, range: request.headers });
  } catch (error) {
    // R2 báo Range không thoả được bằng mã 10039; mọi lỗi khác là lỗi phía R2.
    if (request.headers.has("Range") && /\(10039\)/.test(String((error as Error)?.message))) {
      return json(416, { error: "range not satisfiable" }, headers);
    }
    console.error(JSON.stringify({ event: "r2_get_failed", message: String((error as Error)?.message) }));
    return json(503, { error: "storage unavailable" }, headers);
  }
  if (!object) return json(404, { error: "not found" }, headers);

  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", IMMUTABLE);
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");

  if (!("body" in object)) {
    const conditional = request.headers.has("If-None-Match") || request.headers.has("If-Modified-Since");
    return new Response(null, { status: conditional ? 304 : 412, headers });
  }

  let status = 200;
  if (request.headers.has("Range") && object.range) {
    const range = object.range as { offset?: number; length?: number; suffix?: number };
    let offset: number;
    let length: number;
    // Miniflare trả đủ cả ba field (giá trị undefined), nên kiểm giá trị chứ không kiểm `in`.
    if (range.suffix !== undefined) {
      length = Math.min(range.suffix, object.size);
      offset = object.size - length;
    } else {
      offset = range.offset ?? 0;
      length = range.length ?? object.size - offset;
    }
    status = 206;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
  } else {
    headers.set("Content-Length", String(object.size));
  }
  return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
}

// Đọc body tối đa limit byte; trả null ngay khi vượt.
async function readBounded(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function mediaType(request: Request): string {
  return (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
}

async function upload(request: Request, env: Env, key: string, kind: MediaKind, uid: string): Promise<Response> {
  if (mediaType(request) !== kind.contentType) {
    return json(415, { error: `content type must be ${kind.contentType}` });
  }
  const declared = request.headers.get("Content-Length");
  if (declared === null || !/^\d+$/.test(declared)) {
    return json(411, { error: "content length required" });
  }
  const declaredBytes = Number(declared);
  if (declaredBytes > kind.maxBytes) return json(413, { error: "file too large" });

  const bytes = await readBounded(request.body, kind.maxBytes);
  if (!bytes) return json(413, { error: "file too large" });
  if (bytes.byteLength !== declaredBytes) {
    return json(400, { error: "content length mismatch" });
  }
  if (!kind.matchesMagic(bytes.subarray(0, 16))) {
    return json(415, { error: `body is not ${kind.contentType}` });
  }

  // Key luôn là uuid mới và GET đặt cache immutable: không bao giờ ghi đè key đã có.
  const object = await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: kind.contentType, cacheControl: IMMUTABLE },
    customMetadata: { uploadedBy: uid },
    onlyIf: { etagDoesNotMatch: "*" },
  });
  if (!object) return json(409, { error: "key already exists" });
  return json(201, { key, etag: object.httpEtag, size: object.size });
}

async function write(request: Request, env: Env, key: string): Promise<Response> {
  const claims = await requireAdmin(request);
  const kind = mediaKind(key);
  if (!kind) return json(400, { error: "invalid key" });
  if (request.method === "PUT") return upload(request, env, key, kind, claims.sub);
  await env.MEDIA.delete(key);
  return new Response(null, { status: 204 });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = keyFromPath(url.pathname);
  if (!key) return json(404, { error: "not found" });

  switch (request.method) {
    case "GET":
    case "HEAD":
      return serve(request, env, key);
    case "OPTIONS":
      return preflight(request);
    case "PUT":
    case "DELETE": {
      const origin = request.headers.get("Origin");
      // Origin vắng = client không phải trình duyệt; vẫn phải qua token admin.
      if (origin !== null && !ALLOWED_ORIGIN.test(origin)) {
        return json(403, { error: "origin not allowed" });
      }
      let response: Response;
      try {
        response = await write(request, env, key);
      } catch (error) {
        if (error instanceof AuthError) {
          console.warn(JSON.stringify({ event: "auth_denied", status: error.status, reason: error.message }));
          response = json(error.status, { error: error.message }, error.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined);
        } else {
          console.error(JSON.stringify({ event: "write_failed", message: String((error as Error)?.message) }));
          response = json(503, { error: "storage unavailable" });
        }
      }
      const headers = new Headers(response.headers);
      writeCors(origin, headers);
      return new Response(response.body, { status: response.status, headers });
    }
    default:
      return json(405, { error: "method not allowed" }, { Allow: "GET, HEAD, PUT, DELETE, OPTIONS" });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return route(request, env);
  },
} satisfies ExportedHandler<Env>;
