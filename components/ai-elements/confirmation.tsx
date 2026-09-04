"use client";

import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ToolUIPartApproval =
  | { id: string; approved?: boolean; reason?: string }
  | undefined;

interface ConfirmationContextValue {
  approval: ToolUIPartApproval;
  state: string | undefined;
}

const ConfirmationContext = createContext<ConfirmationContextValue | null>(null);

const useConfirmation = () => {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error("Confirmation components must be used within Confirmation");
  }
  return context;
};

export type ConfirmationProps = ComponentProps<typeof Alert> & {
  approval?: ToolUIPartApproval;
  state: string | undefined;
};

export const Confirmation = ({ className, approval, state, ...props }: ConfirmationProps) => {
  const contextValue = { approval, state };
  const decided = approval?.approved !== undefined;

  if (!approval) return null;
  if (!decided && (state === "input-streaming" || state === "input-available")) return null;

  return (
    <ConfirmationContext.Provider value={contextValue}>
      <Alert
        variant={state === "approval-requested" ? "warning" : "default"}
        className={cn("flex flex-col gap-2", className)}
        {...props}
      />
    </ConfirmationContext.Provider>
  );
};

export type ConfirmationTitleProps = ComponentProps<typeof AlertDescription>;

export const ConfirmationTitle = ({ className, ...props }: ConfirmationTitleProps) => (
  <AlertDescription className={cn("inline text-[#f0f0f0]", className)} {...props} />
);

export const ConfirmationRequest = ({ children }: { children?: ReactNode }) => {
  const { state } = useConfirmation();
  if (state !== "approval-requested") return null;
  return children;
};

export const ConfirmationAccepted = ({ children }: { children?: ReactNode }) => {
  const { approval, state } = useConfirmation();
  if (!approval?.approved || state === "approval-requested") return null;
  return children;
};

export const ConfirmationRejected = ({ children }: { children?: ReactNode }) => {
  const { approval, state } = useConfirmation();
  if (approval?.approved !== false || state === "approval-requested") return null;
  return children;
};

export type ConfirmationActionsProps = ComponentProps<"div">;

export const ConfirmationActions = ({ className, ...props }: ConfirmationActionsProps) => {
  const { state } = useConfirmation();
  if (state !== "approval-requested") return null;

  return <div className={cn("flex items-center justify-end gap-2 self-end", className)} {...props} />;
};

export type ConfirmationActionProps = ComponentProps<typeof Button>;

export const ConfirmationAction = (props: ConfirmationActionProps) => (
  <Button size="xs" type="button" {...props} />
);
