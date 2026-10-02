import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MB,
  CUSTOM_ORIGIN,
  ORIGIN,
  UUID,
  WEBP_KEY,
  call,
  claims,
  del,
  installFakeNetwork,
  m4aBytes,
  makeSigner,
  mp3Bytes,
  pngBytes,
  put,
  signToken,
  webpBytes,
  type FakeNetwork,
  type Signer,
} from "./helpers";

let signer: Signer;
let net: FakeNetwork;

const superPassword = () =>
  signToken(signer, claims({ sub: "uid-admin", user_id: "uid-admin", email: "admin@thien-phuong-wedding.local", email_verified: false }));
const superGoogle = (verified = true) =>
  signToken(signer, claims({ sub: "uid-owner", user_id: "uid-owner", email: "phucanhdn01@gmail.com", email_verified: verified }));
const userToken = (uid: string, extra: Record<string, unknown> = {}) =>
  signToken(signer, claims({ sub: uid, user_id: uid, ...extra }));

async function stored(key: string): Promise<boolean> {
  return (await env.MEDIA.head(key)) !== null;
}

beforeEach(async () => {
  const listed = await env.MEDIA.list();
  if (listed.objects.length) await env.MEDIA.delete(listed.objects.map((o) => o.key));
  signer = await makeSigner();
  net = installFakeNetwork(signer);
  net.accessStatus.set("uid-approved", "approved");
  net.accessStatus.set("uid-pending", "pending");
  net.accessStatus.set("uid-rejected", "rejected");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /content/<key>", () => {
  it("serves an existing object publicly with type, long cache and ETag", async () => {
    const bytes = webpBytes(200);
    await env.MEDIA.put(WEBP_KEY, bytes, { httpMetadata: { contentType: "image/webp" } });

    const res = await call(new Request(`https://media.example/${WEBP_KEY}`, { headers: { Origin: "https://evil.example" } }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]+"$/);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("returns 404 for a missing object", async () => {
    const res = await call(new Request(`https://media.example/content/${UUID}-small.webp`));
    expect(res.status).toBe(404);
  });

  it("returns 404 outside content/", async () => {
    const res = await call(new Request(`https://media.example/other/${UUID}-large.webp`));
    expect(res.status).toBe(404);
  });

  it("answers If-None-Match with 304", async () => {
    await env.MEDIA.put(WEBP_KEY, webpBytes(), { httpMetadata: { contentType: "image/webp" } });
    const first = await call(new Request(`https://media.example/${WEBP_KEY}`));
    await first.arrayBuffer();
    const etag = first.headers.get("ETag")!;

    const res = await call(new Request(`https://media.example/${WEBP_KEY}`, { headers: { "If-None-Match": etag } }));
    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe(etag);
  });

  it("serves byte ranges for audio", async () => {
    const key = `content/${UUID}.mp3`;
    const bytes = mp3Bytes(100);
    bytes[10] = 7;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "audio/mpeg" } });

    const res = await call(new Request(`https://media.example/${key}`, { headers: { Range: "bytes=10-19" } }));
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 10-19/100");
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.byteLength).toBe(10);
    expect(body[0]).toBe(7);
  });
});

describe("PUT /content/<key> — allowed", () => {
  it("accepts the password super admin and the object is then served", async () => {
    const bytes = webpBytes(300);
    const res = await call(put(WEBP_KEY, bytes, { token: await superPassword() }));
    expect(res.status).toBe(201);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);

    const got = await call(new Request(`https://media.example/${WEBP_KEY}`));
    expect(got.headers.get("Content-Type")).toBe("image/webp");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
  });

  it("accepts the Google super admin with a verified email", async () => {
    const res = await call(put(WEBP_KEY, webpBytes(), { token: await superGoogle(true) }));
    expect(res.status).toBe(201);
    expect(await stored(WEBP_KEY)).toBe(true);
  });

  it("accepts an approved user via Firestore REST read with the caller's own token", async () => {
    const res = await call(put(WEBP_KEY, webpBytes(), { token: await userToken("uid-approved") }));
    expect(res.status).toBe(201);
    expect(await stored(WEBP_KEY)).toBe(true);
  });

  it("accepts mp3 and m4a uploads up to 10 MB", async () => {
    const token = await superPassword();
    const mp3 = await call(put(`content/${UUID}.mp3`, mp3Bytes(10 * MB), { token, type: "audio/mpeg" }));
    expect(mp3.status).toBe(201);
    const m4a = await call(put(`content/${UUID}.m4a`, m4aBytes(), { token, type: "audio/mp4" }));
    expect(m4a.status).toBe(201);
  });

  it("accepts a WebP of exactly 2 MB", async () => {
    const res = await call(put(WEBP_KEY, webpBytes(2 * MB), { token: await superPassword() }));
    expect(res.status).toBe(201);
  });
});

describe("PUT /content/<key> — blocked", () => {
  async function expectBlocked(request: Request, status: number) {
    const res = await call(request);
    expect(res.status).toBe(status);
    expect(await stored(WEBP_KEY)).toBe(false);
    return res;
  }

  it("rejects a request without a token", async () => {
    const res = await expectBlocked(put(WEBP_KEY, webpBytes()), 401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("rejects a non-Bearer Authorization header", async () => {
    const req = put(WEBP_KEY, webpBytes());
    req.headers.set("Authorization", `Basic ${btoa("admin:pw")}`);
    await expectBlocked(req, 401);
  });

  it("rejects an expired token", async () => {
    const token = await signToken(signer, claims({ exp: Math.floor(Date.now() / 1000) - 10, email: "admin@thien-phuong-wedding.local" }));
    await expectBlocked(put(WEBP_KEY, webpBytes(), { token }), 401);
  });

  it("rejects a token for another audience", async () => {
    const token = await signToken(signer, claims({ aud: "wedding-card-cdcce", email: "admin@thien-phuong-wedding.local" }));
    await expectBlocked(put(WEBP_KEY, webpBytes(), { token }), 401);
  });

  it("rejects a token from another issuer", async () => {
    const token = await signToken(
      signer,
      claims({ iss: "https://securetoken.google.com/wedding-card-cdcce", email: "admin@thien-phuong-wedding.local" }),
    );
    await expectBlocked(put(WEBP_KEY, webpBytes(), { token }), 401);
  });

  it("rejects a token signed by a different key with the same kid", async () => {
    const forger = await makeSigner();
    const token = await signToken(forger, claims({ email: "admin@thien-phuong-wedding.local" }));
    await expectBlocked(put(WEBP_KEY, webpBytes(), { token }), 401);
  });

  it("rejects a payload swapped under a valid signature", async () => {
    const real = await userToken("uid-pending");
    const forged = await signToken(signer, claims({ sub: "x", email: "admin@thien-phuong-wedding.local" }));
    const [h, , s] = real.split(".");
    const token = `${h}.${forged.split(".")[1]}.${s}`;
    await expectBlocked(put(WEBP_KEY, webpBytes(), { token }), 401);
  });

  it("rejects alg none and HS256 headers", async () => {
    const body = claims({ email: "admin@thien-phuong-wedding.local" });
    const none = await signToken(signer, body, { alg: "none", kid: "test-kid-1" });
    await expectBlocked(put(WEBP_KEY, webpBytes(), { token: none }), 401);
    const hs = await signToken(signer, body, { alg: "HS256", kid: "test-kid-1" });
    await expectBlocked(put(WEBP_KEY, webpBytes(), { token: hs }), 401);
  });

  it("rejects iat or auth_time in the future and an empty sub", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const base = { email: "admin@thien-phuong-wedding.local" };
    for (const extra of [{ iat: future }, { auth_time: future }, { sub: "" }]) {
      const token = await signToken(signer, claims({ ...base, ...extra }));
      await expectBlocked(put(WEBP_KEY, webpBytes(), { token }), 401);
    }
  });

  it("rejects the super admin Google email when it is not verified", async () => {
    await expectBlocked(put(WEBP_KEY, webpBytes(), { token: await superGoogle(false) }), 403);
  });

  it("rejects pending, rejected and unknown users", async () => {
    for (const uid of ["uid-pending", "uid-rejected", "uid-unknown"]) {
      await expectBlocked(put(WEBP_KEY, webpBytes(), { token: await userToken(uid) }), 403);
    }
  });

  it("fails closed when Firestore is unavailable", async () => {
    net.firestoreFailure = 500;
    await expectBlocked(put(WEBP_KEY, webpBytes(), { token: await userToken("uid-approved") }), 503);
  });

  it("rejects keys outside content/", async () => {
    const res = await call(put(`other/${UUID}-large.webp`, webpBytes(), { token: await superPassword() }));
    expect(res.status).toBe(404);
    expect(await stored(`other/${UUID}-large.webp`)).toBe(false);
  });

  it("rejects keys that do not match the C6 pattern", async () => {
    const token = await superPassword();
    const bad = [
      "content/abc-large.webp",
      `content/${UUID}-medium.webp`,
      `content/${UUID}.webp`,
      `content/${UUID.toUpperCase()}-large.webp`,
      `content/${UUID}-large.png`,
      `content/sub/${UUID}-large.webp`,
      `content/..%2F${UUID}-large.webp`,
      `content/${UUID}.wav`,
    ];
    for (const key of bad) {
      const res = await call(put(key, webpBytes(), { token }));
      expect(res.status, key).toBe(400);
    }
  });

  it("rejects a Content-Type that does not match the key", async () => {
    const token = await superPassword();
    await expectBlocked(put(WEBP_KEY, webpBytes(), { token, type: "image/png" }), 415);
    const res = await call(put(`content/${UUID}.m4a`, m4aBytes(), { token, type: "audio/mpeg" }));
    expect(res.status).toBe(415);
  });

  it("rejects an oversized Content-Length", async () => {
    await expectBlocked(put(WEBP_KEY, webpBytes(2 * MB + 1), { token: await superPassword() }), 413);
  });

  it("rejects a body larger than the limit even when Content-Length lies", async () => {
    await expectBlocked(put(WEBP_KEY, webpBytes(3 * MB), { token: await superPassword(), length: "1000" }), 413);
  });

  it("rejects audio over 10 MB with a lying Content-Length", async () => {
    const key = `content/${UUID}.mp3`;
    const res = await call(put(key, mp3Bytes(10 * MB + 1), { token: await superPassword(), type: "audio/mpeg", length: "64" }));
    expect(res.status).toBe(413);
    expect(await stored(key)).toBe(false);
  });

  it("rejects a body shorter than Content-Length", async () => {
    await expectBlocked(put(WEBP_KEY, webpBytes(100), { token: await superPassword(), length: "200" }), 400);
  });

  it("requires Content-Length", async () => {
    await expectBlocked(put(WEBP_KEY, webpBytes(), { token: await superPassword(), length: null }), 411);
  });

  it("rejects bytes that are not really WebP", async () => {
    await expectBlocked(put(WEBP_KEY, pngBytes(), { token: await superPassword() }), 415);
  });
});

describe("DELETE /content/<key>", () => {
  beforeEach(async () => {
    await env.MEDIA.put(WEBP_KEY, webpBytes(), { httpMetadata: { contentType: "image/webp" } });
  });

  it("lets an approved admin delete, then GET is 404", async () => {
    const res = await call(del(WEBP_KEY, { token: await userToken("uid-approved") }));
    expect(res.status).toBe(204);
    const got = await call(new Request(`https://media.example/${WEBP_KEY}`));
    expect(got.status).toBe(404);
  });

  it("lets the super admins delete", async () => {
    expect((await call(del(WEBP_KEY, { token: await superPassword() }))).status).toBe(204);
    await env.MEDIA.put(WEBP_KEY, webpBytes());
    expect((await call(del(WEBP_KEY, { token: await superGoogle(true) }))).status).toBe(204);
  });

  async function expectKept(request: Request, status: number) {
    const res = await call(request);
    expect(res.status).toBe(status);
    expect(await stored(WEBP_KEY)).toBe(true);
  }

  it("rejects missing, expired, wrong-aud, wrong-iss and forged tokens", async () => {
    const admin = { email: "admin@thien-phuong-wedding.local" };
    await expectKept(del(WEBP_KEY), 401);
    await expectKept(del(WEBP_KEY, { token: await signToken(signer, claims({ ...admin, exp: Math.floor(Date.now() / 1000) - 1 })) }), 401);
    await expectKept(del(WEBP_KEY, { token: await signToken(signer, claims({ ...admin, aud: "other" })) }), 401);
    await expectKept(del(WEBP_KEY, { token: await signToken(signer, claims({ ...admin, iss: "https://evil" })) }), 401);
    await expectKept(del(WEBP_KEY, { token: await signToken(await makeSigner(), claims(admin)) }), 401);
  });

  it("rejects unverified Google super admin, pending and rejected users", async () => {
    await expectKept(del(WEBP_KEY, { token: await superGoogle(false) }), 403);
    await expectKept(del(WEBP_KEY, { token: await userToken("uid-pending") }), 403);
    await expectKept(del(WEBP_KEY, { token: await userToken("uid-rejected") }), 403);
  });

  it("rejects keys outside the pattern", async () => {
    const res = await call(del(`content/${UUID}-medium.webp`, { token: await superPassword() }));
    expect(res.status).toBe(400);
  });
});

describe("CORS", () => {
  function preflight(origin: string, method = "PUT"): Request {
    return new Request(`https://media.example/${WEBP_KEY}`, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": "authorization,content-type" },
    });
  }

  it("allows the Pages origin and local dev origins for writes", async () => {
    for (const origin of [ORIGIN, "http://localhost:5173", "http://127.0.0.1:8080", "http://localhost"]) {
      const res = await call(preflight(origin));
      expect(res.status, origin).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    }
  });

  it("allows the custom domain origin for preflight, PUT and DELETE", async () => {
    const res = await call(preflight(CUSTOM_ORIGIN));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(CUSTOM_ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");

    const token = await superPassword();
    const created = await call(put(WEBP_KEY, webpBytes(), { token, origin: CUSTOM_ORIGIN }));
    expect(created.status).toBe(201);
    expect(created.headers.get("Access-Control-Allow-Origin")).toBe(CUSTOM_ORIGIN);
    expect(await stored(WEBP_KEY)).toBe(true);

    const gone = await call(del(WEBP_KEY, { token, origin: CUSTOM_ORIGIN }));
    expect(gone.headers.get("Access-Control-Allow-Origin")).toBe(CUSTOM_ORIGIN);
    expect(await stored(WEBP_KEY)).toBe(false);
  });

  it("refuses lookalikes of the custom domain", async () => {
    for (const origin of [
      "http://thien-phuong-weddingcard.anhlp.com",
      "https://anhlp.com",
      "https://www.anhlp.com",
      "https://other.anhlp.com",
      "https://thien-phuong-weddingcard.anhlp.com.evil.com",
      "https://evil.thien-phuong-weddingcard.anhlp.com",
      "https://thien-phuong-weddingcard.anhlp.com:8443",
      "https://thien-phuong-weddingcard.anhlp.com/",
      "null",
      "",
    ]) {
      const res = await call(preflight(origin));
      expect(res.status, origin).toBe(403);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("refuses foreign origins on preflight", async () => {
    for (const origin of [
      "https://evil.example",
      "https://phucanh08.github.io.evil.example",
      "http://phucanh08.github.io",
      "https://localhost:5173",
      "http://localhost.evil.example",
      "http://127.0.0.1.evil.example:80",
    ]) {
      const res = await call(preflight(origin));
      expect(res.status, origin).toBe(403);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("refuses PUT and DELETE from a foreign origin even with an admin token", async () => {
    const token = await superPassword();
    const res = await call(put(WEBP_KEY, webpBytes(), { token, origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(await stored(WEBP_KEY)).toBe(false);

    await env.MEDIA.put(WEBP_KEY, webpBytes());
    const gone = await call(del(WEBP_KEY, { token, origin: "https://evil.example" }));
    expect(gone.status).toBe(403);
    expect(await stored(WEBP_KEY)).toBe(true);
  });

  it("keeps GET open to any origin", async () => {
    const res = await call(preflight("https://evil.example", "GET"));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
