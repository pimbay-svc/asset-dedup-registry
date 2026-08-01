import process from 'node:process';
import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable must be set to run drizzle-kit');
}

// eslint-disable-next-line no-restricted-syntax -- drizzle-kit CLI requires a default export by convention
export default defineConfig({
  schema: './src/infrastructure/drizzle/schema.ts',
  out: './migration',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
});
