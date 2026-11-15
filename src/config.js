const errors = [];

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  errors.push("DATABASE_URL is required.");
} else {
  try {
    const url = new URL(databaseUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      errors.push("DATABASE_URL must use the postgres:// or postgresql:// protocol.");
    } else if (!url.hostname) {
      errors.push("DATABASE_URL must be a valid PostgreSQL connection URL.");
    }
  } catch {
    errors.push("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
}

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  errors.push("JWT_SECRET is required and must be at least 32 characters long.");
}

const portValue = process.env.PORT ?? "3000";
const port = Number(portValue);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  errors.push("PORT must be an integer between 1 and 65535.");
}

if (errors.length > 0) {
  throw new Error(`Invalid environment configuration:\n- ${errors.join("\n- ")}`);
}

export const DATABASE_URL = databaseUrl;
export const JWT_SECRET = jwtSecret;
export const PORT = port;
