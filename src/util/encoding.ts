/**
 * Text decoding for imported files.
 *
 * `File.text()` assumes UTF-8, which quietly mangles the Cyrillic in real
 * exports: Petrel tops arrive in windows-1251 and older LAS headers in the DOS
 * codepage 866. Mojibake in a пласт name is not cosmetic — surfaces are matched
 * by name, so a mangled one silently fails to merge across wells.
 *
 * The encoding is detected rather than configured: UTF-8 first (it is
 * self-validating, so a clean strict decode is proof), then the two Cyrillic
 * codepages scored by how much plausible text each yields.
 */

const CYRILLIC = /[А-яЁё]/g;

/** Letters, digits and the punctuation that legitimately appears in these files. */
const PLAUSIBLE = /[А-яЁёA-Za-z0-9 .,;:()\-_/"'+\t\r\n=<>%№*]/g;

function score(text: string): number {
  const cyr = text.match(CYRILLIC)?.length ?? 0;
  const ok = text.match(PLAUSIBLE)?.length ?? 0;
  // Reward readable text overall, and Cyrillic especially — a wrong codepage
  // turns Russian into rare Latin-1 accents, which score poorly on both counts.
  return ok + cyr * 2;
}

/** Decode bytes, detecting UTF-8 / windows-1251 / IBM-866. */
export function decodeText(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  // UTF-8 validates itself: if a strict decode succeeds, that is what it is.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    // not UTF-8 — fall through to the Cyrillic codepages
  }

  let best = '';
  let bestScore = -1;
  for (const enc of ['windows-1251', 'ibm866', 'latin1']) {
    let text: string;
    try {
      text = new TextDecoder(enc).decode(bytes);
    } catch {
      continue;
    }
    const s = score(text);
    if (s > bestScore) { bestScore = s; best = text; }
  }
  return best.replace(/^﻿/, '');
}

/** Read a browser File with encoding detection. */
export async function readTextFile(file: File): Promise<string> {
  return decodeText(await file.arrayBuffer());
}
