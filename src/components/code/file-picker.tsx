"use client";
// "Upload file" as a text button over a hidden native file input. No `accept`
// filter, so every text file shows in the phone's picker; the guard is in upload.ts.
import { useRef, useState } from "react";
import { readCodeFiles, type CodeFile } from "@/lib/code/upload";
import { Button, IconUpload, TextButton } from "../ui";
import { userMessage } from "@/lib/ui/user-message";

export function FilePicker({
  label,
  onFiles,
  onError,
  variant,
}: {
  label: string;
  onFiles: (files: CodeFile[]) => Promise<void>;
  onError: (message: string | null) => void;
  /** "soft": a filled button with the upload icon (beside New note); a text button otherwise. */
  variant?: "soft";
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
      {variant === "soft" ? (
        <Button variant="soft" onClick={() => input.current?.click()} loading={busy}>
          {!busy && <IconUpload />}
          {label}
        </Button>
      ) : (
        <TextButton onClick={() => input.current?.click()} disabled={busy}>
          {label}
        </TextButton>
      )}
      <input ref={input} type="file" multiple hidden aria-label={label} onChange={(e) => void picked(e.target.files)} />
    </>
  );
}
