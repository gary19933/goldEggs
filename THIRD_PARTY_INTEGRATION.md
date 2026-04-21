# Golden Eggs Third-Party Integration Guide

Use this guide when handing the Golden Eggs game to a partner platform or wallet/backoffice team.

## What This Project Contains

- Frontend game: Vite + PixiJS.
- Backend microservice: Express API in `server/index.js`.
- SDK build: `dist-sdk/golden-eggs-sdk.iife.js` or `dist-sdk/golden-eggs-sdk.umd.js`.
- Hosted page build: `dist/index.html` and `dist/assets/*`.

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
- `eggs` for egg labels and prices
- `currency`
- `maxStored`
- `maxCracks`
- `info.title`
- `info.steps`

Example:

```json
{
  "eggs": [
    { "id": "gold", "label": "Gold Egg", "bet": 100 },
    { "id": "premium", "label": "Premium Egg", "bet": 1000 }
  ],
  "maxStored": 3,
  "maxCracks": 12,
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
- Game settings: `winRate`, `bonusRate`, egg prices, max stored eggs, max cracks, and info text.
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

## Current Risks To Discuss Before Launch

- The backend receives `token` but does not validate it yet.
- CORS is currently open to all origins.
- Player state and game config are stored in local JSON files.
- Admin auth is optional unless `ADMIN_API_KEY` is configured.
- There is no production wallet callback or transaction idempotency layer yet.
- `redeem` should be limited to trusted backoffice/server-side calls.
