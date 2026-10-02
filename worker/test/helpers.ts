// Khoá RSA sinh trong test + giả lập outbound fetch (JWKS Google, Firestore REST).
// Worker không có đường nào nhận khoá test: test chỉ đổi câu trả lời của fetch.

import { env } from "cloudflare:test";
import { vi } from "vitest";
import worker from "../src/index";
import { resetKeyCache } from "../src/auth";

export const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
export const FIRESTORE_ACCESS =
  "https://firestore.googleapis.com/v1/projects/thien-phuong-wedding-1025/databases/(default)/documents/accessRequests/";
export const PROJECT = "thien-phuong-wedding-1025";
export const ISS = "https://securetoken.google.com/thien-phuong-wedding-1025";
export const ORIGIN = "https://phucanh08.github.io";
export const KID = "test-kid-1";

export const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
export const WEBP_KEY = `content/${UUID}-large.webp`;
export const MB = 1024 * 1024;

export interface Signer {
  privateKey: CryptoKey;
  publicJwk: JsonWebKey & { kid: string };
}

export async function makeSigner(kid = KID): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return { privateKey: pair.privateKey, publicJwk: { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", use: "sig", kid } };
}

function b64url(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const b of data) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const t = now();
  return {
    iss: ISS,
    aud: PROJECT,
    auth_time: t - 60,
    user_id: "uid-approved",
    sub: "uid-approved",
    iat: t - 30,
    exp: t + 3600,
    email: "editor@example.com",
    email_verified: true,
    ...overrides,
  };
}

export async function signToken(
  signer: Signer,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: signer.publicJwk.kid, typ: "JWT" },
): Promise<string> {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer.privateKey, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(signature))}`;
}

function subjectOf(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json).sub;
}

export interface FakeNetwork {
  jwks: () => Response;
  // uid -> status của accessRequests/{uid}; vắng = doc không tồn tại.
  accessStatus: Map<string, string>;
  firestoreFailure?: number;
  requestedUrls: string[];
}

// Firestore giả: chỉ trả doc khi token trong Authorization là của chính uid đó (rules C5).
export function installFakeNetwork(signer: Signer): FakeNetwork {
  resetKeyCache();
  const net: FakeNetwork = {
    jwks: () => Response.json({ keys: [signer.publicJwk] }, { headers: { "Cache-Control": "public, max-age=3600" } }),
    accessStatus: new Map(),
    requestedUrls: [],
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    net.requestedUrls.push(request.url);
    if (request.url === JWKS_URL) return net.jwks();
    if (request.url.startsWith(FIRESTORE_ACCESS)) {
      if (net.firestoreFailure) return new Response("upstream error", { status: net.firestoreFailure });
      const uid = decodeURIComponent(request.url.slice(FIRESTORE_ACCESS.length));
      const auth = request.headers.get("Authorization") ?? "";
      const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (subjectOf(bearer) !== uid) {
        return Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: 403 });
      }
      const status = net.accessStatus.get(uid);
      if (status === undefined) return Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 });
      return Response.json({
        name: `projects/${PROJECT}/databases/(default)/documents/accessRequests/${uid}`,
        fields: { status: { stringValue: status }, email: { stringValue: "editor@example.com" } },
      });
    }
    throw new Error(`unexpected outbound fetch: ${request.url}`);
  });
  return net;
}

export async function call(request: Request, bindings: Env = env): Promise<Response> {
  return worker.fetch(request, bindings);
}

export function webpBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, size - 8, true);
  bytes.set(new TextEncoder().encode("WEBPVP8 "), 8);
  for (let i = 16; i < size; i++) bytes[i] = i % 251;
  return bytes;
}

export function mp3Bytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("ID3"), 0);
  bytes[3] = 4;
  return bytes;
}

export function m4aBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, 24);
  bytes.set(new TextEncoder().encode("ftypM4A "), 4);
  return bytes;
}

export function pngBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

export function put(
  key: string,
  body: Uint8Array | ReadableStream | null,
  opts: { token?: string; type?: string; length?: string | null; origin?: string | null } = {},
): Request {
  const headers = new Headers({ "Content-Type": opts.type ?? "image/webp" });
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  if (opts.origin !== null) headers.set("Origin", opts.origin ?? ORIGIN);
  const length = opts.length === undefined ? (body instanceof Uint8Array ? String(body.byteLength) : null) : opts.length;
  if (length !== null) headers.set("Content-Length", length);
  return new Request(`https://media.example/${key}`, { method: "PUT", headers, body });
}

export function del(key: string, opts: { token?: string; origin?: string | null } = {}): Request {
  const headers = new Headers();
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  if (opts.origin !== null) headers.set("Origin", opts.origin ?? ORIGIN);
  return new Request(`https://media.example/${key}`, { method: "DELETE", headers });
}
