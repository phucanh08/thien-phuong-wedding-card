import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRESTORE_ACCESS,
  ORIGIN,
  PROJECT,
  WEBP_KEY,
  call,
  claims,
  installFakeNetwork,
  makeSigner,
  put,
  signToken,
  webpBytes,
  type FakeNetwork,
  type Signer,
} from "./helpers";

let signer: Signer;
let net: FakeNetwork;

const approvedToken = () => signToken(signer, claims());
const objectCount = async () => (await env.MEDIA.list()).objects.length;

function expectCors(res: Response) {
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
}

beforeEach(async () => {
  const listed = await env.MEDIA.list();
  if (listed.objects.length) await env.MEDIA.delete(listed.objects.map((o) => o.key));
  signer = await makeSigner();
  net = installFakeNetwork(signer);
  net.accessStatus.set("uid-approved", "approved");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("N1 broken token or key source answers with the right code and CORS", () => {
  it("returns 401 + CORS for a signature whose base64url length is impossible", async () => {
    const [h, p] = (await approvedToken()).split(".");
    const res = await call(put(WEBP_KEY, webpBytes(), { token: `${h}.${p}.AAAAA` }));
    expect(res.status).toBe(401);
    expectCors(res);
    expect(await objectCount()).toBe(0);
  });

  it("returns 503 + CORS when the JWKS body is not JSON", async () => {
    net.jwks = () => new Response("<html>oops</html>", { headers: { "Cache-Control": "max-age=60" } });
    const res = await call(put(WEBP_KEY, webpBytes(), { token: await approvedToken() }));
    expect(res.status).toBe(503);
    expectCors(res);
    expect(await objectCount()).toBe(0);
  });

  it("returns 503 + CORS when a JWK cannot be imported", async () => {
    net.jwks = () => Response.json({ keys: [{ kty: "RSA", kid: "test-kid-1", n: "!!!", e: "AQAB" }] });
    const res = await call(put(WEBP_KEY, webpBytes(), { token: await approvedToken() }));
    expect(res.status).toBe(503);
    expectCors(res);
    expect(await objectCount()).toBe(0);
  });

  it("returns 503 + CORS when Google cannot be reached", async () => {
    net.jwks = () => {
      throw new TypeError("network down");
    };
    const res = await call(put(WEBP_KEY, webpBytes(), { token: await approvedToken() }));
    expect(res.status).toBe(503);
    expectCors(res);
  });
});

describe("N2 subject must be a plain uid", () => {
  for (const sub of ["..", ".", "a/b", "uid%2e%2e", "x".repeat(129), "uid with space"]) {
    it(`returns 401 for sub ${JSON.stringify(sub.length > 20 ? sub.slice(0, 8) + "…" : sub)} and never asks Firestore`, async () => {
      net.accessStatus.set(sub, "approved");
      const res = await call(put(WEBP_KEY, webpBytes(), { token: await signToken(signer, claims({ sub, user_id: sub })) }));
      expect(res.status).toBe(401);
      expectCors(res);
      expect(net.requestedUrls.filter((u) => u.startsWith(FIRESTORE_ACCESS.slice(0, 40)))).toEqual([]);
      expect(await objectCount()).toBe(0);
    });
  }

  it("still accepts a 128-character uid with _ and -", async () => {
    const sub = "A_b-".repeat(32);
    net.accessStatus.set(sub, "approved");
    const res = await call(put(WEBP_KEY, webpBytes(), { token: await signToken(signer, claims({ sub, user_id: sub })) }));
    expect(res.status).toBe(201);
  });
});

describe("N3 Firestore document must be the caller's own", () => {
  it("returns 403 when the returned doc name belongs to another uid", async () => {
    net.docName = () => `projects/${PROJECT}/databases/(default)/documents/accessRequests/uid-someone-else`;
    const res = await call(put(WEBP_KEY, webpBytes(), { token: await approvedToken() }));
    expect(res.status).toBe(403);
    expectCors(res);
    expect(await objectCount()).toBe(0);
  });

  it("returns 403 when the doc comes from another collection", async () => {
    net.docName = (uid) => `projects/${PROJECT}/databases/(default)/documents/guests/${uid}`;
    const res = await call(put(WEBP_KEY, webpBytes(), { token: await approvedToken() }));
    expect(res.status).toBe(403);
  });

  it("returns 403 when the doc has no name", async () => {
    net.docName = () => "";
    const res = await call(put(WEBP_KEY, webpBytes(), { token: await approvedToken() }));
    expect(res.status).toBe(403);
  });
});

describe("N4 PUT never overwrites an existing key", () => {
  it("returns 409 and keeps the original bytes", async () => {
    const original = webpBytes(64);
    const first = await call(put(WEBP_KEY, original, { token: await approvedToken() }));
    expect(first.status).toBe(201);

    const second = await call(put(WEBP_KEY, webpBytes(128), { token: await approvedToken() }));
    expect(second.status).toBe(409);
    expectCors(second);

    const object = await env.MEDIA.get(WEBP_KEY);
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(original);
  });

  it("returns 409 when R2 reports the write precondition failed", async () => {
    const calls: unknown[] = [];
    const media = {
      put: async (_key: string, _body: unknown, options: unknown) => {
        calls.push(options);
        return null;
      },
    } as unknown as R2Bucket;
    const res = await call(put(WEBP_KEY, webpBytes(), { token: await approvedToken() }), { ...env, MEDIA: media });
    expect(res.status).toBe(409);
    expect(calls).toHaveLength(1);
  });
});

describe("N5 R2 read errors", () => {
  const getWith = (error: Error, range?: string) => {
    const media = {
      get: async () => {
        throw error;
      },
    } as unknown as R2Bucket;
    const headers = new Headers({ Origin: ORIGIN });
    if (range) headers.set("Range", range);
    return call(new Request(`https://media.example/${WEBP_KEY}`, { headers }), { ...env, MEDIA: media });
  };

  it("maps R2's unsatisfiable-range error to 416", async () => {
    const res = await getWith(new Error("get: The requested range is not satisfiable (10039)"), "bytes=999-1000");
    expect(res.status).toBe(416);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns 503 + CORS for any other R2 error, even with a Range header", async () => {
    const res = await getWith(new Error("get: Internal Error (10001)"), "bytes=0-10");
    expect(res.status).toBe(503);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns 503 + CORS for an R2 error without Range", async () => {
    const res = await getWith(new Error("get: Internal Error (10001)"));
    expect(res.status).toBe(503);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("unexpected R2 write failure", () => {
  it("returns 503 + CORS instead of an uncaught 500", async () => {
    const media = {
      put: async () => {
        throw new Error("put: Internal Error (10001)");
      },
    } as unknown as R2Bucket;
    const res = await call(put(WEBP_KEY, webpBytes(), { token: await approvedToken() }), { ...env, MEDIA: media });
    expect(res.status).toBe(503);
    expectCors(res);
  });
});

