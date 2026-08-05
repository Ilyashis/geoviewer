/** Trigger a browser download of text content. */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob(['﻿' + text], { type: mime }); // BOM so Excel reads UTF-8
  triggerDownload(filename, URL.createObjectURL(blob), true);
}

/** Trigger a browser download from a data/object URL. */
export function triggerDownload(filename: string, url: string, revoke = false): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(url), 0);
}
