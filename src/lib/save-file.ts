"use client";
// Saves a file to the device: a blob download in the browser (phones put it in Downloads).

export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveText(name: string, content: string, type = "text/plain;charset=utf-8") {
  saveBlob(name, new Blob([content], { type }));
}
