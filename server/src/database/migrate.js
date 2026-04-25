const { getPool, sql } = require('../config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    const pool = getPool();
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Split by GO statements and execute each batch
    const batches = schema.split(/\bGO\b/i).filter(b => b.trim());
    
    // Execute the whole script as one batch since we don't use GO
    await pool.request().query(schema);
    console.log('Database migration completed successfully');
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  }
}

module.exports = { runMigration };
