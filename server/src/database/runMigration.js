require('dotenv').config();
const { connectDB } = require('../config/database');
const { runMigration } = require('./migrate');

async function main() {
  try {
    await connectDB();
    console.log('Connected to database');
    await runMigration();
    console.log('All migrations completed');
    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
}

main();
