# Golden Eggs Third-Party Integration Guide

Use this guide when handing the Golden Eggs game to a partner platform or wallet/backoffice team.

## What This Project Contains

- Frontend game: Vite + PixiJS.
- Backend microservice: Express API in `server/index.js`.
- SDK build: `dist-sdk/golden-eggs-sdk.iife.js` or `dist-sdk/golden-eggs-sdk.umd.js`.
- Hosted page build: `dist/index.html` and `dist/assets/*`.

## Handoff Package Contents

Send these files and folders to the third-party team:

```text
THIRD_PARTY_INTEGRATION.md
DOCKER.md
server/ADMIN_API.md
dist/
dist-sdk/
server/
assets/
docker/
Dockerfile.frontend
Dockerfile.server
docker-compose.yml
.env.docker.example
.dockerignore
package.json
package-lock.json
vite.config.js
vite.config.sdk.js
index.html
src/
```

Do not send local-only files:

```text
node_modules/
.git/
.env
server/data/
server/logs/
frontend-demo.log
frontend-demo.err.log
server-demo.log
server-demo.err.log
```

## Integration Options

### Option A: Hosted Page / iframe

Host the built `dist/` folder and let the partner open or iframe the game URL.

Example:

```html
<iframe
  src="https://your-game-domain.example/?userId=PLAYER_ID&token=SESSION_TOKEN&lang=en"
  style="width: 100%; height: 100vh; border: 0;"
></iframe>
```

The game posts action results to the parent window:

```js
window.addEventListener('message', (event) => {
  if (event.data?.type === 'GAME_RESULT') {
    console.log(event.data.payload);
  }
});
```

### Option B: JavaScript SDK

Host these SDK files:

- `dist-sdk/golden-eggs-sdk.iife.js`
- `dist-sdk/style.css`

Example:

```html
<link rel="stylesheet" href="https://your-cdn.example/golden-eggs/style.css" />
<div id="golden-eggs-root" style="width: 100%; height: 100vh;"></div>
<script src="https://your-cdn.example/golden-eggs/golden-eggs-sdk.iife.js"></script>
<script>
  window.GoldenEggs.init({
    container: document.getElementById('golden-eggs-root'),
    userId: 'PLAYER_ID',
    token: 'SESSION_TOKEN',
    lang: 'en',
    onResult(payload) {
      console.log(payload);
    },
  });
</script>
```

## Required Frontend Environment

Set this before building the frontend for production:

```env
VITE_API_BASE_URL=https://your-api-domain.example
VITE_API_USE_MOCK=false
```

Development can run in mock mode without a backend:

```env
VITE_API_USE_MOCK=true
```

## Backend Environment Variables

```env
PORT=3001
ADMIN_API_KEY=replace-with-strong-secret
STATE_PATH=server/data/state.json
LOG_PATH=server/logs/transactions.jsonl
GAME_CONFIG_PATH=server/data/game-config.json
FORCE_WIN=false
FORCE_BONUS=false
```

Important:

- `ADMIN_API_KEY` is optional in code, but should be required in production.
- `FORCE_WIN` and `FORCE_BONUS` are test flags only. Keep them false in production.
- Current storage is JSON file based. For production, replace or wrap it with the partner's database/wallet ledger.

## Game API

All game endpoints accept and return JSON.

### Initialize Game

`POST /game/init`

Request:

```json
{
  "userId": "PLAYER_ID",
  "token": "SESSION_TOKEN",
  "lang": "en"
}
```

Response includes player balance, egg config, stored eggs, history, and server time.

### Player Action

`POST /game/action`

Supported actions:

- `buy`
- `crack`
- `store`
- `retrieve`
- `redeem`

Request:

```json
{
  "userId": "PLAYER_ID",
  "token": "SESSION_TOKEN",
  "action": "crack",
  "eggId": "gold-123",
  "eggType": "gold",
  "betAmount": 100,
  "tryIndex": 0
}
```

Response:

```json
{
  "apiStatus": "ok",
  "balance": 900,
  "status": 1,
  "result": "win",
  "winAmount": 100,
  "chargeAmount": 0,
  "eggId": "gold-123",
  "eggType": "gold",
  "tryIndex": 1,
  "level": 2,
  "bonus": false,
  "serverTime": "2026-04-21T09:00:00.000Z"
}
```

Status meanings:

- `1`: win or successful non-settlement action
- `0`: lose
- `2`: redeemed
- `null`: action has no win/lose status, such as buy/store/retrieve

### Game History

`POST /game/history`

Request:

```json
{
  "userId": "PLAYER_ID"
}
```

## Admin Game Config API

See `server/ADMIN_API.md` for full details.

The partner backoffice can read and update global game settings:

- `GET /admin/game-config`
- `PUT /admin/game-config`

If `ADMIN_API_KEY` is set, requests must include:

```http
x-admin-key: replace-with-strong-secret
```

Adjustable fields:

- `winRate`
- `bonusRate`
- `eggs` for egg names, labels, selling prices, and per-level crack amounts
- `currency`
- `maxStored`
- `info.title`
- `info.steps`

Example:

```json
{
  "eggs": [
    {
      "id": "gold",
      "name": "Gold Egg",
      "label": "Gold Egg",
      "bet": 100,
      "levels": [100, 200, 400, 800]
    },
    {
      "id": "premium",
      "name": "Premium Egg",
      "label": "Premium Egg",
      "bet": 1000,
      "levels": [1000, 2000, 4000, 8000]
    }
  ],
  "maxStored": 3,
  "info": {
    "title": "How To Play",
    "steps": [
      "Choose an egg package.",
      "Buy the egg to start the first crack.",
      "If the crack wins, you can continue to the next level.",
      "If the crack loses, the egg is finished."
    ]
  },
  "updatedBy": "third-party-backoffice"
}
```

`levels` controls how many levels each egg has. When `levels` is provided, `levels[0]` is level 1, `levels[1]` is level 2, and so on. Each level can be either a legacy amount or a full level config object with `label`/`name`, `cost`, `prize`, `winRate`, `bonusRate`, `fullImageUrl`, and `crackImageUrl`. If a level omits `winRate` or `bonusRate`, the global game rates are used. Egg type skin fields are also optional: `backgroundImageUrl`, `tabImageUrl`, `tabActiveImageUrl`, `buttonImageUrl`, and `labelImageUrl`. If omitted, the game inherits the existing gold/premium fallback design. `bet` is only the fallback/base selling price when `levels` is omitted.

## Production Handoff Checklist

Prepare these items for the third-party team:

- Final hosted game URL or SDK CDN URLs.
- API base URL for the backend.
- Allowed domains for CORS.
- Test player `userId` and `token`.
- Production authentication plan for validating `token`.
- Wallet/debit/credit rules for `buy`, `crack`, and `redeem`.
- Database or ledger integration plan to replace JSON file state.
- Admin API key and backoffice IP/domain access rules.
- Game settings: `winRate`, `bonusRate`, egg names/labels, per-level cost/prize/image settings, max stored eggs, and info text.
- Expected callback contract for iframe `GAME_RESULT` or SDK `onResult`.
- Support flow for `redeem`, because the current code treats redeem as a backoffice settlement action.

## Build Commands

```bash
npm install
npm run build
npm run build:sdk
```

Backend:

```bash
npm run dev:server
```

Frontend dev:

```bash
npm run dev
```

## Docker Deployment

This project includes Docker files for a two-container deployment:

- `Dockerfile.server`: backend Express microservice.
- `Dockerfile.frontend`: built frontend served by Nginx.
- `docker/nginx.conf`: serves the frontend and proxies `/game/*` and `/admin/*` to the backend service.
- `docker-compose.yml`: runs both services together.

Run locally:

```bash
docker compose up --build
```

URLs:

```text
Frontend: http://localhost:8080
Backend:  http://localhost:3001
```

The frontend container can call the backend through the same frontend domain because Nginx proxies:

```text
/game/*  -> backend:3001/game/*
/admin/* -> backend:3001/admin/*
```

Optional environment variables:

```env
ADMIN_API_KEY=replace-with-strong-secret
FORCE_WIN=false
FORCE_BONUS=false
VITE_API_BASE_URL=
```

For production, keep `FORCE_WIN` and `FORCE_BONUS` set to `false`. If the API is hosted on a separate domain, set `VITE_API_BASE_URL=https://your-api-domain.example` before building the frontend image.

## Current Risks To Discuss Before Launch

- The backend receives `token` but does not validate it yet.
- CORS is currently open to all origins.
- Player state and game config are stored in local JSON files.
- Admin auth is optional unless `ADMIN_API_KEY` is configured.
- There is no production wallet callback or transaction idempotency layer yet.
- `redeem` should be limited to trusted backoffice/server-side calls.
