import { createHash } from 'node:crypto';

// node:crypto (not Bun.CryptoHasher) so this works under both runtimes — the
// review app runs under Node where the Bun global is undefined.
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
