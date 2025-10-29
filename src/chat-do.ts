import { streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

type MinimalAiBinding = { run: (...args: unknown[]) => Promise<Response> };

type HistoryMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
};
type Job = { id: string; runAt: number; prompt: string };

type DOEnv = {
  AI?: unknown;
};

function hasAi(env: DOEnv): env is { AI: MinimalAiBinding } {
  return typeof (env as { AI?: unknown }).AI !== "undefined";
}

function createWorkersAIClient(env: DOEnv) {
  if (!hasAi(env)) throw new Error("Workers AI binding missing");
  return createWorkersAI({ binding: env.AI });
}

export class Chat {
  private state: DurableObjectState;
  private env: DOEnv;

  constructor(state: DurableObjectState, env: DOEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (url.pathname.endsWith("/history") && method === "GET") {
      const history =
        (await this.state.storage.get<HistoryMessage[]>("history")) ?? [];
      return new Response(JSON.stringify(history), {
        headers: { "content-type": "application/json" }
      });
    }

    if (url.pathname.endsWith("/history") && method === "DELETE") {
      await this.state.storage.delete("history");
      await this.state.storage.delete("jobs"); // optional: clear scheduled jobs too
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" }
      });
    }

    if (url.pathname.endsWith("/schedule") && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const runAt: number = Number(body?.runAt);
      const prompt: string = String(body?.prompt ?? "");

      if (!Number.isFinite(runAt) || !prompt) {
        return new Response(
          JSON.stringify({ ok: false, error: "invalid runAt or prompt" }),
          { status: 400 }
        );
      }

      const id = crypto.randomUUID();
      const jobs = (await this.state.storage.get<Job[]>("jobs")) ?? [];
      jobs.push({ id, runAt, prompt });
      await this.state.storage.put("jobs", jobs);
      await this.state.storage.setAlarm(new Date(runAt));

      // NEW: persist a visible confirmation message so polling won’t wipe it
      const history =
        (await this.state.storage.get<HistoryMessage[]>("history")) ?? [];
      history.push({
        role: "assistant",
        content:
          "scheduled message: A summary of this chat will be sent in 1 minute :)",
        ts: Date.now()
      });
      await this.state.storage.put("history", history);

      return new Response(JSON.stringify({ ok: true, id }), {
        headers: { "content-type": "application/json" }
      });
    }

    if (method === "POST") {
      const body = await request.json().catch(() => ({}));
      const userText: string = String(body?.text ?? "");
      if (!userText)
        return new Response(
          JSON.stringify({ ok: false, error: "missing text" }),
          { status: 400 }
        );

      const history =
        (await this.state.storage.get<HistoryMessage[]>("history")) ?? [];
      history.push({ role: "user", content: userText, ts: Date.now() });

      const makeModel = createWorkersAIClient(this.env);
      const model = makeModel(MODEL_ID);

      const result = await streamText({
        system: "You are a concise, helpful assistant.",
        messages: history.map((h) => ({ role: h.role, content: h.content })),
        model
      });

      let assistant = "";
      for await (const chunk of result.textStream) assistant += chunk;

      const assistantMsg: HistoryMessage = {
        role: "assistant",
        content: assistant || "ok",
        ts: Date.now()
      };
      history.push(assistantMsg);
      await this.state.storage.put("history", history);

      // Return authoritative history to fix ordering/races on client
      return new Response(
        JSON.stringify({ ok: true, reply: assistantMsg.content, history }),
        { headers: { "content-type": "application/json" } }
      );
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const jobs = (await this.state.storage.get<Job[]>("jobs")) ?? [];
    const due = jobs.filter((j) => j.runAt <= now);
    const future = jobs.filter((j) => j.runAt > now);

    if (due.length === 0) {
      if (future.length > 0) {
        const next = Math.min(...future.map((j) => j.runAt));
        await this.state.storage.setAlarm(new Date(next));
      }
      return;
    }

    const history =
      (await this.state.storage.get<HistoryMessage[]>("history")) ?? [];

    const makeModel = createWorkersAIClient(this.env);
    const model = makeModel(MODEL_ID);

    for (const job of due) {
      const prompt = job.prompt;
      const result = await streamText({
        system: "You are a concise, helpful assistant.",
        messages: [
          ...history.map((h) => ({ role: h.role, content: h.content })),
          { role: "user", content: prompt }
        ],
        model
      });

      let assistant = "";
      for await (const chunk of result.textStream) assistant += chunk;
      history.push({
        role: "assistant",
        content: assistant || "ok",
        ts: Date.now()
      });
    }

    await this.state.storage.put("history", history);

    if (future.length > 0) {
      const next = Math.min(...future.map((j) => j.runAt));
      await this.state.storage.put("jobs", future);
      await this.state.storage.setAlarm(new Date(next));
    } else {
      await this.state.storage.delete("jobs");
    }
  }
}
