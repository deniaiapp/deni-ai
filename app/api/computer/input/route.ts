import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { limitOrResponse } from "@/lib/rate-limit";
import {
  browserClick,
  browserPress,
  browserScroll,
  browserType,
  setComputer,
} from "@/lib/computer";

export const dynamic = "force-dynamic";

type ComputerInput = {
  type?: "click" | "type" | "key" | "scroll" | "takeover" | "release";
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  dy?: number;
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

export async function POST(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "computer-input", 120);
  if (limited) return limited;
  const body = (await req.json()) as ComputerInput;
  const startedAt = Date.now();
  const summary = inputSummary(body);
  if (process.env.NODE_ENV !== "production") {
    console.info("[computer-api] input received", summary);
  }

  if (body.type === "takeover") {
    await setComputer(userId, {
      status: "takeover",
      workingLabel: "You are in control",
    });
    if (process.env.NODE_ENV !== "production") {
      console.info("[computer-api] input completed", {
        ...summary,
        elapsedMs: Date.now() - startedAt,
      });
    }
    return NextResponse.json({ ok: true });
  }
  if (body.type === "release") {
    await setComputer(userId, { status: "idle", workingLabel: "" });
    if (process.env.NODE_ENV !== "production") {
      console.info("[computer-api] input completed", {
        ...summary,
        elapsedMs: Date.now() - startedAt,
      });
    }
    return NextResponse.json({ ok: true });
  }

  try {
    if (body.type === "click" && body.x != null && body.y != null) {
      await browserClick(userId, {
        x: body.x,
        y: body.y,
        normalized: true,
      });
    } else if (body.type === "type" && body.text) {
      await browserType(userId, { text: body.text });
    } else if (body.type === "key" && body.key) {
      await browserPress(userId, body.key);
    } else if (body.type === "scroll" && body.dy != null) {
      await browserScroll(userId, body.dy);
    } else {
      return NextResponse.json({ error: "bad input" }, { status: 400 });
    }
    if (process.env.NODE_ENV !== "production") {
      console.info("[computer-api] input completed", {
        ...summary,
        elapsedMs: Date.now() - startedAt,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[computer-api] input failed", {
        ...summary,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
