// ============================================================================
// Utilitaires cryptographiques (Web Crypto API - compatible Cloudflare Workers)
// - Hachage de mot de passe : PBKDF2-SHA256 (100 000 itérations, 32 octets)
// - Jetons de session : JWT maison signé en HMAC-SHA256 (HS256)
// ============================================================================

const PBKDF2_ITERATIONS = 100000
const KEY_LENGTH_BYTES = 32

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return bufToHex(bytes.buffer)
}

async function pbkdf2(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits'
  ])
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBuf(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    KEY_LENGTH_BYTES * 8
  )
  return bufToHex(derived)
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomHex(16)
  const hash = await pbkdf2(password, salt)
  return { hash, salt }
}

/**
 * Génère un mot de passe aléatoire lisible (sans caractères ambigus 0/O/1/l/I)
 * utilisé pour créer automatiquement les identifiants d'un compte de classe.
 */
export function generateRandomPassword(length = 10): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length]
  }
  return out
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const computed = await pbkdf2(password, salt)
  return computed === hash
}

// ----------------------------------------------------------------------------
// JWT maison (HS256) - base64url(header).base64url(payload).base64url(signature)
// ----------------------------------------------------------------------------

function base64UrlEncode(input: string | ArrayBuffer): string {
  let bytes: Uint8Array
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input)
  } else {
    bytes = new Uint8Array(input)
  }
  let binary = ''
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad
  const binary = atob(base64)
  return binary
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return base64UrlEncode(sig)
}

export async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const headerB64 = base64UrlEncode(JSON.stringify(header))
  const payloadB64 = base64UrlEncode(JSON.stringify(payload))
  const signature = await hmacSign(`${headerB64}.${payloadB64}`, secret)
  return `${headerB64}.${payloadB64}.${signature}`
}

export async function verifyJWT<T = any>(token: string, secret: string): Promise<T | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, signature] = parts
  const expectedSig = await hmacSign(`${headerB64}.${payloadB64}`, secret)
  if (expectedSig !== signature) return null
  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64)) as T & { exp?: number }
    if (payload.exp && Date.now() / 1000 > payload.exp) return null
    return payload as T
  } catch {
    return null
  }
}
