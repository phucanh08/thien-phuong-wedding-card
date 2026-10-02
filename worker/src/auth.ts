// Xác thực Firebase ID token và quyền admin theo C5/C6 (CLAUDE.md).
//
// Khoá công khai luôn lấy từ endpoint cố định của Google bên dưới; không có biến
// môi trường hay binding nào đổi được nguồn khoá. Test thay khoá bằng cách chặn
// outbound fetch, không phải bằng đường riêng trong code.

export const PROJECT_ID = "thien-phuong-wedding-1025";
export const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
export const GOOGLE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const FIRESTORE_DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const SUPER_ADMIN_GOOGLE = "phucanhdn01@gmail.com";
const SUPER_ADMIN_PASSWORD = "admin@thien-phuong-wedding.local";

// Lệch đồng hồ chấp nhận cho iat/auth_time; exp không có dung sai.
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LENGTH = 4096;

export interface IdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
}

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    message: string,
  ) {
    super(message);
  }
}

// Cache khoá dùng chung giữa các request (không phải state của request).
let keyCache: { keys: Map<string, CryptoKey>; expiresAt: number } | null = null;

export function resetKeyCache(): void {
  keyCache = null;
}

function maxAgeSeconds(cacheControl: string | null): number {
  const match = cacheControl?.match(/(?:^|[,\s])max-age=(\d+)/i);
  return match ? Number(match[1]) : 0;
}

async function googleKeys(): Promise<Map<string, CryptoKey>> {
  if (keyCache && Date.now() < keyCache.expiresAt) return keyCache.keys;

  let response: Response;
  try {
    response = await fetch(GOOGLE_JWKS_URL);
  } catch {
    throw new AuthError(503, "public keys unavailable");
  }
  if (!response.ok) throw new AuthError(503, "public keys unavailable");

  // Nguồn khoá trả rác (không phải JSON, JWK sai) là lỗi phía Google, không phải của token.
  const keys = new Map<string, CryptoKey>();
  try {
    const body = (await response.json()) as { keys?: JsonWebKey[] };
    for (const jwk of body.keys ?? []) {
      const kid = (jwk as JsonWebKey & { kid?: string }).kid;
      if (jwk.kty !== "RSA" || typeof kid !== "string") continue;
      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      keys.set(kid, key);
    }
  } catch {
    throw new AuthError(503, "public keys unavailable");
  }
  keyCache = {
    keys,
    expiresAt: Date.now() + maxAgeSeconds(response.headers.get("Cache-Control")) * 1000,
  };
  return keys;
}

function base64UrlDecode(segment: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(segment)) throw new AuthError(401, "malformed token");
  // Độ dài ≡ 1 (mod 4) không phải base64url hợp lệ.
  if (segment.length % 4 === 1) throw new AuthError(401, "malformed token");
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    throw new AuthError(401, "malformed token");
  }
}

function decodeJson(segment: string): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder().decode(base64UrlDecode(segment)));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {
    // rơi xuống lỗi chung bên dưới
  }
  throw new AuthError(401, "malformed token");
}

export function bearerToken(request: Request): string {
  const header = request.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer ([A-Za-z0-9_.-]+)$/);
  if (!match || match[1].length > MAX_TOKEN_LENGTH) {
    throw new AuthError(401, "missing bearer token");
  }
  return match[1];
}

// Kiểm chữ ký trước, rồi mới đọc claim từ payload.
export async function verifyIdToken(token: string): Promise<IdTokenClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError(401, "malformed token");
  const [headerPart, payloadPart, signaturePart] = parts;

  const header = decodeJson(headerPart);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new AuthError(401, "unsupported token header");
  }
  const key = (await googleKeys()).get(header.kid);
  if (!key) throw new AuthError(401, "unknown key id");

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) throw new AuthError(401, "invalid signature");

  const claims = decodeJson(payloadPart);
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== PROJECT_ID) throw new AuthError(401, "invalid audience");
  if (claims.iss !== ISSUER) throw new AuthError(401, "invalid issuer");
  if (typeof claims.exp !== "number" || claims.exp <= now) {
    throw new AuthError(401, "token expired");
  }
  if (typeof claims.iat !== "number" || claims.iat > now + CLOCK_SKEW_SECONDS) {
    throw new AuthError(401, "invalid issued-at");
  }
  if (typeof claims.auth_time !== "number" || claims.auth_time > now + CLOCK_SKEW_SECONDS) {
    throw new AuthError(401, "invalid auth_time");
  }
  // Chỉ ký tự uid Firebase: chặn "..", "/" làm đổi đường dẫn Firestore.
  if (typeof claims.sub !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(claims.sub)) {
    throw new AuthError(401, "invalid subject");
  }
  return {
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    email_verified: claims.email_verified === true,
  };
}

export function isSuperAdmin(claims: IdTokenClaims): boolean {
  return (
    (claims.email === SUPER_ADMIN_GOOGLE && claims.email_verified === true) ||
    claims.email === SUPER_ADMIN_PASSWORD
  );
}

// accessRequests/{uid}.status == "approved", đọc bằng chính token của người gọi.
async function isApproved(uid: string, token: string): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(`${FIRESTORE_DOCS}/accessRequests/${encodeURIComponent(uid)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new AuthError(503, "access check unavailable");
  }
  if (response.status === 404 || response.status === 403) return false;
  if (!response.ok) throw new AuthError(503, "access check unavailable");
  let doc: { name?: unknown; fields?: { status?: { stringValue?: string } } };
  try {
    doc = await response.json();
  } catch {
    throw new AuthError(503, "access check unavailable");
  }
  // Doc trả về phải đúng là accessRequests/<uid> của người gọi.
  if (typeof doc.name !== "string" || !doc.name.endsWith(`/documents/accessRequests/${uid}`)) return false;
  return doc.fields?.status?.stringValue === "approved";
}

// Trả claims khi người gọi là admin; ném AuthError (401/403/503) khi không.
export async function requireAdmin(request: Request): Promise<IdTokenClaims> {
  const token = bearerToken(request);
  const claims = await verifyIdToken(token);
  if (isSuperAdmin(claims)) return claims;
  if (await isApproved(claims.sub, token)) return claims;
  throw new AuthError(403, "not an admin");
}
