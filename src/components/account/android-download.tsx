"use client";
// "Android app": a small dialog with the download (always the newest build) and how to install it.
// A native <dialog>: Escape and the backdrop close it, and focus stays inside while it's open.
import { useRef } from "react";
import { ANDROID_APK_32_URL, ANDROID_APK_URL, ANDROID_RELEASES_URL } from "@/config/app";
import { IconDownload, TextButton } from "../ui";

export const ANDROID_LABEL = "Android app";

const STEPS = [
  "Tap Download. It’s about 145 MB, so Wi-Fi is best.",
  "Open the file when it finishes. If Android asks, allow installs from your browser or Files app.",
  "Tap Install, then sign in with the same account. Your notes are there, and they work offline.",
];

export function AndroidDownload({ className }: { className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <TextButton onClick={() => dialog.current?.showModal()} aria-haspopup="dialog" className={className}>
        {ANDROID_LABEL}
      </TextButton>
      <dialog
        ref={dialog}
        aria-labelledby="android-title"
        onClick={(e) => e.target === dialog.current && dialog.current.close()}
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-line bg-bg p-0 text-fg shadow-float backdrop:bg-black/60"
      >
        <div className="p-6">
          <h2 id="android-title" className="font-display text-[24px] leading-tight">
            Benchjot for Android
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            The same notes on your phone. Python runs on the phone, the Assistant works there too, and everything opens and saves offline.
          </p>
          <a
            href={ANDROID_APK_URL}
            download
            className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-fg px-5 font-medium text-bg transition-colors hover:bg-fg/90"
          >
            <IconDownload className="size-[18px]" />
            Download for Android
          </a>
          <p className="mt-2 text-center text-[12px] text-faint">
            Older phone?{" "}
            <a href={ANDROID_APK_32_URL} download className="underline underline-offset-2 hover:text-muted">
              Get the 32-bit version
            </a>
          </p>
          <ol className="mt-5 space-y-2.5 text-[14px] leading-relaxed text-muted">
            {STEPS.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-mono text-[12px] leading-[1.6rem] text-faint">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[12px] leading-relaxed text-faint">
            Android 8 or later. Each new build installs over the last and keeps your notes.{" "}
            <a href={ANDROID_RELEASES_URL} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-muted">
              What’s new
            </a>
          </p>
        </div>
        <div className="flex justify-end border-t border-line px-3">
          <TextButton onClick={() => dialog.current?.close()} className="px-3">
            Close
          </TextButton>
        </div>
      </dialog>
    </>
  );
}
