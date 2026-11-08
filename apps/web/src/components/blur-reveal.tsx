import { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";
import type React from "react";

export interface BlurRevealProps {
  children: string;
  className?: string;
  delay?: number;
  speedReveal?: number;
  speedSegment?: number;
  trigger?: boolean;
  onAnimationComplete?: () => void;
  onAnimationStart?: () => void;
  as?: keyof React.JSX.IntrinsicElements;
  style?: React.CSSProperties;
  inView?: boolean;
  once?: boolean;
  letterSpacing?: string | number;
}

export function BlurReveal({
  children,
  className,
  delay = 0,
  speedReveal = 1.5,
  speedSegment = 0.5,
  trigger = true,
  onAnimationComplete,
  onAnimationStart,
  as = "p",
  style,
  inView = false,
  once = true,
  letterSpacing,
}: BlurRevealProps) {
  const MotionTag = m[as as keyof typeof m] as typeof m.div;

  const stagger = 0.03 / speedReveal;
  const baseDuration = 0.3 / speedSegment;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: stagger,
        delayChildren: delay,
      },
    },
    exit: {
      transition: {
        staggerChildren: stagger,
        staggerDirection: -1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, filter: "blur(12px)", y: 10 },
    visible: {
      opacity: 1,
      filter: "blur(0px)",
      y: 0,
      transition: {
        duration: baseDuration,
      },
    },
    exit: { opacity: 0, filter: "blur(12px)", y: 10 },
  };

  return (
    <LazyMotion features={domAnimation} strict>
      <AnimatePresence mode="popLayout">
        {trigger && (
          <MotionTag
            initial="hidden"
            whileInView={inView ? "visible" : undefined}
            animate={inView ? undefined : "visible"}
            exit="exit"
            variants={containerVariants}
            viewport={{ once }}
            className={className}
            onAnimationComplete={onAnimationComplete}
            onAnimationStart={onAnimationStart}
            style={style}
          >
            <span className="sr-only">{children}</span>
            {children &&
              children.split(" ").map((word, wordIndex, wordsArray) => (
                <span
                  key={`word-${wordIndex}`}
                  className="inline-block whitespace-nowrap"
                  aria-hidden="true"
                >
                  {word.split("").map((char, charIndex) => (
                    <m.span
                      key={`char-${wordIndex}-${charIndex}`}
                      variants={itemVariants}
                      className="inline-block"
                      style={letterSpacing ? { marginRight: letterSpacing } : undefined}
                    >
                      {char}
                    </m.span>
                  ))}
                  {wordIndex < wordsArray.length - 1 && (
                    <m.span
                      key={`space-${wordIndex}`}
                      variants={itemVariants}
                      className="inline-block"
                    >
                      &nbsp;
                    </m.span>
                  )}
                </span>
              ))}
          </MotionTag>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}
