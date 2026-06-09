import LZString from "lz-string";

const PREFIX = "doc=";
/** Practical URL length ceiling before we warn (R-20). */
export const MAX_HASH_LENGTH = 8000;

/** Compress a document into a URL-hash-safe token. Pure. */
export function encodeDoc(source: string): string {
  return LZString.compressToEncodedURIComponent(source);
}

/** Inverse of {@link encodeDoc}. Returns null on garbage. */
export function decodeDoc(token: string): string | null {
  const out = LZString.decompressFromEncodedURIComponent(token);
  return out ? out : null;
}

/** Build the full `#doc=…` fragment for a document. */
export function docToHash(source: string): string {
  return `#${PREFIX}${encodeDoc(source)}`;
}

/** Extract a document from a location hash (`#doc=…`), or null. */
export function hashToDoc(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(PREFIX)) return null;
  return decodeDoc(raw.slice(PREFIX.length));
}

/** Whether the encoded form is small enough to share as a link (R-20). */
export function isShareable(source: string): boolean {
  return docToHash(source).length <= MAX_HASH_LENGTH;
}
