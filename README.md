# 🧠 AI Chat Agent (Cloudflare + Llama 3.3) 
# (LIVE ON [chatbot.shiyoukh.com](https://chatbot.shiyoukh.com))

An intelligent real-time chatbot powered by **Llama 3.3 (70B Instruct)** on **Cloudflare Workers AI**.  
This project runs a streaming chat agent with task scheduling and multi-session memory using Durable Objects, fully deployable on Cloudflare.

# This project is now live on [chatbot.shiyoukh.com](https://chatbot.shiyoukh.com)! I am currently self-hosting it.

---

## 🚀 Features

- ⚡ Powered by Llama 3.3 (70B-Instruct)
- 💬 Real-time streaming chat responses
- 🧠 Persistent multi-session chat memory (via Durable Objects)
- 🧩 Extensible tool system for task automation
- 🕒 Built-in schedule tool support
- ☁️ Deployable on Cloudflare Workers
- 🧱 TypeScript-based, modular structure

---

## 🧩 Prerequisites

- Node.js 18+
- npm
- Wrangler CLI
- Cloudflare account
- Existing Cloudflare Worker project

---

## ⚙️ Setup

1. **Clone this repository**
   ```
   git clone https://github.com/shiyoukh/cf_ai_agent.git && cd cf_ai_agent
   ```

2. **Install dependencies**
   ```
   npm install
   ```

3. **Start the local server**
   ```
   npm start
   ```

---

## ☁️ Configure Cloudflare AI

You can connect to Workers AI using **either** the native `[ai]` binding (recommended) or via API key + gateway URL.

### Option A — Native [ai] Binding (recommended)

In `wrangler.toml`:

```
[ai]
binding = "AI"
```

### Option B — Gateway / API Key (manual config)

If you’re using a Cloudflare AI Gateway or external endpoint, set secrets:

```
wrangler secret put WORKERSAI_API_KEY
wrangler secret put GATEWAY_BASE_URL
```

These will be available inside your worker as `env.WORKERSAI_API_KEY` and `env.GATEWAY_BASE_URL`.

---

## 🧠 Running the Chatbot Locally

1. **Start the development server**
   ```
   npm start
   ```

2. **Open the local dev URL shown in your terminal**
   (usually `http://127.0.0.1:8787/`)

   You’ll see the **AI Chat Agent UI**. Try messages like:
   - `hello`
   - `what is 1+1?`

   If configured correctly, you’ll get real Llama 3.3 responses streamed from Cloudflare Workers AI.

---

## 🔬 Testing the Components

This project includes a working front-end, Durable Object backend, and AI integration. You can test each module independently:

### ✅ 1. Chat Persistence (Durable Objects)

Each chat session is isolated using the `session` parameter in the URL:

- `http://localhost:5173/?session=a`
- `http://localhost:5173/?session=b`

Each session will maintain its own conversation history through the Durable Object state.

### ✅ 2. Follow-up Scheduling

Test the built-in scheduling feature:
1. Type a message in chat.
2. Click the clock (🕒) button.
3. Wait one minute — the scheduled follow-up will appear automatically from the server.
   This confirms that the Worker’s `alarm()` event and storage are functioning.

### ✅ 3. History Retrieval

You can return to any of your chat sessions and your chats will be there (Auto deletion currently set at every 14 days).

### ✅ 4. Error Handling & Debug

Use the following endpoints for diagnostics:
- `/check-open-ai-key` → returns `{ "success": true }` if Workers AI is configured.
- `/debug-model` → should return “ok” if the model is reachable.

---

## 🚀 Deploy to Cloudflare

When ready to deploy:
```
npm run deploy
```
or directly:
```
wrangler deploy
```

---

## 🛠 Project Structure

```
src/
├── server.ts            # Worker entrypoint (routes requests)
├── chat-do.ts           # Durable Object logic (sessions, scheduling)
├── agents/
│   ├── ai-chat-agent.ts # Base chat agent class
│   └── schedule.ts      # Schedule prompt logic
├── tools/               # Tool definitions and execution handlers
├── utils/               # Helper functions
```

---

## 🧠 Architecture Overview

- **Frontend (Vite + React):**
  Manages chat UI, message streaming, scheduling button, and real-time updates.
- **Backend (Cloudflare Worker):**
  Routes chat, history, and scheduling requests.
- **Durable Object (`Chat`):**
  Maintains session memory and executes scheduled jobs.
- **Workers AI Integration:**
  Streams responses from Llama 3.3 running on Cloudflare’s distributed inference engine.

---

## 💡 Notes

- Default model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Change model in `src/server.ts` by editing:
  ```
  const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  ```
- Tool-calling is disabled by default for stability. To enable:
  ```
  const SUPPORTS_TOOLS = true;
  ```

---

## 🧑‍💻 Local Development Shortcuts

| Command          | Description            |
| ---------------- | ---------------------- |
| `npm start`      | Run worker locally     |
| `npm run deploy` | Deploy to Cloudflare   |
| `npm run build`  | Build TypeScript       |
| `wrangler tail`  | Stream production logs |

---

## ⚡ Troubleshooting

| Issue | Cause | Fix |
|-------|--------|-----|
| Bot replies “ok” only | AI inference failed (code 1031) | Check `/debug-model` and Workers AI config |
| History resets after clear | Page auto-refresh re-fetches history | Wait until next scheduled refresh cycle |
| “AI not configured” banner | Missing `[ai]` binding | Add `[ai] binding = "AI"` in wrangler.toml |

---

## 🧾 License

MIT License © 2025 — Built with ❤️ by **Ali Alshiyoukh**

---

## ⚡ Quick Recap

1. Clone the repo  
2. Install dependencies  
3. Add `[ai]` binding or set secrets  
4. Run `npm start`  
5. Chat with your bot locally  
6. Test multi-session, scheduling, and history  
7. Deploy using `wrangler deploy`

Enjoy your Llama-powered chatbot on Cloudflare 🦙☁️
