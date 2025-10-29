# 🧠 AI Chat Agent (Cloudflare + Llama 3.3)

An intelligent real-time chatbot powered by **Llama 3.3 (70B Instruct)** on **Cloudflare Workers AI**.
This project runs a streaming chat agent with task scheduling and tool-integration support, fully deployable on Cloudflare.

---

## 🚀 Features

- ⚡ Powered by Llama 3.3 (70B-Instruct)
- 💬 Real-time streaming chat responses
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
   `git clone https://github.com/shiyoukh/cf_ai_agent.git && cd cf_ai_agent`

2. **Install dependencies**
   `npm install`

3. **Start server**
   `npm start`

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
   `npm start`

2. **Open the local dev URL shown in your terminal** (usually `http://127.0.0.1:8787/`)
   You’ll see the **AI Chat Agent UI**. Try messages like:
   - `hello`
   - `what is 1+1?`
     If configured correctly, you’ll get real Llama 3.3 responses streamed from Cloudflare Workers AI.

---

## 🚀 Deploy to Cloudflare

When ready to deploy:
`npm run deploy`
or directly:
`wrangler deploy`

---

## 🧩 Debugging

**Health Check:**
Visit `/check-open-ai-key` — returns `{ "success": true }` if your Worker is configured correctly.

**Debug Endpoint:**
Visit `/debug-model` — should return “ok” if the model is reachable.

---

## 🛠 Project Structure

```
src/
├── index.ts              # Worker entrypoint (routes requests)
├── agents/
│   ├── ai-chat-agent.ts  # Base chat agent class
│   └── schedule.ts       # Schedule prompt logic
├── tools/                # Tool definitions and execution handlers
├── utils/                # Helper functions
```

---

## 💡 Notes

- Default model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Change model in `src/index.ts` by editing:
  `const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";`
- Tool-calling is disabled by default for stability. To enable:
  `const SUPPORTS_TOOLS = true;`

---

## 🧑‍💻 Local Development Shortcuts

| Command          | Description            |
| ---------------- | ---------------------- |
| `npm start`      | Run worker locally     |
| `npm run deploy` | Deploy to Cloudflare   |
| `npm run build`  | Build TypeScript       |
| `wrangler tail`  | Stream production logs |

---

## 🧾 License

MIT License © 2025 — Built with ❤️ by Ali Alshiyoukh

---

## ⚡ Quick Recap

1. Clone the repo
2. Install dependencies
3. Add `[ai]` binding or set secrets
4. Run `npm start`
5. Chat with your bot locally
6. Deploy using `wrangler deploy`

Enjoy your Llama-powered chatbot on Cloudflare 🦙☁️
