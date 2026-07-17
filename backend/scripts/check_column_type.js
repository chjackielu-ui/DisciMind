require('dotenv').config();
const prisma = require('../src/config/prisma');

async function main() {
  const r = await prisma.$queryRaw`SHOW FULL COLUMNS FROM learning_session_node_runs WHERE Field = 'node_type'`;
  const col = r[0];
  console.log('Field:', col.Field);
  console.log('Type:', col.Type);
  if (col.Type.toUpperCase().includes('VARCHAR')) {
    console.log('VARCHAR - no ALTER TABLE needed for new enum values');
  } else if (col.Type.toUpperCase().includes('ENUM')) {
    console.log('NATIVE ENUM - ALTER TABLE needed!');
    console.log('Enum values:', col.Type);
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
