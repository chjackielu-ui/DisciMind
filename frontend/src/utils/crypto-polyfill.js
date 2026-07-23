import { safeRandomId } from './random-id.js'

export function installCryptoRandomUuidFallback() {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi || typeof cryptoApi.randomUUID === 'function') return
  try {
    Object.defineProperty(cryptoApi, 'randomUUID', {
      configurable: true,
      value: () => safeRandomId('uuid'),
    })
  } catch {
    // Some browsers expose a non-extensible Crypto object. App code uses safeRandomId directly.
  }
}
