import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import request from "supertest";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is required. Set it to a dedicated Neon test branch before running npm test.",
  );
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= randomBytes(32).toString("base64url");

const [{ default: app }, { sql }] = await Promise.all([
  import("../src/app.js"),
  import("../src/db.js"),
]);

const testEmails = [];

async function register(name) {
  const email = `test-${randomUUID()}@example.com`;
  testEmails.push(email);
  const response = await request(app)
    .post("/api/auth/register")
    .send({ name, email, password: "TestPassword123" });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return { ...response.body, email };
}

before(async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      title text NOT NULL,
      body text NOT NULL,
      tags text[] NOT NULL DEFAULT '{}',
      pinned boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
});

after(async () => {
  for (const email of testEmails) {
    await sql`DELETE FROM users WHERE email = ${email}`;
  }
});

test("register and login return a token and never expose the password hash", async () => {
  const email = `test-${randomUUID()}@example.com`;
  testEmails.push(email);

  const registration = await request(app)
    .post("/api/auth/register")
    .send({ name: "Test User", email: email.toUpperCase(), password: "TestPassword123" });

  assert.equal(registration.status, 201);
  assert.equal(registration.body.user.email, email);
  assert.equal(typeof registration.body.token, "string");
  assert.equal("password_hash" in registration.body.user, false);

  const login = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "TestPassword123" });

  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, registration.body.user.id);
  assert.equal(typeof login.body.token, "string");
  assert.equal("password_hash" in login.body.user, false);

  const invalidLogin = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "wrong-password" });
  assert.equal(invalidLogin.status, 401);
  assert.equal(invalidLogin.body.error.message, "Invalid email or password");

  const duplicate = await request(app)
    .post("/api/auth/register")
    .send({ name: "Test User", email, password: "TestPassword123" });
  assert.equal(duplicate.status, 409);

  const invalidRegistration = await request(app)
    .post("/api/auth/register")
    .send({ name: "", email: "not-an-email", password: "short" });
  assert.equal(invalidRegistration.status, 422);
  assert.ok(invalidRegistration.body.error.details.email);
  assert.ok(invalidRegistration.body.error.details.password);
});

test("notes require authentication", async () => {
  const response = await request(app).get("/api/notes");
  assert.equal(response.status, 401);
  assert.match(response.headers["www-authenticate"], /^Bearer/);
});

test("users cannot read, update, or delete another user's note", async () => {
  const owner = await register("Note Owner");
  const otherUser = await register("Another User");
  const created = await request(app)
    .post("/api/notes")
    .set("Authorization", `Bearer ${owner.token}`)
    .send({ title: "Private note", body: "Owned by the first user" });

  assert.equal(created.status, 201, JSON.stringify(created.body));
  const noteId = created.body.note.id;
  const authorization = `Bearer ${otherUser.token}`;

  const getResponse = await request(app)
    .get(`/api/notes/${noteId}`)
    .set("Authorization", authorization);
  assert.equal(getResponse.status, 404);

  const patchResponse = await request(app)
    .patch(`/api/notes/${noteId}`)
    .set("Authorization", authorization)
    .send({ title: "Attempted change" });
  assert.equal(patchResponse.status, 404);

  const deleteResponse = await request(app)
    .delete(`/api/notes/${noteId}`)
    .set("Authorization", authorization);
  assert.equal(deleteResponse.status, 404);

  const ownerResponse = await request(app)
    .get(`/api/notes/${noteId}`)
    .set("Authorization", `Bearer ${owner.token}`);
  assert.equal(ownerResponse.status, 200);
  assert.equal(ownerResponse.body.note.title, "Private note");
});
