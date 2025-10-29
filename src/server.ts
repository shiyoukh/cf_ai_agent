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
import type { Ai as CloudflareAI } from "@cloudflare/workers-types";

const SUPPORTS_TOOLS = false;
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export interface AppEnv {
  AI?: CloudflareAI;
}

function createWorkersAIClient(env: AppEnv) {
  if (!env.AI) throw new Error("Workers AI binding missing in environment.");
  return createWorkersAI({ binding: env.AI as CloudflareAI });
}

export class Chat extends AIChatAgent<AppEnv> {
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    const makeModel = createWorkersAIClient(this.env);
    const model = makeModel(MODEL_ID);

    const allTools = SUPPORTS_TOOLS
      ? { ...tools, ...this.mcp.getAITools() }
      : ({} as ToolSet);

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        try {
          const cleanedMessages = cleanupMessages(this.messages);
          const processedMessages = await processToolCalls({
            messages: cleanedMessages,
            dataStream: writer,
            tools: allTools,
            executions
          });

          const result = streamText({
            system: `You are a helpful assistant that can do various tasks...

${getSchedulePrompt({ date: new Date() })}

If the user asks to schedule a task, use the schedule tool to schedule the task.`,
            messages: convertToModelMessages(processedMessages),
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
        parts: [{ type: "text", text: `Running scheduled task: ${description}` }],
        metadata: { createdAt: new Date() }
      }
    ]);
  }
}

export default {
  async fetch(request: Request, env: AppEnv, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      const ok = !!env.AI;
      return Response.json({ success: ok });
    }

    if (!env.AI) {
      console.error("Workers AI not configured: add binding 'AI' in wrangler config.");
    }

    if (url.pathname === "/debug-model") {
      try {
        const makeModel = createWorkersAIClient(env);
        const model = makeModel(MODEL_ID);

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
