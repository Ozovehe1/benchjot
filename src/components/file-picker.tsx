"use client";
// "Upload file" as a text button over a hidden native file input. No `accept`
// filter, so every text file shows in the phone's picker; the guard is in upload.ts.
import { useRef, useState } from "react";
import { readCodeFiles, type CodeFile } from "@/lib/upload";
import { TextButton } from "./ui";
import { userMessage } from "@/lib/user-message";

export function FilePicker({
  label,
  onFiles,
  onError,
}: {
  label: string;
  onFiles: (files: CodeFile[]) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function picked(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    onError(null);
    try {
      const { files, errors } = await readCodeFiles(Array.from(list));
      if (files.length) await onFiles(files);
      onError(errors.length ? errors.join(" ") : null);
    } catch (e) {
      onError(userMessage(e, "upload"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <TextButton onClick={() => input.current?.click()} disabled={busy}>
        {label}
      </TextButton>
      <input ref={input} type="file" multiple hidden aria-label={label} onChange={(e) => void picked(e.target.files)} />
    </>
  );
}
