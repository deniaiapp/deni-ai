import { useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type TransitionEvent } from "react";

export type ReceiptPhase = "processing" | "printing" | "complete";

export const PRINT_START_MS = 480;
export const PRINT_MS = 2000;

export function useReceiptPlayback() {
  const shouldReduceMotion = useReducedMotion();
  const paperRef = useRef<HTMLDivElement>(null);
  const [paperHeight, setPaperHeight] = useState(0);
  const [animatedPhase, setAnimatedPhase] = useState<ReceiptPhase>("processing");
  const phase: ReceiptPhase = shouldReduceMotion === true ? "complete" : animatedPhase;
  const isPrinting = phase !== "processing";
  const isAnimating = phase !== "complete";

  useLayoutEffect(() => {
    const node = paperRef.current;
    if (!node) {
      return;
    }

    const update = () => {
      setPaperHeight(node.getBoundingClientRect().height);
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (shouldReduceMotion) {
      return;
    }

    const printTimer = window.setTimeout(() => setAnimatedPhase("printing"), PRINT_START_MS);
    const fallbackTimer = window.setTimeout(
      () => setAnimatedPhase((current) => (current === "printing" ? "complete" : current)),
      PRINT_START_MS + PRINT_MS + 80,
    );
    return () => {
      window.clearTimeout(printTimer);
      window.clearTimeout(fallbackTimer);
    };
  }, [shouldReduceMotion]);

  function handlePrintTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== "max-height") {
      return;
    }
    if (phase === "printing") {
      setAnimatedPhase("complete");
    }
  }

  return {
    handlePrintTransitionEnd,
    isAnimating,
    isPrinting,
    paperHeight,
    paperRef,
    phase,
    shouldReduceMotion,
  };
}
