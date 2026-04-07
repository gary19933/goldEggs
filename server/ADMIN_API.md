# Golden Eggs Admin Rate API

This microservice now supports global game-rate settings for third-party backoffice.

## Environment variables

- `ADMIN_API_KEY` (optional but recommended): admin auth key checked via `x-admin-key` header.
- `GAME_CONFIG_PATH` (optional): rate config file path. Default: `server/data/game-config.json`.

## Endpoints

### 1) Get current rates

- `GET /admin/game-config`
- Header (if `ADMIN_API_KEY` is set): `x-admin-key: <your-key>`

Response:

```json
{
  "apiStatus": "ok",
  "config": {
    "winRate": 0.5,
    "bonusRate": 0.01,
    "updatedAt": "2026-04-07T03:20:00.000Z",
    "updatedBy": "ops-admin",
    "forceWin": false,
    "forceBonus": false
  },
  "serverTime": "2026-04-07T03:20:10.000Z"
}
```

### 2) Update rates globally (applies to all players)

- `PUT /admin/game-config`
- Header (if `ADMIN_API_KEY` is set): `x-admin-key: <your-key>`
- Body (JSON): `winRate`, `bonusRate`, `updatedBy`

Body example:

```json
{
  "winRate": 0.42,
  "bonusRate": 0.05,
  "updatedBy": "third-party-backoffice"
}
```

Notes:

- You can update only one field (e.g. just `winRate`).
- Accepts decimal `0..1` or percentage `0..100`.
- New values are persisted and used immediately for every player.
