import { useEffect, useSyncExternalStore } from "react";
import { speechTextFromMarkdown } from "@/lib/speech-text";

type SpeechSnapshot = {
  speakingId: string | null;
  supported: boolean;
};

const listeners = new Set<() => void>();
let speakingId: string | null = null;
let supported = false;
let supportDetected = false;
let speakTimer: ReturnType<typeof setTimeout> | undefined;
let snapshot: SpeechSnapshot = { speakingId: null, supported: false };

function emit() {
  snapshot = { speakingId, supported };
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): SpeechSnapshot {
  return snapshot;
}

const serverSnapshot: SpeechSnapshot = { speakingId: null, supported: false };

function getServerSnapshot(): SpeechSnapshot {
  return serverSnapshot;
}

const subscribeToNothing = () => () => {};
const getDisabledSnapshot = () => serverSnapshot;

function detectSupport() {
  if (supportDetected || typeof window === "undefined") {
    return;
  }
  supportDetected = true;
  supported = "speechSynthesis" in window;
  emit();
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  const exact = voices.find((voice) => voice.lang === lang);
  if (exact) {
    return exact;
  }
  const prefix = lang.split("-")[0] ?? lang;
  return voices.find((voice) => voice.lang.startsWith(prefix)) ?? null;
}

function cancelSpeech() {
  if (speakTimer) {
    clearTimeout(speakTimer);
    speakTimer = undefined;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (speakingId !== null) {
    speakingId = null;
    emit();
  }
}

function startUtterance(id: string, text: string, lang: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return;
  }

  const spoken = speechTextFromMarkdown(text);
  if (!spoken) {
    return;
  }

  cancelSpeech();
  speakingId = id;
  emit();

  // Chrome drops the first speak() after cancel() unless we yield.
  speakTimer = setTimeout(() => {
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = lang;
    const voice = pickVoice(lang);
    if (voice) {
      utterance.voice = voice;
    }
    utterance.onend = () => {
      if (speakingId === id) {
        speakingId = null;
        emit();
      }
    };
    utterance.onerror = () => {
      if (speakingId === id) {
        speakingId = null;
        emit();
      }
    };
    window.speechSynthesis.speak(utterance);
  }, 50);
}

export function useSpeechSynthesis(enabled = true) {
  const current = useSyncExternalStore(
    enabled ? subscribe : subscribeToNothing,
    enabled ? getSnapshot : getDisabledSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    detectSupport();
    const stopOnLeave = () => {
      cancelSpeech();
    };
    window.addEventListener("pagehide", stopOnLeave);
    return () => {
      window.removeEventListener("pagehide", stopOnLeave);
    };
  }, [enabled]);

  function stop() {
    cancelSpeech();
  }

  function toggle(id: string, text: string, lang: string) {
    if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    if (speakingId === id) {
      cancelSpeech();
      return;
    }
    startUtterance(id, text, lang);
  }

  return {
    supported: enabled && current.supported,
    speakingId: current.speakingId,
    toggle,
    stop,
  };
}
