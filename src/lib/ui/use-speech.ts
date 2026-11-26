"use client";
// Dictation with the browser's own speech recognition (the Web Speech API; Chrome, Edge, Safari,
// Chrome on Android): no account, no credits, nothing to connect. Tap to start; the words appear as
// they are heard; tap Done (or it stops by itself at VOICE_LIMITS.maxSeconds, or when the browser
// stops listening) and they are handed over. The microphone is on only while listening.
// Chrome sends the audio to Google's speech service to do this, Safari to Apple's.
import { useEffect, useRef, useState } from "react";
import { VOICE_LIMITS } from "@/config/app";

type Listening =
  | { state: "idle" }
  | { state: "listening"; seconds: number; heard: string }
  | { state: "denied"; message: string };

const MIC_DENIED = "Benchjot can’t use the microphone. Allow it for this site in your browser’s settings, then try again.";
const NO_SPEECH = "Nothing was heard. Tap the microphone and try again.";
const NEEDS_CONNECTION = "Speech to text needs a connection in this browser. Type your request instead.";
const CANT_LISTEN = "Speech to text didn’t work just now. Try again, or type your request.";

/* The parts of the Web Speech API used here (not in TypeScript's DOM types). */
type Alternative = { transcript: string };
type Result = { isFinal: boolean; 0: Alternative };
type ResultEvent = { resultIndex: number; results: ArrayLike<Result> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this browser has speech recognition (Firefox and some in-app browsers don't: they type). */
export const canListen = () => recognitionCtor() !== null;

/**
 * Joins what was heard so far: the settled words, then the ones still being heard. Chrome on
 * Android hands back each growing guess as a result of its own ("wait", "wait can", "wait can you"…),
 * so a result that carries on the one before replaces it instead of repeating it.
 */
export function joinHeard(results: ArrayLike<Result>): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const t = results[i]![0].transcript.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const last = parts.at(-1);
    if (last !== undefined && t.toLowerCase().startsWith(last.toLowerCase())) parts[parts.length - 1] = t;
    else if (last !== undefined && last.toLowerCase().startsWith(t.toLowerCase())) continue;
    else parts.push(t);
  }
  return parts.join(" ");
}

export function useSpeech(onText: (text: string) => void) {
  const [state, setState] = useState<Listening>({ state: "idle" });
  const rec = useRef<Recognition | null>(null);
  const heard = useRef("");
  const outcome = useRef<"deliver" | "cancel">("deliver");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const deliver = useRef(onText);
  deliver.current = onText;

  function stopTimer() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }
  useEffect(() => () => (stopTimer(), rec.current?.abort()), []);

  function start() {
    if (rec.current) return;
    const Ctor = recognitionCtor();
    if (!Ctor) return setState({ state: "denied", message: CANT_LISTEN });
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    heard.current = "";
    outcome.current = "deliver";
    let problem: string | null = null;
    r.onresult = (e) => {
      heard.current = joinHeard(e.results);
      setState((s) => (s.state === "listening" ? { ...s, heard: heard.current } : s));
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") problem = MIC_DENIED;
      else if (e.error === "network") problem = NEEDS_CONNECTION;
      else if (e.error === "no-speech") problem = NO_SPEECH;
      else if (e.error !== "aborted") problem = CANT_LISTEN;
    };
    r.onend = () => {
      stopTimer();
      rec.current = null;
      const text = heard.current;
      if (outcome.current === "cancel") return setState({ state: "idle" });
      if (text) {
        setState({ state: "idle" });
        deliver.current(text);
      } else setState(problem ? { state: "denied", message: problem } : { state: "denied", message: NO_SPEECH });
    };
    rec.current = r;
    try {
      r.start();
    } catch {
      rec.current = null;
      return setState({ state: "denied", message: CANT_LISTEN });
    }
    const began = Date.now();
    setState({ state: "listening", seconds: 0, heard: "" });
    timer.current = setInterval(() => {
      const seconds = Math.floor((Date.now() - began) / 1000);
      if (seconds >= VOICE_LIMITS.maxSeconds) return finish();
      setState((s) => (s.state === "listening" ? { ...s, seconds } : s));
    }, 250);
  }

  /** Stops listening; what was heard is handed over. */
  function finish() {
    stopTimer();
    rec.current?.stop();
  }

  /** Stops listening and throws the words away. */
  function cancel() {
    outcome.current = "cancel";
    stopTimer();
    rec.current?.abort();
  }

  return { state, start, finish, cancel, clear: () => setState({ state: "idle" }) };
}
