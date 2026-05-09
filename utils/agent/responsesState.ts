const RESPONSE_STATE_TTL_MS = 1000 * 60 * 60;
const MAX_RESPONSE_STATE_ENTRIES = 500;

interface CachedResponsesState {
  id: string;
  input?: unknown[];
  output?: unknown[];
  previousResponseId?: string;
  createdAt: number;
}

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asInputArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return [{ role: "user", content: value }];
  }

  return undefined;
}

const responsesStateCache = new Map<string, CachedResponsesState>();

function pruneResponsesStateCache(now = Date.now()): void {
  for (const [responseId, state] of responsesStateCache.entries()) {
    if (now - state.createdAt > RESPONSE_STATE_TTL_MS) {
      responsesStateCache.delete(responseId);
    }
  }

  while (responsesStateCache.size > MAX_RESPONSE_STATE_ENTRIES) {
    const oldestKey = responsesStateCache.keys().next().value;
    if (!oldestKey) {
      return;
    }

    responsesStateCache.delete(oldestKey);
  }
}

function buildExpandedInput(previousResponseId: string): unknown[] | null {
  const seen = new Set<string>();
  const states: CachedResponsesState[] = [];

  let currentResponseId: string | undefined = previousResponseId;

  while (currentResponseId && !seen.has(currentResponseId)) {
    seen.add(currentResponseId);

    const state = responsesStateCache.get(currentResponseId);
    if (!state) {
      break;
    }

    states.push(state);

    currentResponseId = state.previousResponseId;
  }

  const expanded: unknown[] = [];
  for (const state of states.reverse()) {
    if (state.input) {
      expanded.push(...cloneValue(state.input));
    }

    if (state.output) {
      expanded.push(...cloneValue(state.output));
    }
  }

  return expanded.length > 0 ? expanded : null;
}

export function resolveResponsesRequestState(
  request: Record<string, unknown>,
): Record<string, unknown> {
  pruneResponsesStateCache();

  const previousResponseId =
    typeof request.previous_response_id === "string"
      ? request.previous_response_id
      : undefined;
  const input = asInputArray(request.input);

  if (!previousResponseId || !input) {
    return request;
  }

  const expandedInput = buildExpandedInput(previousResponseId);
  if (!expandedInput) {
    return request;
  }

  const resolvedRequest: Record<string, unknown> = {
    ...request,
    input: [...expandedInput, ...cloneValue(input)],
  };

  delete resolvedRequest.previous_response_id;

  return resolvedRequest;
}

export function cacheResponsesState(
  request: Record<string, unknown>,
  response: unknown,
): void {
  pruneResponsesStateCache();

  const responseRecord = asRecord(response);
  const responseId =
    responseRecord && typeof responseRecord.id === "string"
      ? responseRecord.id
      : null;

  if (!responseId) {
    return;
  }

  const previousResponseId =
    typeof request.previous_response_id === "string"
      ? request.previous_response_id
      : undefined;

  responsesStateCache.set(responseId, {
    id: responseId,
    input: asInputArray(request.input)?.map((item) => cloneValue(item)),
    output: Array.isArray(responseRecord?.output)
      ? responseRecord.output.map((item) => cloneValue(item))
      : undefined,
    previousResponseId,
    createdAt: Date.now(),
  });
}

export function collectCompletedResponseFromSseEvent(
  eventBlock: string,
  currentResponse: unknown,
): unknown {
  const payload = eventBlock
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!payload || payload === "[DONE]") {
    return currentResponse;
  }

  try {
    const event = JSON.parse(payload) as {
      type?: string;
      response?: unknown;
    };

    if (event.type === "response.completed" && event.response) {
      return event.response;
    }
  } catch {
    return currentResponse;
  }

  return currentResponse;
}
