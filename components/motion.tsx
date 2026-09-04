"use client";

import { motion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { easeOut, fadeIn, fadeUp, stagger } from "@/lib/motion";

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

export function FadeIn({
  children,
  className,
  delay = 0,
  y = 14,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: easeOut, delay }}
    >
      {children}
    </motion.div>
  );
}

export function Stagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={stagger}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <motion.div
      className={className}
      variants={fadeUp}
      whileHover={hover ? { y: -3 } : undefined}
    >
      {children}
    </motion.div>
  );
}

export function FadeInView({
  children,
  className,
  delay = 0,
  y = 14,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.45, ease: easeOut, delay }}
    >
      {children}
    </motion.div>
  );
}

export function FadePresence({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={fadeIn}>
      {children}
    </motion.div>
  );
}
