import assert from "node:assert/strict";
import { describe, test } from "node:test";
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
  SAFE_COLLABORATION_NAMESPACE,
  SAFE_COLLABORATION_PREFIX,
} from "../utils/agent/reservedTools";

describe("reserved collaboration tools", () => {
  test("detects GPT-5 family models that reserve collaboration tools", () => {
    assert.equal(modelReservesCollaborationTools("openai/gpt-5.6-sol"), true);
    assert.equal(modelReservesCollaborationTools("openai/gpt-5.6-terra"), true);
    assert.equal(modelReservesCollaborationTools("openai/gpt-5.6-luna"), true);
    assert.equal(modelReservesCollaborationTools("gpt-5-6-terra"), true);
    assert.equal(modelReservesCollaborationTools("openai/gpt-5.5"), true);
    assert.equal(modelReservesCollaborationTools("openai/gpt-5.4"), true);
    assert.equal(modelReservesCollaborationTools("openai/gpt-5.3-codex"), true);
    assert.equal(modelReservesCollaborationTools("gpt-5.2"), true);
    assert.equal(modelReservesCollaborationTools("openai/gpt-6-astra"), true);
    assert.equal(modelReservesCollaborationTools("anthropic/claude-sonnet-4.6"), false);
    assert.equal(modelReservesCollaborationTools("openai/gpt-4.1"), false);
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
      assert.equal(
        getFunctionToolName((request.tools as unknown[])[0]),
        `${SAFE_COLLABORATION_PREFIX}spawn_agent`,
      );
      assert.ok(!JSON.stringify(request).includes("collaboration.spawn_agent"));
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

    assert.equal(stats.toolsRewritten, 2);
    assert.equal(
      getFunctionToolName((request.tools as unknown[])[0]),
      `${SAFE_COLLABORATION_PREFIX}spawn_agent`,
    );
    assert.equal(
      getFunctionToolName((request.tools as unknown[])[1]),
      `${SAFE_COLLABORATION_PREFIX}wait_agent`,
    );
    assert.deepEqual(request.tool_choice, {
      type: "function",
      function: { name: `${SAFE_COLLABORATION_PREFIX}spawn_agent` },
    });
    assert.ok(!JSON.stringify(request).includes("collaboration.spawn_agent"));
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
    assert.equal(rewritten.rewritten, 2);
    assert.ok(!JSON.stringify(rewritten.input).includes("collaboration."));

    const response = rewriteCollaborationNamesInResponsesPayload({
      output: [
        {
          type: "function_call",
          name: `${SAFE_COLLABORATION_PREFIX}spawn_agent`,
        },
      ],
    }) as { output: Array<{ name: string }> };
    assert.equal(response.output[0].name, "collaboration.spawn_agent");

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
    assert.equal(chat.choices[0].message.tool_calls[0].function.name, "collaboration.wait_agent");
  });

  test("rewrites streamed response event blocks", () => {
    const event = `event: response.output_item.added\ndata: ${JSON.stringify({
      item: {
        type: "function_call",
        name: `${SAFE_COLLABORATION_PREFIX}spawn_agent`,
      },
    })}`;

    assert.ok(
      rewriteCollaborationNamesInSseEventBlock(event).includes("collaboration.spawn_agent"),
    );
  });

  test("mapping is idempotent and reversible", () => {
    const outbound = rewriteCollaborationNameOutbound("collaboration.spawn_agent");
    assert.equal(rewriteCollaborationNameOutbound(outbound), outbound);
    assert.equal(rewriteCollaborationNameInbound(outbound), "collaboration.spawn_agent");
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

    assert.equal(stats.toolsRewritten, 2);
    assert.deepEqual(request.tools, [
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
    assert.ok(!JSON.stringify(request).includes("collaboration.spawn_agent"));
    assert.ok(!JSON.stringify(request.tools).includes('"collaboration"'));
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
    assert.equal(tool.name, `${SAFE_COLLABORATION_PREFIX}spawn_agent`);
    assert.equal(
      (tool.function as { name: string }).name,
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

    assert.deepEqual(request.tools, [
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

    assert.equal(response.output[0].name, "collaboration.spawn_agent");
  });

  test("restores separatorless names from older proxy deployments", () => {
    const legacyName = "flixa_collabspawn_agent";

    assert.equal(rewriteCollaborationNameInbound(legacyName), "collaboration.spawn_agent");
    assert.equal(
      rewriteCollaborationNameOutbound(legacyName),
      `${SAFE_COLLABORATION_PREFIX}spawn_agent`,
    );

    const response = rewriteCollaborationNamesInResponsesPayload({
      output: [{ type: "function_call", name: legacyName }],
    }) as { output: Array<{ name: string }> };
    assert.equal(response.output[0].name, "collaboration.spawn_agent");

    const event = `data: ${JSON.stringify({
      item: { type: "function_call", name: legacyName },
    })}`;
    assert.ok(
      rewriteCollaborationNamesInSseEventBlock(event).includes("collaboration.spawn_agent"),
    );
  });

  test("restores namespaced function calls for Codex clients", () => {
    const response = rewriteCollaborationNamesInResponsesPayload({
      output: [
        {
          type: "function_call",
          namespace: SAFE_COLLABORATION_NAMESPACE,
          name: "spawn_agent",
        },
      ],
    }) as {
      output: Array<{ type: string; namespace: string; name: string }>;
    };

    assert.deepEqual(response.output[0], {
      type: "function_call",
      namespace: "collaboration",
      name: "spawn_agent",
    });

    const request = rewriteCollaborationNamesInInput([
      {
        type: "function_call",
        namespace: "collaboration",
        name: "spawn_agent",
      },
    ]);
    assert.deepEqual(request.input, [
      {
        type: "function_call",
        namespace: SAFE_COLLABORATION_NAMESPACE,
        name: "spawn_agent",
      },
    ]);
  });
});
