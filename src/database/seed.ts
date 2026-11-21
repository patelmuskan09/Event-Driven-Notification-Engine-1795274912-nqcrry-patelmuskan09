import { DatabaseClient } from './db-client';

async function main() {
  const db = DatabaseClient.getInstance();
  const connected = await db.connect();
  if (!connected) {
    console.error('Cannot seed database: PostgreSQL connection failed.');
    process.exit(1);
  }
  await db.runMigrations();
  const count = await db.seedUsersIfEmpty();
  await db.disconnect();
  console.log(`Seed verification completed (${count} users ready).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
