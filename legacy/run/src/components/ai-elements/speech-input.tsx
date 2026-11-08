import { MicIcon, SquareIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SpeechRecognitionResultLike = { isFinal: boolean; 0?: { transcript: string } };
type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};
type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognitionConstructor() {
  if (typeof window === "undefined") return undefined;
  const scope = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

const subscribeNothing = () => () => undefined;

export type SpeechInputProps = Omit<ComponentProps<typeof Button>, "children"> & {
  onTranscriptionChange?: (text: string) => void;
  lang?: string;
};

/** Dictation through the browser's Web Speech API. Disabled where the browser has none. */
export const SpeechInput = ({
  className,
  onTranscriptionChange,
  lang = "en-US",
  ...props
}: SpeechInputProps) => {
  const [isListening, setIsListening] = useState(false);
  // The server cannot know whether the browser supports dictation.
  const isSupported = useSyncExternalStore(
    subscribeNothing,
    () => Boolean(speechRecognitionConstructor()),
    () => false,
  );
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptionChangeRef = useRef(onTranscriptionChange);

  useEffect(() => {
    onTranscriptionChangeRef.current = onTranscriptionChange;
  }, [onTranscriptionChange]);

  useEffect(() => {
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      return;
    }
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    const handleStart = () => setIsListening(true);
    const handleEnd = () => setIsListening(false);
    const handleResult = (event: Event) => {
      const { resultIndex, results } = event as SpeechRecognitionEventLike;
      let finalTranscript = "";
      for (let index = resultIndex; index < results.length; index += 1) {
        const result = results[index];
        if (result?.isFinal) {
          finalTranscript += result[0]?.transcript ?? "";
        }
      }
      if (finalTranscript) {
        onTranscriptionChangeRef.current?.(finalTranscript);
      }
    };

    recognition.addEventListener("start", handleStart);
    recognition.addEventListener("end", handleEnd);
    recognition.addEventListener("result", handleResult);
    recognition.addEventListener("error", handleEnd);
    recognitionRef.current = recognition;

    return () => {
      recognition.removeEventListener("start", handleStart);
      recognition.removeEventListener("end", handleEnd);
      recognition.removeEventListener("result", handleResult);
      recognition.removeEventListener("error", handleEnd);
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [lang]);

  const toggleListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (isListening) recognition.stop();
    else recognition.start();
  }, [isListening]);

  return (
    <div className="relative inline-flex items-center justify-center">
      {isListening &&
        [0, 1, 2].map((index) => (
          <div
            className="absolute inset-0 animate-ping rounded-full border-2 border-red-400/30"
            key={index}
            style={{ animationDelay: `${index * 0.3}s`, animationDuration: "2s" }}
          />
        ))}
      <Button
        className={cn(
          "relative z-10 rounded-full transition-all duration-300",
          className,
          isListening && "bg-destructive text-white hover:bg-destructive/80 hover:text-white",
        )}
        disabled={!isSupported}
        onClick={toggleListening}
        aria-pressed={isListening}
        {...props}
      >
        {isListening ? <SquareIcon className="size-4" /> : <MicIcon className="size-4" />}
      </Button>
    </div>
  );
};
