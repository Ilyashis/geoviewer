import { describe, it, expect } from 'vitest';
import { decodeText } from './encoding';

const bytes = (text: string, enc: 'windows-1251' | 'ibm866'): Uint8Array => {
  // Encode by round-tripping through the decoder's table: find the byte whose
  // decoding equals each character. Small alphabet, so a lookup is enough.
  const dec = new TextDecoder(enc);
  const table = new Map<string, number>();
  for (let b = 0; b < 256; b++) table.set(dec.decode(new Uint8Array([b])), b);
  return new Uint8Array([...text].map((c) => table.get(c) ?? 0x3f));
};

describe('decodeText', () => {
  it('reads UTF-8 as-is', () => {
    expect(decodeText(new TextEncoder().encode('БС8-1_TOP_S'))).toBe('БС8-1_TOP_S');
  });

  it('strips a UTF-8 BOM', () => {
    expect(decodeText(new TextEncoder().encode('﻿Well'))).toBe('Well');
  });

  it('recovers Cyrillic written in windows-1251', () => {
    // The Petrel tops case: decoded as UTF-8 this would throw or mangle.
    expect(decodeText(bytes('БС8-1_TOP_S', 'windows-1251'))).toBe('БС8-1_TOP_S');
  });

  it('recovers Cyrillic written in the DOS codepage 866', () => {
    // The old LAS header case: "НЕФТЯНАЯ КОМПАНИЯ" in CP866.
    expect(decodeText(bytes('НЕФТЯНАЯ КОМПАНИЯ', 'ibm866'))).toBe('НЕФТЯНАЯ КОМПАНИЯ');
  });

  it('does not disturb pure ASCII whatever the codepage', () => {
    expect(decodeText(bytes('WELL. 2029 : 2029', 'windows-1251'))).toBe('WELL. 2029 : 2029');
  });
});
