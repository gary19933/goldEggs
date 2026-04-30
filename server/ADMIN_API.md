# Golden Eggs Admin Game Config API

This microservice supports global game settings for third-party backoffice.

## Environment variables

- `ADMIN_API_KEY` (optional but recommended): admin auth key checked via `x-admin-key` header.
- `GAME_CONFIG_PATH` (optional): game config file path. Default: `server/data/game-config.json`.

## Endpoints

### 1) Get current game config

- `GET /admin/game-config`
- Header (if `ADMIN_API_KEY` is set): `x-admin-key: <your-key>`

Response:

```json
{
  "apiStatus": "ok",
  "config": {
    "winRate": 0.5,
    "bonusRate": 0.01,
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
    "currency": "RM",
    "maxStored": 3,
    "info": {
      "title": "How To Play",
      "steps": [
        "On the game page, choose the egg you want to buy from the tabs.",
        "Use the required UCoins to buy the selected egg."
      ]
    },
    "updatedAt": "2026-04-07T03:20:00.000Z",
    "updatedBy": "ops-admin",
    "forceWin": false,
    "forceBonus": false
  },
  "serverTime": "2026-04-07T03:20:10.000Z"
}
```

### 2) Update game config globally (applies to all players)

- `PUT /admin/game-config`
- Header (if `ADMIN_API_KEY` is set): `x-admin-key: <your-key>`
- Body (JSON): any of `winRate`, `bonusRate`, `eggs`, `currency`, `maxStored`, `info`, `infoTitle`, `infoSteps`, `updatedBy`

Body example:

```json
{
  "winRate": 0.42,
  "bonusRate": 0.05,
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
  "currency": "RM",
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

Notes:

- You can update only one field (e.g. just `maxStored`).
- Accepts decimal `0..1` or percentage `0..100`.
- `eggs` must be a non-empty array. Each egg needs a unique `id`; `name` and `label` are optional display fields.
- `bet` is the selling price/base amount. If `levels` is provided, `levels[0]` becomes the buy price and first crack value.
- `levels` controls how many levels the egg has. If an egg has 12 level entries, that egg has 12 levels.
- `levels` may contain positive amounts for legacy configs, or objects with `label`/`name`, `cost`, `prize`, `fullImageUrl`, and `crackImageUrl`.
- `cost` is the amount charged for that level. `prize` is the amount credited on win/redeem before the bonus multiplier.
- `fullImageUrl` and `crackImageUrl` should point to images hosted by the third-party CMS/CDN.
- If `levels` is not provided, the game keeps the old behavior: level values double from `bet`.
- `maxStored` must be a whole number from `1` to `12`.
- `info.steps` must contain at least one text string.
- New values are persisted and used immediately for every player.
