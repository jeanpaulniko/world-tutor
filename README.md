# World Tutor

**Free, open-source AI tutor for everyone. Any subject, any language, any phone.**

Uses the Socratic method — guides you to discover answers through questions, not lectures. This produces deeper understanding and better retention.

## Why

1.5 billion students lack access to quality tutoring. An educated person goes on to solve other problems. No other intervention has this multiplier effect.

## Features

- **Socratic method** — asks questions, not answers
- **Multilingual** — responds in whatever language you write
- **Any subject** — math, science, history, coding, languages
- **Works on any phone** — PWA, < 200KB, offline support
- **Free forever** — costs ~$20/month to run for 100+ users
- **Open source** — MIT license, self-host in minutes

## Quick Start

```bash
git clone https://github.com/jeanpaulniko/world-tutor.git
cd world-tutor
npm install
cp .env.example .env
# Add your API key to .env (get one free at siliconflow.cn)
npm run dev
# Open http://localhost:5173
```

## Self-Host (One Command)

```bash
# Get a free API key at https://siliconflow.cn
export LLM_API_KEY=your-key-here
npm install && npm run build && npm start
```

## Cost

| Item | Monthly Cost |
|------|-------------|
| Hosting (Railway) | $5-15 |
| LLM API (100 users) | $3-5 |
| **Total** | **~$20/month** |

Uses SiliconFlow's Llama 3.1 8B at $0.20 per million tokens — 10x cheaper than OpenAI.

## Tech Stack

- **Frontend:** React + TypeScript + Vite (PWA)
- **Backend:** Express + TypeScript
- **Database:** SQLite (zero cost, embedded)
- **LLM:** Any OpenAI-compatible API (default: SiliconFlow)

## Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/worldtutor)

Or manually:
1. Fork this repo
2. Connect to Railway
3. Set `LLM_API_KEY` environment variable
4. Deploy

## License

MIT — do whatever you want with it. Teach the world.
