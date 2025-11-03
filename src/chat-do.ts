import { streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import type { Ai, AiModels } from "@cloudflare/workers-types";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

type HistoryMessage = { role: "user" | "assistant" | "system"; content: string; ts: number };
type Job = { id: string; runAt: number; prompt: string };
type DOEnv = { AI?: unknown };
type Bucket = { tokens: number; last: number };

const MAX_MESSAGES = 300;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_HISTORY_CHARS = 120_000;
const DAILY_MS = 24 * 60 * 60 * 1000;
const MIN_ALARM_MS = 30_000;

function hasAi(env: DOEnv): env is DOEnv & { AI: unknown } {
  return typeof (env as { AI?: unknown }).AI !== "undefined";
}

function createWorkersAIClient(env: DOEnv) {
  // @ts-expect-error Workers AI binding Response differs from lib.dom Response; safe on Workers runtime.
  return createWorkersAI({ binding: (hasAi(env) ? env.AI : undefined) as unknown as Ai<AiModels> });
}

async function tokenBucket(state: DurableObjectState, key: string, ratePerMin = 30, burst = 45): Promise<boolean> {
  const storageKey = `tb:${key}`;
  const now = Date.now();
  const refill = 60000 / ratePerMin;
  const b = (await state.storage.get<Bucket>(storageKey)) ?? { tokens: burst, last: now };
  const elapsed = now - b.last;
  const add = Math.floor(elapsed / refill);
  if (add > 0) {
    b.tokens = Math.min(b.tokens + add, burst);
    b.last = now;
  }
  if (b.tokens <= 0) {
    await state.storage.put(storageKey, b, { expirationTtl: 180 });
    return false;
  }
  b.tokens -= 1;
  await state.storage.put(storageKey, b, { expirationTtl: 180 });
  return true;
}

function clientKey(req: Request): string {
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for") ||
    "";
  const ua = req.headers.get("user-agent") || "";
  return ip ? `${ip}` : `ua:${ua.slice(0, 80)}`;
}

function pruneByAge(messages: HistoryMessage[], now: number): HistoryMessage[] {
  const cutoff = now - MAX_AGE_MS;
  return messages.filter(m => m.ts >= cutoff);
}

function pruneByCount(messages: HistoryMessage[]): HistoryMessage[] {
  if (messages.length <= MAX_MESSAGES) return messages;
  return messages.slice(messages.length - MAX_MESSAGES);
}

function pruneByChars(messages: HistoryMessage[]): HistoryMessage[] {
  let total = 0;
  const out: HistoryMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const len = m.content.length;
    if (total + len > MAX_HISTORY_CHARS) break;
    out.push(m);
    total += len;
  }
  out.reverse();
  return out;
}

async function loadHistory(state: DurableObjectState): Promise<HistoryMessage[]> {
  return (await state.storage.get<HistoryMessage[]>("history")) ?? [];
}

async function saveHistory(state: DurableObjectState, history: HistoryMessage[], scheduleNextPrune = false) {
  const now = Date.now();
  let h = pruneByAge(history, now);
  h = pruneByCount(h);
  h = pruneByChars(h);
  await state.storage.put("history", h);
  if (scheduleNextPrune) {
    const next = new Date(now + DAILY_MS);
    const existing = await state.storage.get<number>("nextPruneAt");
    if (!existing || existing < next.getTime()) {
      await state.storage.put("nextPruneAt", next.getTime());
      const jobs = (await state.storage.get<Job[]>("jobs")) ?? [];
      await state.storage.put("jobs", jobs);
      await state.storage.setAlarm(next);
    }
  }
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
      const history = await loadHistory(this.state);
      return new Response(JSON.stringify(history), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname.endsWith("/history") && method === "DELETE") {
      await this.state.storage.delete("history");
      await this.state.storage.delete("jobs");
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname.endsWith("/schedule") && method === "POST") {
      const key = clientKey(request);
      const allowed = await tokenBucket(this.state, key, 12, 20);
      if (!allowed) {
        return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
          status: 429,
          headers: { "content-type": "application/json" }
        });
      }

      const body = (await request.json().catch(() => ({}))) as Partial<{ runAt: number; prompt: string }>;
      const runAt = Number(body.runAt);
      const prompt = String(body.prompt ?? "");
      if (!Number.isFinite(runAt) || !prompt) {
        return new Response(JSON.stringify({ ok: false, error: "invalid runAt or prompt" }), { status: 400 });
      }

      const now = Date.now();
      const delta = runAt - now;

      if (delta < MIN_ALARM_MS) {
        const history = await loadHistory(this.state);
        const makeModel = createWorkersAIClient(this.env);
        const model = makeModel(MODEL_ID as never);
        const result = await streamText({
          system: "You are a concise, helpful assistant.",
          messages: [...history.map(h => ({ role: h.role, content: h.content })), { role: "user", content: prompt }],
          model
        });
        let assistant = "";
        for await (const chunk of result.textStream) assistant += chunk;
        history.push({ role: "assistant", content: assistant || "ok", ts: Date.now() });
        await saveHistory(this.state, history, true);
        return new Response(JSON.stringify({ ok: true, mode: "immediate" }), { headers: { "content-type": "application/json" } });
      }

      const id = crypto.randomUUID();
      const jobs = (await this.state.storage.get<Job[]>("jobs")) ?? [];
      jobs.push({ id, runAt, prompt });
      await this.state.storage.put("jobs", jobs);
      await this.state.storage.setAlarm(new Date(runAt));

      const history = await loadHistory(this.state);
      const secs = Math.max(1, Math.round(delta / 1000));
      history.push({ role: "assistant", content: `scheduled message: A summary of this chat will be sent in ${secs} seconds :)`, ts: Date.now() });
      await saveHistory(this.state, history, true);

      return new Response(JSON.stringify({ ok: true, id, mode: "scheduled" }), { headers: { "content-type": "application/json" } });
    }

    if (method === "POST") {
      const key = clientKey(request);
      const allowed = await tokenBucket(this.state, key, 30, 45);
      if (!allowed) {
        return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
          status: 429,
          headers: { "content-type": "application/json" }
        });
      }

      const body = (await request.json().catch(() => ({}))) as Partial<{ text: string }>;
      const userText = String(body.text ?? "");
      if (!userText) {
        return new Response(JSON.stringify({ ok: false, error: "missing text" }), { status: 400 });
      }
      if (userText.length > 4000) {
        return new Response(JSON.stringify({ ok: false, error: "text_too_long" }), { status: 413 });
      }

      const history = await loadHistory(this.state);
      history.push({ role: "user", content: userText, ts: Date.now() });

      const makeModel = createWorkersAIClient(this.env);
      const model = makeModel(MODEL_ID as never);

      const result = await streamText({
        system: "You are a concise, helpful assistant.",
        messages: history.map(h => ({ role: h.role, content: h.content })),
        model
      });

      let assistant = "";
      for await (const chunk of result.textStream) assistant += chunk;

      history.push({ role: "assistant", content: assistant || "ok", ts: Date.now() });
      await saveHistory(this.state, history, true);

      return new Response(JSON.stringify({ ok: true, reply: assistant || "ok", history }), {
        headers: { "content-type": "application/json" }
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const jobs = (await this.state.storage.get<Job[]>("jobs")) ?? [];
    const due = jobs.filter(j => j.runAt <= now);
    const future = jobs.filter(j => j.runAt > now);

    if (due.length > 0) {
      const history = await loadHistory(this.state);
      const makeModel = createWorkersAIClient(this.env);
      const model = makeModel(MODEL_ID as never);

      for (const job of due) {
        const result = await streamText({
          system: "You are a concise, helpful assistant.",
          messages: [...history.map(h => ({ role: h.role, content: h.content })), { role: "user", content: job.prompt }],
          model
        });
        let assistant = "";
        for await (const chunk of result.textStream) assistant += chunk;
        history.push({ role: "assistant", content: assistant || "ok", ts: Date.now() });
      }
      await saveHistory(this.state, history, false);
    }

    const nextPruneAt = (await this.state.storage.get<number>("nextPruneAt")) ?? 0;
    if (now >= nextPruneAt) {
      const history = await loadHistory(this.state);
      await saveHistory(this.state, history, false);
      const next = now + DAILY_MS;
      await this.state.storage.put("nextPruneAt", next);
      await this.state.storage.setAlarm(new Date(next));
    } else if (future.length > 0) {
      const next = Math.min(nextPruneAt || Infinity, Math.min(...future.map(j => j.runAt)));
      await this.state.storage.put("jobs", future);
      await this.state.storage.setAlarm(new Date(next));
    } else if (nextPruneAt) {
      await this.state.storage.setAlarm(new Date(nextPruneAt));
    } else {
      const next = now + DAILY_MS;
      await this.state.storage.put("nextPruneAt", next);
      await this.state.storage.setAlarm(new Date(next));
    }
  }
}
