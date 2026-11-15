import { Router } from "express";
import { z } from "zod";
import { sql } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../lib/validate.js";

const router = Router();

const positiveInteger = (maximum) =>
  z.preprocess(
    (value) => (value === undefined ? 1 : typeof value === "string" ? Number(value) : value),
    z.number().int().min(1).max(maximum),
  );

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().min(1).max(100).optional(),
  pinned: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  page: positiveInteger(1_000_000),
  limit: z.preprocess(
    (value) => (value === undefined ? 20 : typeof value === "string" ? Number(value) : value),
    z.number().int().min(1).max(100),
  ),
});

const noteIdSchema = z.object({ id: z.uuid() });

const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  pinned: z.boolean().default(false),
});

const updateNoteSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    body: z.string().optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

function notFound(res) {
  return res.status(404).json({ error: { message: "Note not found." } });
}

router.use(requireAuth);

router.get("/", validate(listQuerySchema, "query"), async (req, res) => {
  const { q = null, tag = null, pinned = null, page, limit } = req.validated.query;
  const offset = (page - 1) * limit;

  const [notes, counts] = await Promise.all([
    sql`
      SELECT id, user_id, title, body, tags, pinned, created_at, updated_at
      FROM notes
      WHERE (${q}::text IS NULL OR title ILIKE '%' || ${q} || '%' OR body ILIKE '%' || ${q} || '%')
        AND (${tag}::text IS NULL OR ${tag} = ANY(tags))
        AND (${pinned}::boolean IS NULL OR pinned = ${pinned})
        AND user_id = ${req.user.id}
      ORDER BY pinned DESC, updated_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `,
    sql`
      SELECT count(*)::int AS total
      FROM notes
      WHERE (${q}::text IS NULL OR title ILIKE '%' || ${q} || '%' OR body ILIKE '%' || ${q} || '%')
        AND (${tag}::text IS NULL OR ${tag} = ANY(tags))
        AND (${pinned}::boolean IS NULL OR pinned = ${pinned})
        AND user_id = ${req.user.id}
    `,
  ]);

  return res.json({
    notes,
    total: counts[0].total,
    page,
    limit,
  });
});

router.get("/:id", validate(noteIdSchema, "params"), async (req, res) => {
  const { id } = req.validated.params;
  const rows = await sql`
    SELECT id, user_id, title, body, tags, pinned, created_at, updated_at
    FROM notes
    WHERE id = ${id}
      AND user_id = ${req.user.id}
    LIMIT 1
  `;

  if (!rows[0]) {
    return notFound(res);
  }
  return res.json({ note: rows[0] });
});

router.post("/", validate(createNoteSchema), async (req, res) => {
  const { title, body, tags, pinned } = req.body;
  const rows = await sql`
    INSERT INTO notes (user_id, title, body, tags, pinned)
    VALUES (${req.user.id}, ${title}, ${body}, ${tags}, ${pinned})
    RETURNING id, user_id, title, body, tags, pinned, created_at, updated_at
  `;

  return res.status(201).json({ note: rows[0] });
});

router.patch(
  "/:id",
  validate(noteIdSchema, "params"),
  validate(updateNoteSchema),
  async (req, res) => {
    const { id } = req.validated.params;
    const { title = null, body = null, tags = null, pinned = null } = req.body;
    const rows = await sql`
      UPDATE notes
      SET title = COALESCE(${title}, title),
          body = COALESCE(${body}, body),
          tags = COALESCE(${tags}::text[], tags),
          pinned = COALESCE(${pinned}, pinned),
          updated_at = now()
      WHERE id = ${id}
        AND user_id = ${req.user.id}
      RETURNING id, user_id, title, body, tags, pinned, created_at, updated_at
    `;

    if (!rows[0]) {
      return notFound(res);
    }
    return res.json({ note: rows[0] });
  },
);

router.delete("/:id", validate(noteIdSchema, "params"), async (req, res) => {
  const { id } = req.validated.params;
  const rows = await sql`
    DELETE FROM notes
    WHERE id = ${id}
      AND user_id = ${req.user.id}
    RETURNING id
  `;

  if (!rows[0]) {
    return notFound(res);
  }
  return res.status(204).end();
});

export default router;
