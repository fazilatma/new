/**
 * WebCrypto replacements for the Python `cryptography.Fernet` + `hashlib.pbkdf2_hmac`
 * primitives used by agent-python/app/config.py and app/security.py.
 *
 * Secret envelope format:  `enc:` + base64( 12-byte IV || AES-256-GCM ciphertext )
 * (Fernet-compatible on purpose is impossible in Workers; the envelope is
 *  versioned by its own prefix so decryption stays unambiguous.)
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function randomHex(nBytes: number): string {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

/** Equivalent of Python `secrets.token_urlsafe(n)`. */
export function randomUrlSafe(nBytes: number): string {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return bytesToBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function uuidHex(n = 8): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, n);
}

/** Constant-time string comparison (`hmac.compare_digest`). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Always compare a fixed amount of work to avoid length leaks on short inputs.
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

const keyCache = new Map<string, CryptoKey>();

async function getAesKey(masterKey: string): Promise<CryptoKey> {
  const cached = keyCache.get(masterKey);
  if (cached) return cached;
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(masterKey));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  keyCache.set(masterKey, key);
  return key;
}

/** Port of config.encrypt_secret. Idempotent for already-encrypted values. */
export async function encryptSecret(plain: string, masterKey: string): Promise<string> {
  if (!plain) return '';
  if (plain.startsWith('enc:')) return plain;
  if (!masterKey) return plain;
  const key = await getAesKey(masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)),
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return `enc:${bytesToBase64(packed)}`;
}

/** Port of config.decrypt_secret. Returns '' when the payload cannot be opened. */
export async function decryptSecret(cipher: string, masterKey: string): Promise<string> {
  if (!cipher) return '';
  if (!cipher.startsWith('enc:')) return cipher;
  if (!masterKey) return '';
  try {
    const packed = base64ToBytes(cipher.slice(4));
    const iv = packed.subarray(0, 12);
    const ct = packed.subarray(12);
    const key = await getAesKey(masterKey);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return dec.decode(pt);
  } catch {
    return '';
  }
}

/** Port of config.mask_secret. */
export async function maskSecret(value: string, masterKey: string): Promise<string> {
  if (!value) return '';
  const decrypted = value.startsWith('enc:') ? await decryptSecret(value, masterKey) : value;
  if (!decrypted) return '';
  if (decrypted.length <= 8) return '••••••••';
  return `${decrypted.slice(0, 3)}••••••••${decrypted.slice(-4)}`;
}

const PBKDF2_ITERATIONS = 100000;

/** Port of security.hash_password (PBKDF2-HMAC-SHA256, 100k iterations). */
export async function hashPassword(
  password: string,
  salt?: string,
): Promise<{ hash: string; salt: string }> {
  const useSalt = salt || randomHex(16);
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(useSalt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    256,
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: useSalt };
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
  salt: string,
): Promise<boolean> {
  const { hash } = await hashPassword(password, salt);
  return timingSafeEqual(hash, passwordHash);
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return bytesToHex(new Uint8Array(d));
}
