import { DatabaseClient } from './db-client';

async function main() {
  const db = DatabaseClient.getInstance();
  const connected = await db.connect();
  if (!connected) {
    console.error('Cannot run migrations: PostgreSQL connection failed.');
    process.exit(1);
  }
  await db.runMigrations();
  await db.disconnect();
  console.log('Migrations applied cleanly.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
