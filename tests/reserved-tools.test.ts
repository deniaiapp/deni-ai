import { describe, expect, test } from "bun:test";
import {
  getFunctionToolName,
  modelReservesCollaborationTools,
  rewriteCollaborationNamesInChatPayload,
  rewriteCollaborationNamesInInput,
  rewriteCollaborationNamesInResponsesPayload,
  rewriteCollaborationNamesInSseEventBlock,
  rewriteCollaborationNameInbound,
  rewriteCollaborationNameOutbound,
  sanitizeReservedCollaborationInResponsesRequest,
  SAFE_COLLABORATION_PREFIX,
} from "../utils/agent/reservedTools";

describe("reserved collaboration tools", () => {
  test("detects GPT-5 family models that reserve collaboration tools", () => {
    expect(modelReservesCollaborationTools("openai/gpt-5.6-sol")).toBe(true);
    expect(modelReservesCollaborationTools("openai/gpt-5.6-terra")).toBe(true);
    expect(modelReservesCollaborationTools("openai/gpt-5.6-luna")).toBe(true);
    expect(modelReservesCollaborationTools("gpt-5-6-terra")).toBe(true);
    expect(modelReservesCollaborationTools("openai/gpt-5.5")).toBe(true);
    expect(modelReservesCollaborationTools("openai/gpt-5.4")).toBe(true);
    expect(modelReservesCollaborationTools("openai/gpt-5.3-codex")).toBe(true);
    expect(modelReservesCollaborationTools("gpt-5.2")).toBe(true);
    expect(modelReservesCollaborationTools("anthropic/claude-sonnet-4.6")).toBe(false);
    expect(modelReservesCollaborationTools("openai/gpt-4.1")).toBe(false);
  });

  test("rewrites reserved tools for Terra, Luna, and GPT-5.5", () => {
    for (const model of [
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-luna",
      "openai/gpt-5.5",
    ]) {
      const request: Record<string, unknown> = {
        model,
        tools: [
          {
            type: "namespace",
            name: "collaboration",
            tools: [
              {
                type: "function",
                name: "spawn_agent",
                parameters: { type: "object" },
              },
            ],
          },
        ],
      };

      sanitizeReservedCollaborationInResponsesRequest(request);
      expect(getFunctionToolName((request.tools as unknown[])[0])).toBe(
        `${SAFE_COLLABORATION_PREFIX}spawn_agent`,
      );
      expect(JSON.stringify(request)).not.toContain("collaboration.spawn_agent");
    }
  });

  test("rewrites Responses and Chat tool definitions without dropping them", () => {
    const request: Record<string, unknown> = {
      model: "openai/gpt-5.6-sol",
      tools: [
        {
          type: "function",
          name: "collaboration.spawn_agent",
          parameters: { type: "object" },
        },
        {
          type: "function",
          function: {
            name: "collaboration.wait_agent",
            parameters: { type: "object" },
          },
        },
        { type: "function", name: "read_file" },
      ],
      tool_choice: {
        type: "function",
        function: { name: "collaboration.spawn_agent" },
      },
    };

    const stats = sanitizeReservedCollaborationInResponsesRequest(request);

    expect(stats.toolsRewritten).toBe(2);
    expect(getFunctionToolName((request.tools as unknown[])[0])).toBe(
      `${SAFE_COLLABORATION_PREFIX}spawn_agent`,
    );
    expect(getFunctionToolName((request.tools as unknown[])[1])).toBe(
      `${SAFE_COLLABORATION_PREFIX}wait_agent`,
    );
    expect(request.tool_choice).toEqual({
      type: "function",
      function: { name: `${SAFE_COLLABORATION_PREFIX}spawn_agent` },
    });
    expect(JSON.stringify(request)).not.toContain("collaboration.spawn_agent");
  });

  test("rewrites function-call history and reverses response names", () => {
    const history = [
      {
        type: "function_call",
        name: "collaboration.spawn_agent",
        call_id: "call_1",
        arguments: "{}",
      },
      {
        role: "assistant",
        tool_calls: [
          {
            type: "function",
            function: { name: "collaboration.wait_agent", arguments: "{}" },
          },
        ],
      },
    ];

    const rewritten = rewriteCollaborationNamesInInput(history);
    expect(rewritten.rewritten).toBe(2);
    expect(JSON.stringify(rewritten.input)).not.toContain("collaboration.");

    const response = rewriteCollaborationNamesInResponsesPayload({
      output: [
        {
          type: "function_call",
          name: `${SAFE_COLLABORATION_PREFIX}spawn_agent`,
        },
      ],
    }) as { output: Array<{ name: string }> };
    expect(response.output[0].name).toBe("collaboration.spawn_agent");

    const chat = rewriteCollaborationNamesInChatPayload({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: `${SAFE_COLLABORATION_PREFIX}wait_agent`,
                },
              },
            ],
          },
        },
      ],
    }) as {
      choices: Array<{
        message: { tool_calls: Array<{ function: { name: string } }> };
      }>;
    };
    expect(chat.choices[0].message.tool_calls[0].function.name).toBe("collaboration.wait_agent");
  });

  test("rewrites streamed response event blocks", () => {
    const event = `event: response.output_item.added\ndata: ${JSON.stringify({
      item: {
        type: "function_call",
        name: `${SAFE_COLLABORATION_PREFIX}spawn_agent`,
      },
    })}`;

    expect(rewriteCollaborationNamesInSseEventBlock(event)).toContain("collaboration.spawn_agent");
  });

  test("mapping is idempotent and reversible", () => {
    const outbound = rewriteCollaborationNameOutbound("collaboration.spawn_agent");
    expect(rewriteCollaborationNameOutbound(outbound)).toBe(outbound);
    expect(rewriteCollaborationNameInbound(outbound)).toBe("collaboration.spawn_agent");
  });

  test("flattens Codex collaboration namespace tools into safe functions", () => {
    const request: Record<string, unknown> = {
      model: "openai/gpt-5.6-sol",
      tools: [
        {
          type: "namespace",
          name: "collaboration",
          tools: [
            {
              type: "function",
              name: "spawn_agent",
              parameters: {
                type: "object",
                properties: {
                  task_name: { type: "string" },
                  message: { type: "string" },
                  agent_type: { type: "string" },
                },
              },
            },
            {
              type: "function",
              name: "wait_agent",
              parameters: { type: "object" },
            },
          ],
        },
        { type: "function", name: "read_file" },
      ],
    };

    const stats = sanitizeReservedCollaborationInResponsesRequest(request);

    expect(stats.toolsRewritten).toBe(2);
    expect(request.tools).toEqual([
      {
        type: "function",
        name: `${SAFE_COLLABORATION_PREFIX}spawn_agent`,
        parameters: {
          type: "object",
          properties: {
            task_name: { type: "string" },
            message: { type: "string" },
            agent_type: { type: "string" },
          },
        },
      },
      {
        type: "function",
        name: `${SAFE_COLLABORATION_PREFIX}wait_agent`,
        parameters: { type: "object" },
      },
      { type: "function", name: "read_file" },
    ]);
    expect(JSON.stringify(request)).not.toContain("collaboration.spawn_agent");
    expect(JSON.stringify(request.tools)).not.toContain('"collaboration"');
  });

  test("rewrites both top-level and nested function names", () => {
    const request: Record<string, unknown> = {
      tools: [
        {
          type: "function",
          name: "collaboration.spawn_agent",
          function: {
            name: "collaboration.spawn_agent",
            parameters: { type: "object" },
          },
        },
      ],
    };

    sanitizeReservedCollaborationInResponsesRequest(request);

    const tool = (request.tools as Array<Record<string, unknown>>)[0];
    expect(tool.name).toBe(`${SAFE_COLLABORATION_PREFIX}spawn_agent`);
    expect((tool.function as { name: string }).name).toBe(
      `${SAFE_COLLABORATION_PREFIX}spawn_agent`,
    );
  });

  test("converts hosted reserved type tools into safe functions", () => {
    const request: Record<string, unknown> = {
      tools: [
        {
          type: "collaboration.spawn_agent",
          parameters: {
            type: "object",
            properties: { agent_type: { type: "string" } },
          },
        },
      ],
    };

    sanitizeReservedCollaborationInResponsesRequest(request);

    expect(request.tools).toEqual([
      {
        type: "function",
        name: `${SAFE_COLLABORATION_PREFIX}spawn_agent`,
        parameters: {
          type: "object",
          properties: { agent_type: { type: "string" } },
        },
      },
    ]);
  });

  test("reverses dotted safe namespace names in responses", () => {
    const response = rewriteCollaborationNamesInResponsesPayload({
      output: [
        {
          type: "function_call",
          name: "flixa_collab.spawn_agent",
        },
      ],
    }) as { output: Array<{ name: string }> };

    expect(response.output[0].name).toBe("collaboration.spawn_agent");
  });
});
