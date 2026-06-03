export function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}
