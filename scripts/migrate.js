require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runner } = require('node-pg-migrate');

runner({
  databaseUrl: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: {
      rejectUnauthorized: true,
      ca: fs.readFileSync(path.join(os.homedir(), '.postgresql', 'root.crt')).toString(),
    },
  },
  dir: path.join(__dirname, '..', 'migrations'),
  direction: 'up',
  migrationsTable: 'pgmigrations',
})
  .then(() => {
    console.log('Migrations applied successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
