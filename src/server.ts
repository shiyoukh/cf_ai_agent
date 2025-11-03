import type { Schedule } from "agents";
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
import type { Ai, AiModels } from "@cloudflare/workers-types";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";

export { Chat } from "./chat-do";

const SUPPORTS_TOOLS = false;
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export interface AppEnv {
  AI?: unknown;
  Chat: DurableObjectNamespace;
}

function hasAi(env: AppEnv): env is AppEnv & { AI: unknown } {
  return typeof (env as { AI?: unknown }).AI !== "undefined";
}

function makeSid() {
  return "s-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
}
function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  const parts = raw.split(/;\s*/);
  for (const p of parts) {
    const [k, ...rest] = p.split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
function requireSessionForApi(req: Request, url: URL): string {
  return url.searchParams.get("session") || readCookie(req, "sid") || (() => {
    throw new Response(JSON.stringify({ ok: false, error: "missing session" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  })();
}

function createWorkersAIClient(env: AppEnv) {
  if (!hasAi(env)) throw new Error("Workers AI binding missing in environment.");
  return createWorkersAI({ binding: env.AI as unknown as Ai<AiModels> });
}

export class ChatAgent extends AIChatAgent<AppEnv> {
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    const makeModel = createWorkersAIClient(this.env);
    const model = makeModel(MODEL_ID as never);
    const allTools = SUPPORTS_TOOLS ? { ...tools, ...this.mcp.getAITools() } : ({} as ToolSet);
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
            onFinish: onFinish as unknown as StreamTextOnFinishCallback<typeof allTools>,
            stopWhen: stepCountIs(10)
          });
          writer.merge(result.toUIMessageStream());
        } catch (err) {}
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
  async fetch(request: Request, env: AppEnv) {
    const url = new URL(request.url);
    const isApi = url.pathname.startsWith("/api/");
    const isHtml =
      (request.headers.get("accept") || "").includes("text/html") ||
      (request.headers.get("sec-fetch-dest") || "") === "document";
    const isStatic =
      url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/static/") ||
      url.pathname.startsWith("/favicon") ||
      url.pathname.startsWith("/_next/") ||
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".map") ||
      url.pathname.endsWith(".png") ||
      url.pathname.endsWith(".jpg") ||
      url.pathname.endsWith(".svg") ||
      url.pathname.endsWith(".ico") ||
      url.pathname.endsWith(".webp");

    if (!isApi && isHtml && !isStatic && request.method === "GET") {
      let sid = url.searchParams.get("session") || readCookie(request, "sid");
      if (!sid || sid === "default") {
        sid = makeSid();
        url.searchParams.set("session", sid);
        return new Response(null, {
          status: 302,
          headers: {
            Location: url.toString(),
            "Set-Cookie": `sid=${encodeURIComponent(sid)}; Path=/; Max-Age=15552000; SameSite=Lax; Secure`
          }
        });
      }
    }

    if (url.pathname === "/check-open-ai-key") {
      const ok = hasAi(env);
      return Response.json({ success: ok });
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

    if (url.pathname === "/api/chat" && request.method === "POST") {
      const sessionId = requireSessionForApi(request, url);
      const id = env.Chat.idFromName(sessionId);
      const stub = env.Chat.get(id);
      const body = await request.text();
      return stub.fetch("https://do/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      });
    }

    if (url.pathname === "/api/history") {
      const sessionId = requireSessionForApi(request, url);
      const id = env.Chat.idFromName(sessionId);
      const stub = env.Chat.get(id);
      if (request.method === "GET") {
        return stub.fetch("https://do/history", { method: "GET" });
      }
      if (request.method === "DELETE") {
        return stub.fetch("https://do/history", { method: "DELETE" });
      }
    }

    if (url.pathname === "/api/schedule" && request.method === "POST") {
      const sessionId = requireSessionForApi(request, url);
      const id = env.Chat.idFromName(sessionId);
      const stub = env.Chat.get(id);
      const body = await request.text();
      return stub.fetch("https://do/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      });
    }

    return new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<AppEnv>;

