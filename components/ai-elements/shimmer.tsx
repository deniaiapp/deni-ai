"use client";

import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { memo, useMemo } from "react";

import { cn } from "@/lib/utils";

const MotionSpan = motion.span;

export type ShimmerProps = {
  children: string;
  className?: string;
  duration?: number;
  spread?: number;
};

const ShimmerComponent = ({ children, className, duration = 2, spread = 2 }: ShimmerProps) => {
  const dynamicSpread = useMemo(() => (children?.length ?? 0) * spread, [children, spread]);

  return (
    <MotionSpan
      animate={{ backgroundPosition: "0% center" }}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),#f0f0f0,#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className,
      )}
      initial={{ backgroundPosition: "100% center" }}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage: "var(--bg), linear-gradient(#8f8f8f, #8f8f8f)",
        } as CSSProperties
      }
      transition={{ duration, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
    >
      {children}
    </MotionSpan>
  );
};

export const Shimmer = memo(ShimmerComponent);
