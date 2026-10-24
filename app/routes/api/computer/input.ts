import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { limitOrResponse } from "@/lib/rate-limit";
import {
  browserClick,
  browserPress,
  browserScroll,
  browserType,
  setComputer,
} from "@/lib/computer";
import { claimBrowserTakeover, releaseBrowserTakeover } from "@/lib/browser-workspaces";
import { transitionJob } from "@/lib/jobs";
import { getExtracted } from "@/i18n/server";
import { localizeError } from "@/lib/localize-error";

type ComputerInput = {
  type?: "click" | "type" | "key" | "scroll" | "takeover" | "release";
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  dy?: number;
  jobId?: string;
};

function inputSummary(input: ComputerInput) {
  if (input.type === "type") return { type: input.type, textLength: input.text?.length ?? 0 };
  return {
    type: input.type,
    x: input.x,
    y: input.y,
    key: input.key,
    dy: input.dy,
  };
}

async function POST({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "computer-input", 120);
  if (limited) return limited;
  const body = (await req.json()) as ComputerInput;
  const startedAt = Date.now();
  const summary = inputSummary(body);

  if (body.type === "takeover") {
    if (body.jobId) {
      const claimed = await claimBrowserTakeover(userId, body.jobId).catch(() => false);
      if (!claimed) {
        return Response.json({ error: t("Another task currently owns the computer") }, { status: 409 });
      }
      // The computer keeps the ID of its last job after it finishes. Only park a job that is
      // still running, or taking over a leftover browser would reopen a finished task.
      await transitionJob(userId, body.jobId, "running", { status: "waiting_takeover" }).catch(() => undefined);
    }
    await setComputer(userId, {
      status: "takeover",
      workingLabel: "You are in control",
      ...(body.jobId ? { jobId: body.jobId } : {}),
    });
    return Response.json({ ok: true });
  }
  if (body.type === "release") {
    if (body.jobId) {
      await releaseBrowserTakeover(userId, body.jobId).catch(() => undefined);
      // Releasing human control does not start an executor. Keep the job waiting
      // until the next chat message atomically claims its continuation.
    }
    await setComputer(userId, {
      status: "idle",
      workingLabel: "",
      ...(body.jobId ? { jobId: body.jobId } : {}),
    });
    return Response.json({ ok: true });
  }

  try {
    if (body.type === "click" && body.x != null && body.y != null) {
      await browserClick(userId, {
        x: body.x,
        y: body.y,
        normalized: true,
      }, body.jobId);
    } else if (body.type === "type" && body.text) {
      await browserType(userId, { text: body.text }, body.jobId);
    } else if (body.type === "key" && body.key) {
      await browserPress(userId, body.key, body.jobId);
    } else if (body.type === "scroll" && body.dy != null) {
      await browserScroll(userId, body.dy, body.jobId);
    } else {
      return Response.json({ error: t("Invalid input") }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[computer-api] input failed", {
        ...summary,
        elapsedMs: Date.now() - startedAt,
        error: await localizeError(error),
      });
    }
    return Response.json(
      { error: await localizeError(error) },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/computer/input")({
  server: { handlers: { POST } },
});
