# Neva Messenger — Claude Code Instructions

## Dev Login Credentials
- **Username:** ivan
- **Password:** 123456

## Project Structure
- `client/` — React frontend (Vite + TypeScript)
- `server/` — Hono backend (Bun runtime)

## Dev Servers
- Client: `npm run dev` on port 5173
- Server: `bun run dev` on port 3000
- launch.json configs: `mlsendger-client`, `mlsendger-server`

## Key Systems
- **Strategic Advisor** — mission planning, persona profiler, simulation (server/ai/)
- **Relationship Care** — nudges, mood radar, personal memory, tone advisor (server/ai/, server/routes/ai-tools.ts)
- **GuidedTour** — in-context onboarding with pulsating beacons (client/src/components/GuidedTour.tsx)

## Deploy
- Production URL: check deployment scripts in package.json
