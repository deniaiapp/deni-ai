import * as React from "react";
import { cn } from "@/lib/utils";

export interface LogosCarouselProps {
  children: React.ReactNode;
  stagger?: number;
  count?: number;
  className?: string;
  duration?: number;
  interval?: number;
  initialDelay?: number;
}

type CarouselState = {
  index: number;
  animate: boolean;
  nextIndex: number;
};

type CarouselAction =
  | { type: "reset" }
  | { type: "start"; groupsLength: number }
  | { type: "advance"; groupsLength: number };

function carouselReducer(state: CarouselState, action: CarouselAction): CarouselState {
  switch (action.type) {
    case "reset":
      return { index: 0, animate: false, nextIndex: 0 };
    case "start":
      return { ...state, animate: true, nextIndex: (state.index + 1) % action.groupsLength };
    case "advance": {
      const index = (state.index + 1) % action.groupsLength;
      return { ...state, index, nextIndex: (index + 1) % action.groupsLength };
    }
  }
}

export function LogosCarousel({
  children,
  stagger = 0.14,
  count,
  className,
  duration = 600,
  interval = 2500,
  initialDelay = 500,
}: LogosCarouselProps) {
  const [{ index, animate, nextIndex }, dispatch] = React.useReducer(carouselReducer, {
    index: 0,
    animate: false,
    nextIndex: 1,
  });

  const childrenArray = React.Children.toArray(children);
  const normalizedCount =
    typeof count === "number" && Number.isFinite(count) ? Math.floor(count) : childrenArray.length;
  const logosPerGroup = Math.max(1, Math.min(childrenArray.length || 1, normalizedCount || 1));
  const groups: React.ReactNode[][] = [];

  for (let i = 0; i < childrenArray.length; i += logosPerGroup) {
    groups.push(childrenArray.slice(i, i + logosPerGroup));
  }

  const groupsLength = groups.length;

  React.useEffect(() => {
    if (groupsLength < 2) {
      dispatch({ type: "reset" });
      return;
    }

    const id = setTimeout(() => {
      dispatch({ type: "start", groupsLength });
    }, initialDelay);

    return () => {
      clearTimeout(id);
    };
  }, [groupsLength, initialDelay]);

  React.useEffect(() => {
    if (!animate || groupsLength < 2) {
      return;
    }

    const intervalId = setInterval(() => {
      dispatch({ type: "advance", groupsLength });
    }, interval);

    return () => {
      clearInterval(intervalId);
    };
  }, [animate, interval, groupsLength]);

  if (groupsLength === 0) {
    return null;
  }

  return (
    <>
      <style>{`
        @keyframes logos-enter {
          0% {
            transform: translateY(40px);
            filter: blur(4px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            filter: blur(0px);
            opacity: 1;
          }
        }

        @keyframes logos-exit {
          0% {
            transform: translateY(0);
            filter: blur(0px);
            opacity: 1;
          }
          100% {
            transform: translateY(-40px);
            filter: blur(4px);
            opacity: 0;
          }
        }
      `}</style>
      <div className="max-w-[720px] grid place-items-center w-full">
        {groups.map((group, groupIndex) => {
          const isCurrent = groupIndex === index;
          const isNext = groupIndex === nextIndex && animate;
          const isVisible = isCurrent || isNext;

          return (
            <div
              key={groupIndex}
              className={cn("flex w-full justify-center gap-10", className)}
              style={{
                gridArea: "1 / 1",
                pointerEvents: isVisible ? "auto" : "none",
              }}
            >
              {group.map((logo, logoIndex) => {
                return (
                  <Logo
                    key={logoIndex}
                    state={isCurrent ? "exit" : "enter"}
                    animate={animate && isVisible}
                    index={logoIndex}
                    stagger={stagger}
                    duration={duration}
                  >
                    {logo}
                  </Logo>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}

interface LogoProps {
  children: React.ReactNode;
  animate?: boolean;
  index: number;
  state?: "enter" | "exit";
  stagger?: number;
  duration?: number;
}

function Logo({
  children,
  animate,
  index,
  state = "enter",
  stagger = 0.14,
  duration = 500,
}: LogoProps) {
  const delay = index * stagger;
  const durationMs = duration;

  const animationStyles: React.CSSProperties = {
    animationDelay: `${delay}s`,
    animationDuration: `${durationMs}ms`,
    animationFillMode: "both",
  };

  if (!animate) {
    if (state === "enter") {
      return (
        <div className="opacity-0" style={animationStyles}>
          {children}
        </div>
      );
    }
    return (
      <div className="opacity-100" style={animationStyles}>
        {children}
      </div>
    );
  }

  const animationName = state === "enter" ? "logos-enter" : "logos-exit";

  return (
    <div
      style={{
        ...animationStyles,
        animationName,
        animationTimingFunction: "ease",
      }}
    >
      {children}
    </div>
  );
}

export default LogosCarousel;
