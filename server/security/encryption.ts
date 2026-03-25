/**
 * Field-level AES-256-GCM encryption for message content.
 *
 * Format:  enc:v1:<base64(iv)>.<base64(ciphertext+authTag)>
 * Legacy plaintext messages (no prefix) are returned as-is — zero-downtime migration.
 *
 * Key derivation:
 *   ENCRYPTION_MASTER_KEY (env, 32-byte hex)  →  HKDF-SHA256  →  AES-256-GCM key
 *   Fallback: derives from JWT_SECRET (logs a warning).
 */

const ENCRYPTION_PREFIX = 'enc:v1:'

// Cached derived key — initialised once on first use
let _cachedKey: CryptoKey | null = null

async function getDerivedKey(): Promise<CryptoKey> {
  if (_cachedKey) return _cachedKey

  const masterKeyHex = process.env.ENCRYPTION_MASTER_KEY
  let rawKeyMaterial: Uint8Array

  if (!masterKeyHex) {
    // Fallback: derive key material from JWT_SECRET so no data is ever stored as
    // truly bare plaintext, but warn loudly that this is not production-grade.
    const jwtSecret = process.env.JWT_SECRET || 'mlsendger-secret'
    const encoded = new TextEncoder().encode(jwtSecret + ':enc-key-derivation:v1')
    const hash = await crypto.subtle.digest('SHA-256', encoded)
    rawKeyMaterial = new Uint8Array(hash)
    console.warn(
      '[Security] ENCRYPTION_MASTER_KEY is not set. ' +
      'Using a key derived from JWT_SECRET. ' +
      'Set ENCRYPTION_MASTER_KEY (run: openssl rand -hex 32) for production.'
    )
  } else {
    if (masterKeyHex.length !== 64) {
      throw new Error('ENCRYPTION_MASTER_KEY must be 64 hex characters (32 bytes)')
    }
    rawKeyMaterial = hexToBytes(masterKeyHex)
  }

  // Import raw bytes as an HKDF key
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    rawKeyMaterial,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  )

  // Derive a dedicated AES-256-GCM key for message content
  const salt = new TextEncoder().encode('mlsendger:message-content:salt:v1')
  const info = new TextEncoder().encode('mlsendger:message-content:aes-gcm:v1')

  _cachedKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )

  return _cachedKey
}

/**
 * Encrypt a plaintext string. Returns enc:v1:... prefixed ciphertext.
 */
export async function encrypt(plaintext: string): Promise<string> {
  const key = await getDerivedKey()
  const iv = crypto.getRandomValues(new Uint8Array(12)) // 96-bit IV for GCM

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext)
  )

  // AES-GCM output = ciphertext || 16-byte auth tag (appended by WebCrypto)
  return ENCRYPTION_PREFIX + bytesToBase64(iv) + '.' + bytesToBase64(new Uint8Array(ciphertextBuf))
}

/**
 * Decrypt a ciphertext string produced by encrypt().
 * If the string does NOT start with the enc:v1: prefix, it is assumed to be
 * legacy plaintext and returned as-is (backward-compatible migration path).
 */
export async function decrypt(value: string): Promise<string> {
  if (!value.startsWith(ENCRYPTION_PREFIX)) {
    return value // legacy plaintext — pass through
  }

  const key = await getDerivedKey()
  const encoded = value.slice(ENCRYPTION_PREFIX.length)
  const dotIndex = encoded.indexOf('.')
  if (dotIndex === -1) throw new Error('[Encryption] Malformed ciphertext: missing separator')

  const iv = base64ToBytes(encoded.slice(0, dotIndex))
  const ct = base64ToBytes(encoded.slice(dotIndex + 1))

  const plaintextBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    ct
  )

  return new TextDecoder().decode(plaintextBuf)
}

/**
 * Returns true if the value is an encrypted ciphertext produced by this module.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTION_PREFIX)
}

/**
 * Convenience: decrypt the content field of a message object in place.
 * Returns the same object reference with content replaced.
 */
export async function decryptMessage<T extends { content: string }>(msg: T): Promise<T> {
  msg.content = await decrypt(msg.content)
  return msg
}

/**
 * Convenience: decrypt an array of message objects.
 */
export async function decryptMessages<T extends { content: string }>(msgs: T[]): Promise<T[]> {
  return Promise.all(msgs.map(decryptMessage))
}

// ── Warm up: initialise key at module load time so first request is instant ──
getDerivedKey().catch((err) => {
  console.error('[Security] Failed to initialise encryption key:', err?.message || err)
  process.exit(1)
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
