// Khoá test chỉ vào được Worker qua câu trả lời của fetch tới URL Google cố định.
// Không có binding/biến môi trường nào đổi nguồn khoá — các test dưới chứng minh điều đó.

import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEBP_KEY, call, claims, installFakeNetwork, makeSigner, put, signToken, webpBytes, type FakeNetwork, type Signer } from "./helpers";

const ADMIN = { email: "admin@thien-phuong-wedding.local" };
let signer: Signer;
let net: FakeNetwork;

beforeEach(async () => {
  const listed = await env.MEDIA.list();
  if (listed.objects.length) await env.MEDIA.delete(listed.objects.map((o) => o.key));
  signer = await makeSigner();
  net = installFakeNetwork(signer);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("public key source", () => {
  it("fetches keys only from the fixed Google JWKS URL, whatever env contains", async () => {
    const hostile = {
      ...env,
      JWKS_URL: "https://attacker.example/jwks",
      PUBLIC_KEYS: JSON.stringify({ keys: [signer.publicJwk] }),
      TEST_MODE: "1",
    } as unknown as Env;
    const res = await call(put(WEBP_KEY, webpBytes(), { token: await signToken(signer, claims(ADMIN)) }), hostile);
    expect(res.status).toBe(201);
    expect(net.requestedUrls).toEqual([
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
    ]);
  });

  it("rejects a test-signed token when Google serves its own keys (production)", async () => {
    const google = await makeSigner("test-kid-1");
    net.jwks = () => Response.json({ keys: [google.publicJwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    const res = await call(put(WEBP_KEY, webpBytes(), { token: await signToken(signer, claims(ADMIN)) }));
    expect(res.status).toBe(401);
    expect(await env.MEDIA.head(WEBP_KEY)).toBeNull();
  });

  it("fails closed when the key endpoint is down", async () => {
    net.jwks = () => new Response("down", { status: 500 });
    const res = await call(put(WEBP_KEY, webpBytes(), { token: await signToken(signer, claims(ADMIN)) }));
    expect(res.status).toBe(503);
    expect(await env.MEDIA.head(WEBP_KEY)).toBeNull();
  });
});

describe("key cache follows Cache-Control", () => {
  it("keeps cached keys while max-age has not elapsed", async () => {
    const token = await signToken(signer, claims(ADMIN));
    expect((await call(put(WEBP_KEY, webpBytes(), { token }))).status).toBe(201);

    const rotated = await makeSigner("test-kid-1");
    net.jwks = () => Response.json({ keys: [rotated.publicJwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    // Key khác: PUT lên key đã có là 409 (N4), cache khoá vẫn phải còn hiệu lực.
    const otherKey = "content/1b4e28ba-2fa1-41d2-883f-0016d3cca427-large.webp";
    expect((await call(put(otherKey, webpBytes(), { token }))).status).toBe(201);
  });

  it("refetches keys when max-age is 0", async () => {
    net.jwks = () => Response.json({ keys: [signer.publicJwk] }, { headers: { "Cache-Control": "max-age=0" } });
    const token = await signToken(signer, claims(ADMIN));
    expect((await call(put(WEBP_KEY, webpBytes(), { token }))).status).toBe(201);

    const rotated = await makeSigner("test-kid-1");
    net.jwks = () => Response.json({ keys: [rotated.publicJwk] }, { headers: { "Cache-Control": "max-age=0" } });
    expect((await call(put(WEBP_KEY, webpBytes(), { token }))).status).toBe(401);
  });
});
