# Mini-k8

A minimal, Kubernetes-inspired container orchestrator. Submit a container image (and an optional command) over a REST API, and a set of background workers move each job through a state machine — eventually pulling the image and running it as a Docker container on the host.

It's a learning-oriented re-implementation of the core control-loop pattern that real orchestrators (Kubernetes, Nomad, AWS Batch) use: a declarative API, a persisted desired/observed state, and reconciler loops that drive jobs toward completion.

---

## Architecture

![Mini-k8 architecture](./system-design.png)

A user submits a job to the API, which persists it to Postgres as `SUBMITTED`. BullMQ schedulers (backed by Valkey) trigger three reconciler loops that advance the job through its state machine and ultimately run it as a Docker container.

### Components

| Component | File | Responsibility |
|-----------|------|----------------|
| **API Server** | `src/server.ts` | Accepts job submissions, persists them as `SUBMITTED`. |
| **Schedulers** | `src/queues/queues.ts` | BullMQ queues that fire repeatable jobs to trigger each worker. |
| **Scheduler bootstrap** | `src/scheduler.ts` | Registers the repeatable schedules and starts the workers. |
| **Workers** | `src/queues/worker.ts` | Three reconciler loops that advance job state and talk to Docker. |
| **Database** | `src/db/` | Drizzle ORM schema + connection (`jobs` table). |

### Job state machine

```
SUBMITTED ──▶ RUNNABLE ──▶ RUNNING ──▶ SUCCEEDED
                                   └──▶ FAILED
```

- **`job-dispatcher`** — claims `SUBMITTED` jobs (`FOR UPDATE SKIP LOCKED`) and marks them `RUNNABLE`.
- **`job-cri`** — claims a `RUNNABLE` job, pulls the image if missing, creates + starts the container, and marks it `RUNNING` with the `container_id`.
- **`job-watch`** — inspects `RUNNING` containers; when one exits, marks the job `SUCCEEDED` and removes the container.

> "CRI" stands for *Container Runtime Interface* — the layer that actually talks to Docker, mirroring Kubernetes terminology.

---

## Tech stack

- **Runtime:** Node.js (ESM) + TypeScript
- **API:** Express 5
- **Queues / scheduling:** BullMQ on Valkey (Redis-compatible)
- **Database:** PostgreSQL + Drizzle ORM
- **Container runtime:** Docker via `dockerode`
- **Dev tooling:** `tsx` (run TS directly), `tsc` (production build), `drizzle-kit` (migrations)

---

## Prerequisites

- **Node.js** 20+
- **pnpm** 10+
- **Docker** running locally (the workers talk to the Docker socket)

---

## Getting started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

```env
DATABASE_URL=postgres://admin:admin@localhost:5432/dev
PORT=8000
```

### 3. Start infrastructure (Postgres + Valkey)

```bash
docker compose up -d
```

### 4. Run database migrations

```bash
pnpm db:migrate
```

### 5. Start the app (development)

In two terminals:

```bash
pnpm dev          # API server  (tsx watch)
```

```bash
pnpm run worker   # schedulers + workers  (tsx watch)
```

---

## Usage

Submit a job (only `image` is required; `cmd` is optional):

```bash
curl -X POST http://localhost:8000/job \
  -H "Content-Type: application/json" \
  -d '{"image":"nginx"}'
```

```json
{ "jobId": "5e090aa1-9c7c-46ac-93a0-8310dbba6383" }
```

With a command:

```bash
curl -X POST http://localhost:8000/job \
  -H "Content-Type: application/json" \
  -d '{"image":"busybox","cmd":"echo hello from mini-k8"}'
```

Watch the worker logs as the job moves `SUBMITTED → RUNNABLE → RUNNING → SUCCEEDED`. Inspect rows directly:

```bash
docker exec mini-k8-postgres-1 psql -U admin -d dev \
  -c "SELECT id, image, cmd, state FROM jobs ORDER BY created_at;"
```

Or open Drizzle Studio:

```bash
pnpm db:studio
```

---

## API

### `GET /`

Health check. Returns `Server is running`.

### `POST /job`

Submit a new job.

**Body**

| Field   | Type             | Required | Description                          |
|---------|------------------|----------|--------------------------------------|
| `image` | string           | yes      | Container image (e.g. `nginx`).      |
| `cmd`   | string \| null   | no       | Command to run inside the container. |

**Responses**

- `201 Created` — `{ "jobId": "<uuid>" }`
- `400 Bad Request` — `{ "error": "Image is required" }`

---

## Scripts

| Script             | Command                  | Description                                   |
|--------------------|--------------------------|-----------------------------------------------|
| `pnpm dev`         | `tsx watch src/server.ts`| Run API server in watch mode.                 |
| `pnpm run worker`  | `tsx watch src/scheduler.ts` | Run schedulers + workers in watch mode.   |
| `pnpm build`       | `tsc --noCheck`          | Compile `src/` → `dist/`.                      |
| `pnpm start`       | `node dist/server.js`    | Run the compiled API server.                  |
| `pnpm start:worker`| `node dist/scheduler.js` | Run the compiled schedulers + workers.        |
| `pnpm typecheck`   | `tsc --noEmit`           | Type-check without emitting.                   |
| `pnpm db:generate` | `drizzle-kit generate`   | Generate a migration from the schema.         |
| `pnpm db:migrate`  | `drizzle-kit migrate`    | Apply pending migrations.                      |
| `pnpm db:studio`   | `drizzle-kit studio`     | Open Drizzle Studio.                           |

### Production build

```bash
pnpm build
pnpm start          # API
pnpm start:worker   # workers
```

---

## Project structure

```
Mini-k8/
├── src/
│   ├── server.ts            # Express API
│   ├── scheduler.ts         # Registers schedules, starts workers
│   ├── db/
│   │   ├── index.ts         # Drizzle connection
│   │   └── schema.ts        # jobs table + status enum
│   └── queues/
│       ├── queues.ts        # BullMQ queues (schedulers)
│       └── worker.ts        # dispatcher / cri / watch workers
├── drizzle/                 # Generated SQL migrations (committed)
├── docker-compose.yml       # Postgres + Valkey
├── drizzle.config.ts        # Drizzle Kit config
├── tsconfig.json
└── package.json
```

---

## Notes & limitations

This is an educational project, not production software. Known gaps:

- **No authentication.** `POST /job` runs arbitrary container images on the host — never expose it publicly.
- **No resource limits** (CPU/memory) on spawned containers.
- Image tags are normalized to `:latest`, so explicitly tagged images aren't honored yet.
- Failure paths are not fully wired to the `FAILED` state.

These are intentional next steps for anyone extending the project.

---

## License

ISC
