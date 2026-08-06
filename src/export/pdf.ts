/**
 * Minimal single-page PDF that embeds one JPEG image — no dependency.
 * The plate export is rasterised to JPEG (opaque dark background, so no alpha
 * is needed) and wrapped as a DCTDecode image XObject filling the page.
 */

/** Decode a `data:image/jpeg;base64,...` URL to raw bytes. */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Build a one-page PDF (Blob) embedding the given JPEG at the given pixel size. */
export function jpegToPdf(jpegDataUrl: string, imgW: number, imgH: number): Blob {
  const jpeg = dataUrlToBytes(jpegDataUrl);
  // Page in points: half the (2×) raster so it prints near CSS size.
  const pw = Math.round(imgW / 2);
  const ph = Math.round(imgH / 2);

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (data: Uint8Array | string) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(b);
    pos += b.length;
  };
  const obj = (n: number, body: string) => { offsets[n] = pos; push(`${n} 0 obj\n${body}\nendobj\n`); };

  push('%PDF-1.3\n%\xFF\xFF\xFF\xFF\n');

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}]` +
    ` /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);

  // Image XObject with the raw JPEG stream.
  offsets[4] = pos;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH}` +
    ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');

  const content = `q\n${pw} 0 0 ${ph} 0 0 cm\n/Im0 Do\nQ\n`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}endstream`);

  const xrefPos = pos;
  const count = 6;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}
