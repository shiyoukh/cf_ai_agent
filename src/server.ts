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
  type ToolSet,
} from "ai";

import { createWorkersAI } from "workers-ai-provider";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";


const SUPPORTS_TOOLS = false;

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";



function createWorkersAIClient(env: Env) {
  if ((env as any).AI) {
    return createWorkersAI({ binding: (env as any).AI });
  }
  if (env.WORKERSAI_API_KEY && env.GATEWAY_BASE_URL) {
    return createWorkersAI({
      apiKey: env.WORKERSAI_API_KEY,
      baseURL: env.GATEWAY_BASE_URL,
    });
  }
  throw new Error(
    "Workers AI is not configured. Provide an [ai] binding OR WORKERSAI_API_KEY + GATEWAY_BASE_URL."
  );
}


export class Chat extends AIChatAgent<Env> {

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    const workersai = createWorkersAIClient(this.env);
    const model = workersai(MODEL_ID);

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
            executions,
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
            stopWhen: stepCountIs(10),
          });

          writer.merge(result.toUIMessageStream());
        } catch (err) {
          console.error("LLM call failed:", err);
          await writer.writeData({
            type: "error",
            content:
              "The model call failed. Check your Workers AI credentials/binding and logs.",
          });
        }
      },
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
        metadata: { createdAt: new Date() },
      },
    ]);
  }
}


export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);


    if (url.pathname === "/check-open-ai-key") {
      const ok = !!(env as any).AI || !!env.WORKERSAI_API_KEY;
      return Response.json({ success: ok });
    }

    if (!(env as any).AI && !env.WORKERSAI_API_KEY) {
      console.error(
        "Workers AI not configured: add an [ai] binding in wrangler.toml OR set WORKERSAI_API_KEY + GATEWAY_BASE_URL."
      );
    }

    if (url.pathname === "/debug-model") {
      try {
        const workersai = createWorkersAIClient(env);
        const model = workersai(MODEL_ID);
        const { text } = await model.generate("Say 'ok' if you can hear me.");
        return new Response(text);
      } catch (e: any) {
        return new Response(`Probe failed: ${e?.message || e}`, { status: 500 });
      }
    }


    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
