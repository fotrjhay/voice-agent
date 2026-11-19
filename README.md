# Business Voice Assistant

A customizable AI voice assistant that can answer business questions using company knowledge. It combines real-time voice, retrieval-augmented generation (RAG), and a private dashboard for managing assistant settings and documents.

## Features

- Real-time browser voice powered by Pipecat, with OpenAI Realtime as an alternative backend
- Knowledge search through a configurable RAG service
- Admin dashboard for business settings and document uploads
- Dropbox-backed document storage
- Supabase Auth and Postgres for admin access and settings
- TypeScript, Next.js, and React

## Run locally

Requires Node.js 22.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Configure the required service URLs and credentials in `.env.local`. Keep secrets out of source control. Open [http://localhost:3000](http://localhost:3000).

## Checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Project layout

- `app/` — voice experience, admin dashboard, and API routes
- `lib/` — voice, retrieval, settings, and document services
- `migrations/` — database schema changes
- `tests/` — unit and runtime smoke tests
