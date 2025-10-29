import { routeAgentRequest, type Schedule } from "agents";
import { getSchedulePrompt } from "agents/schedule";
import { AIChatAgent } from "agents/ai-chat-agent";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";

const SUPPORTS_TOOLS = false;
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

type MinimalAiBinding = { run: (...args: unknown[]) => Promise<Response> };

export interface AppEnv {
  AI?: unknown;
}

function hasAi(env: AppEnv): env is { AI: MinimalAiBinding } {
  return typeof (env as { AI?: unknown }).AI !== "undefined";
}

function createWorkersAIClient(env: AppEnv) {
  if (!hasAi(env))
    throw new Error(
      'Workers AI binding missing. Add `[ai]\nbinding = "AI"` to wrangler config.'
    );
  // The workers-ai-provider types expect a different binding type in some versions.
  // Cast to keep tsc happy across sdk versions — runtime is the same.
  // @ts-ignore – binding is runtime-provided and compatible
  return createWorkersAI({ binding: env.AI as unknown as MinimalAiBinding });
}

export class Chat extends AIChatAgent<AppEnv> {
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    const makeModel = createWorkersAIClient(this.env);
    const model = makeModel(MODEL_ID as never);

    const allTools = SUPPORTS_TOOLS
      ? { ...tools, ...this.mcp.getAITools() }
      : ({} as ToolSet);

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        try {
          const cleaned = cleanupMessages(this.messages);
          const processed = await processToolCalls({
            messages: cleaned,
            dataStream: writer,
            tools: allTools,
            executions
          });

          const result = streamText({
            system: `You are a helpful assistant that can do various tasks...

${getSchedulePrompt({ date: new Date() })}

If the user asks to schedule a task, use the schedule tool to schedule the task.`,
            messages: convertToModelMessages(processed),
            model,
            ...(SUPPORTS_TOOLS ? { tools: allTools } : {}),
            onFinish: onFinish as unknown as StreamTextOnFinishCallback<
              typeof allTools
            >,
            stopWhen: stepCountIs(10)
          });

          writer.merge(result.toUIMessageStream());
        } catch (err) {
          console.error("LLM call failed:", err);
        }
      }
    });

    return createUIMessageStreamResponse({ stream });
  }

  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          { type: "text", text: `Running scheduled task: ${description}` }
        ],
        metadata: { createdAt: new Date() }
      }
    ]);
  }
}

export default {
  async fetch(request: Request, env: AppEnv, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      return Response.json({ success: hasAi(env) });
    }

    if (!hasAi(env)) {
      console.error(
        'Workers AI not configured: add `[ai]\nbinding = "AI"` to wrangler configuration.'
      );
    }

    if (url.pathname === "/debug-model") {
      try {
        const makeModel = createWorkersAIClient(env);
        const model = makeModel(MODEL_ID as never);

        const result = await streamText({
          system: "probe",
          messages: [{ role: "user", content: "Say 'ok' if you can hear me." }],
          model
        });

        let out = "";
        for await (const chunk of result.textStream) out += chunk;
        return new Response(out || "ok");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(`Probe failed: ${msg}`, { status: 500 });
      }
    }

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<AppEnv>;
