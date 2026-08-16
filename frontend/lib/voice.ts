import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice command parsing + Web Speech API wrapper for the POS screen.
 *
 * `useVoice` is push-to-talk by default: press the mic, speak one natural
 * phrase, and the final transcript is delivered through `onCommand`. There is
 * no wake word and no continuous background listening. The transcript should
 * be fed straight into the NL engine (`lib/nlp/understand`), not parsed here.
 *
 * Supported phrases:
 *   "Coca Cola"
 *   "SKU 12345"
 *   "barcode 8901234567890"
 *   "two Coca Cola"
 *   "add five bottles"
 *   "search milk"
 *
 * Quantity words: one..ten, eleven, twelve, fifteen, twenty, thirty, forty,
 * fifty, sixty, seventy, eighty, ninety, hundred, plus plain digits.
 */

const QUANTITY_WORDS: Record<string, number> = {
  one: 1,
  a: 1,
  an: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

const LEAD_WORDS = [
  "search",
  "find",
  "look for",
  "looking for",
  "add",
  "scan",
  "get",
  "please",
];

const CODE_KEYWORDS = ["sku", "barcode", "bar code", "serial"];

export interface VoiceCommand {
  /** Parsed quantity (1 if none was spoken). */
  qty: number;
  /** Recognized product term (name, SKU or barcode). */
  term: string;
  /** The raw transcript. */
  raw: string;
  /** True when the transcript explicitly names a SKU/barcode field. */
  codeType: "sku" | "barcode" | null;
}

function cleanTerm(s: string): string {
  return s.trim().replace(/[.!?]+$/g, "").trim();
}

export function parseTranscript(raw: string): VoiceCommand {
  let text = (raw ?? "").trim();
  let qty = 1;
  let codeType: VoiceCommand["codeType"] = null;

  // Strip leading lead-words ("search", "add", ...) repeatedly.
  const lower = text.toLowerCase();
  for (const lead of LEAD_WORDS) {
    if (lower.startsWith(lead)) {
      text = text.slice(lead.length).trim();
      break;
    }
  }

  // Code keywords: "sku 12345", "barcode 890...".
  const codeMatch = CODE_KEYWORDS.find((k) =>
    text.toLowerCase().startsWith(k)
  );
  if (codeMatch) {
    const rest = text.slice(codeMatch.length).trim();
    const first = text.toLowerCase().split(/\s+/)[0];
    return {
      qty,
      term: cleanTerm(rest),
      raw,
      codeType: first === "sku" ? "sku" : "barcode",
    };
  }

  // "two Coca Cola" / "add five bottles" / "1 charger".
  const tokens = text.split(/\s+/);
  const firstToken = tokens[0]?.toLowerCase();
  const firstNum = parseInt(firstToken ?? "", 10);
  if (!Number.isNaN(firstNum) && firstNum > 0) {
    const rest = tokens.slice(1).join(" ").trim();
    return {
      qty: firstNum,
      term: cleanTerm(rest || text),
      raw,
      codeType: null,
    };
  }
  if (firstToken && firstToken in QUANTITY_WORDS) {
    const rest = tokens.slice(1).join(" ").trim();
    return {
      qty: QUANTITY_WORDS[firstToken],
      term: cleanTerm(rest || text),
      raw,
      codeType: null,
    };
  }
  // Trailing numeric: "charger 5" or "milk two".
  const lastToken = tokens[tokens.length - 1]?.toLowerCase();
  const lastNum = parseInt(lastToken ?? "", 10);
  if (tokens.length > 1 && !Number.isNaN(lastNum) && lastNum > 0) {
    const rest = tokens.slice(0, -1).join(" ").trim();
    return {
      qty: lastNum,
      term: cleanTerm(rest),
      raw,
      codeType: null,
    };
  }
  if (tokens.length > 1 && lastToken && lastToken in QUANTITY_WORDS) {
    const rest = tokens.slice(0, -1).join(" ").trim();
    return {
      qty: QUANTITY_WORDS[lastToken],
      term: cleanTerm(rest),
      raw,
      codeType: null,
    };
  }

  return { qty: 1, term: cleanTerm(text), raw, codeType: null };
}

// ── Web Speech API hook ─────────────────────────────────────────────────

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceState =
  | { status: "unsupported" }
  | { status: "idle" }
  | { status: "listening"; interim: string }
  | { status: "processing" }
  | { status: "error"; message: string };

export interface UseVoiceOptions {
  onCommand: (command: VoiceCommand) => void;
  /**
   * Hands-free mode: keep listening continuously and only act when the
   * utterance starts with (or contains) the wake phrase.
   */
  handsFree?: boolean;
  /** Wake phrase used in hands-free mode (e.g. "hey pos"). */
  wakePhrase?: string;
}

export function useVoice({
  onCommand,
  handsFree = false,
  wakePhrase = "hey pos",
}: UseVoiceOptions) {
  const [state, setState] = useState<VoiceState>({ status: "idle" });
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const handsFreeRef = useRef(handsFree);
  handsFreeRef.current = handsFree;
  const wakeRef = useRef(wakePhrase.trim().toLowerCase() || "hey pos");
  wakeRef.current = wakePhrase.trim().toLowerCase() || "hey pos";
  const manuallyStoppedRef = useRef(false);
  /** Hands-free: final transcripts accumulate across chunks ("hey pos" then "add 3 pepsi"). */
  const pendingHandsFreeRef = useRef("");
  const pendingHandsFreeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  /** Push-to-talk: briefly shows "processing" before the command is dispatched. */
  const processingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const Ctor = getSpeechRecognition();
  const supported = Ctor !== null;

  const clearProcessingTimer = useCallback(() => {
    if (processingTimerRef.current) {
      clearTimeout(processingTimerRef.current);
      processingTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    manuallyStoppedRef.current = true;
    clearProcessingTimer();
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setState((prev) =>
      prev.status === "listening" || prev.status === "processing"
        ? { status: "idle" }
        : prev
    );
  }, [clearProcessingTimer]);

  /**
   * Hands-free: act on the utterance only when it names the wake phrase.
   * Returns true when a command was dispatched (buffer should be cleared).
   */
  const processHandsFree = useCallback((utterance: string): boolean => {
    const text = utterance.trim();
    if (!text) return false;
    const wake = wakeRef.current;
    const idx = text.toLowerCase().indexOf(wake);
    if (idx === -1) return false;
    const remainder = text
      .slice(idx + wake.length)
      .replace(/^[,:\s]+/, "")
      .trim();
    if (!remainder) return false;
    onCommandRef.current(parseTranscript(remainder));
    return true;
  }, []);

  const start = useCallback(() => {
    const CtorNow = getSpeechRecognition();
    if (!CtorNow) {
      setState({
        status: "error",
        message: "Voice search is not supported in this browser.",
      });
      return;
    }
    stop();
    manuallyStoppedRef.current = false;
    let settled = false;
    let finalTranscript = "";
    const handsFreeMode = handsFreeRef.current;

    const rec = new CtorNow();
    rec.lang = "en-US";
    rec.continuous = handsFreeMode;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    const isCurrent = () => recRef.current === rec;

    rec.onstart = () => {
      if (!isCurrent()) return;
      setState({ status: "listening", interim: "" });
    };

    rec.onresult = (event: unknown) => {
      if (!isCurrent()) return;
      const ev = event as {
        resultIndex: number;
        results: ArrayLike<{
          isFinal: boolean;
          0: { transcript: string; confidence: number };
        }>;
      };
      let interim = "";
      let finalChunk = "";
      for (let i = 0; i < ev.results.length; i++) {
        const res = ev.results[i];
        const text = res[0]?.transcript ?? "";
        if (res.isFinal) {
          if (handsFreeMode) finalChunk += text;
          else finalTranscript += text;
        } else interim += text;
      }
      if (handsFreeMode) {
        if (finalChunk) {
          // Accumulate across chunks so "hey pos" + "add 3 pepsi" both count.
          pendingHandsFreeRef.current += finalChunk;
          if (pendingHandsFreeTimerRef.current) {
            clearTimeout(pendingHandsFreeTimerRef.current);
          }
          pendingHandsFreeTimerRef.current = setTimeout(() => {
            pendingHandsFreeRef.current = "";
          }, 8000);
          if (processHandsFree(pendingHandsFreeRef.current)) {
            pendingHandsFreeRef.current = "";
          }
        }
        setState({
          status: "listening",
          interim:
            interim ||
            pendingHandsFreeRef.current.trim() ||
            "Waiting for “Hey POS”…",
        });
      } else {
        setState({ status: "listening", interim: interim || finalTranscript });
      }
    };

    rec.onerror = (event: unknown) => {
      if (!isCurrent()) return;
      const ev = event as { error?: string };
      settled = true;
      const err = ev.error ?? "unknown";
      const messages: Record<string, string> = {
        "no-speech": "No speech heard — please try again.",
        "audio-capture": "Microphone unavailable — check your mic.",
        "not-allowed": "Microphone permission denied — allow access to use voice search.",
        denied: "Microphone permission denied — allow access to use voice search.",
        network: "Network error — voice search is unavailable right now.",
        "service-not-allowed": "Voice service not allowed on this device.",
      };
      setState({ status: "error", message: messages[err] ?? `Voice error: ${err}` });
    };

    rec.onend = () => {
      if (settled) return;
      settled = true;
      if (!isCurrent()) return;
      recRef.current = null;
      if (handsFreeRef.current && !manuallyStoppedRef.current) {
        // Keep listening hands-free (restart after the browser paused).
        start();
        return;
      }
      const text = finalTranscript.trim();
      if (text) {
        setState({ status: "processing" });
        clearProcessingTimer();
        processingTimerRef.current = setTimeout(() => {
          setState((prev) =>
            prev.status === "processing" ? { status: "idle" } : prev
          );
        }, 500);
        onCommandRef.current(parseTranscript(text));
      } else {
        setState({ status: "idle" });
      }
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setState({ status: "error", message: "Could not start voice recognition." });
    }
  }, [stop, processHandsFree]);

  const reset = useCallback(() => {
    clearProcessingTimer();
    setState({ status: "idle" });
  }, [clearProcessingTimer]);

  useEffect(() => {
    return () => {
      clearProcessingTimer();
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, [clearProcessingTimer]);

  return { state, supported, start, stop, reset };
}
