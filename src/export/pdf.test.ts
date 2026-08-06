import { describe, it, expect } from 'vitest';
import { jpegToPdf } from './pdf';

// Arbitrary valid base64 payload — the structure/xref checks don't decode the
// image, only wrap its bytes, so a real JPEG isn't needed here.
const JPEG_1x1 = 'data:image/jpeg;base64,SGVsbG9KUEVHUGF5bG9hZA==';

async function pdfText(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

describe('jpegToPdf', () => {
  it('produces a structurally valid single-page PDF', async () => {
    const blob = jpegToPdf(JPEG_1x1, 1720, 1262);
    expect(blob.type).toBe('application/pdf');
    const s = await pdfText(blob);

    expect(s.startsWith('%PDF-1.3')).toBe(true);
    expect(s).toContain('/DCTDecode');
    expect(s).toContain('/MediaBox [0 0 860 631]'); // half of 1720×1262
    expect(s).toContain('trailer');
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('has a correct cross-reference table (offsets point at their objects)', async () => {
    const s = await pdfText(jpegToPdf(JPEG_1x1, 100, 100));

    const startxref = Number(s.slice(s.lastIndexOf('startxref') + 9).trim().split(/\s/)[0]);
    expect(s.slice(startxref, startxref + 4)).toBe('xref');

    // Parse the "NNNNNNNNNN 00000 n" entries and verify each points at "<i> 0 obj".
    const entries = [...s.slice(startxref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(5); // objects 1..5
    entries.forEach((off, i) => {
      expect(s.slice(off).startsWith(`${i + 1} 0 obj`)).toBe(true);
    });
  });
});
