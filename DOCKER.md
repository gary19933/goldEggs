# Golden Eggs Docker Setup

This setup runs the app as two containers:

- `backend`: Express API on port `3001`.
- `frontend`: Nginx frontend on port `8080`.

The frontend proxies API calls to the backend:

```text
/game/*  -> backend:3001/game/*
/admin/* -> backend:3001/admin/*
```

## Files

```text
Dockerfile.server
Dockerfile.frontend
docker-compose.yml
docker/nginx.conf
.env.docker.example
```

## Run Locally

Copy the sample environment file:

```bash
cp .env.docker.example .env
```

Start the containers:

```bash
docker compose up --build
```

Open:

```text
Frontend: http://localhost:8080
Backend:  http://localhost:3001
```

## Environment Variables

```env
ADMIN_API_KEY=replace-with-strong-secret
FORCE_WIN=false
FORCE_BONUS=false
VITE_API_BASE_URL=
```

For production, keep `FORCE_WIN=false` and `FORCE_BONUS=false`.

Leave `VITE_API_BASE_URL` empty when using the included Nginx proxy. Set it only if the API is hosted separately, for example:

```env
VITE_API_BASE_URL=https://api.example.com
```

## Persistent Data

Docker Compose mounts these folders:

```text
server/data
server/logs
```

For production, replace the JSON file storage with the partner's database or wallet ledger.
