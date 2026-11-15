# Notes API

A REST API built with Node.js 20, Express 5, ES modules, and Neon Postgres.

## Setup

1. In Neon, create a project and copy its pooled or direct Postgres connection string from the project dashboard.
2. Create `.env` in the project root:

   ```dotenv
   DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
   JWT_SECRET=replace-with-at-least-32-random-characters
   PORT=3000
   ```

   Generate a secret locally, for example with `openssl rand -base64 32`. Do not commit `.env`.
3. Install dependencies with `npm install`.
4. Create the tables in the connected Neon database using `src/db/schema.sql` (for example, run it with `psql "$DATABASE_URL" -f src/db/schema.sql`).
5. Start the server with `npm run dev`. The API listens on `http://localhost:3000`.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | No | Checks database connectivity |
| `POST` | `/api/auth/register` | No | Creates an account and returns a JWT |
| `POST` | `/api/auth/login` | No | Verifies credentials and returns a JWT |
| `GET` | `/api/auth/me` | Bearer token | Returns the current user |
| `GET` | `/api/notes` | Bearer token | Lists the current user's notes; supports `q`, `tag`, `pinned`, `page`, and `limit` |
| `GET` | `/api/notes/:id` | Bearer token | Gets one of the current user's notes |
| `POST` | `/api/notes` | Bearer token | Creates a note |
| `PATCH` | `/api/notes/:id` | Bearer token | Updates a note |
| `DELETE` | `/api/notes/:id` | Bearer token | Deletes a note |

Validation errors return `422`, duplicate registration returns `409`, missing or invalid authentication returns `401`, and inaccessible notes return `404`.

## Authentication flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant DB as Neon Postgres
    Client->>API: POST /api/auth/register (name, email, password)
    API->>API: Validate input and hash password with bcrypt
    API->>DB: Insert user and password_hash
    DB-->>API: User row (without password_hash)
    API-->>Client: 201 user + signed HS256 JWT (1h)
    Client->>API: GET /api/notes (Authorization: Bearer token)
    API->>API: Verify JWT signature and expiry
    API->>DB: Query notes scoped to token subject
    DB-->>API: User's notes
    API-->>Client: Notes
```

JWTs are signed, not encrypted: their header and payload can be decoded by anyone holding the token. Keep sensitive data, passwords, password hashes, and secrets out of JWT payloads.

## Tests

Tests use `node:test` and Supertest and make real requests to an isolated Neon branch. Create a separate branch in the Neon console (or with the Neon CLI) for tests; a branch gets an independent database endpoint and its own writes, so test data and schema changes do not affect the production branch. Use a disposable branch with the same parent/schema as the app database.

Set its connection string in `TEST_DATABASE_URL`, never in `DATABASE_URL`, and run:

```sh
TEST_DATABASE_URL='postgresql://user:password@test-branch-host/dbname?sslmode=require' npm test
```

The test setup sets `DATABASE_URL` from `TEST_DATABASE_URL`, creates the required tables if absent, and removes the test users it creates afterward. It generates an ephemeral `JWT_SECRET` for the test process if one is not already set. The tests fail before loading the app if `TEST_DATABASE_URL` is unset, preventing accidental test writes to the app database.

## Security protections

- Helmet security headers, CORS allowlisting for `http://localhost:5173` and `http://localhost:3000`, and a 100 KB JSON request limit.
- Zod request validation, including a 10-character letter-and-number password rule and UUID note IDs.
- bcryptjs password hashes with cost 12; API responses never include password hashes.
- HS256 JWTs with a one-hour expiry; bearer verification explicitly restricts the allowed algorithm.
- Auth routes rate-limited to 10 requests per IP per 15 minutes.
- Parameterized Neon tagged-template SQL; note reads, updates, and deletes are scoped to the authenticated user. Missing and other users' notes both return 404 to avoid disclosing whether a note exists.
- Production errors return a generic server message and do not expose stack traces or SQL details.

Use HTTPS in production and keep both `DATABASE_URL` and `JWT_SECRET` secret.
