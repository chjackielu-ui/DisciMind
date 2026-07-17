require('dotenv').config();
const prisma = require('../src/config/prisma');

async function main() {
  console.log('Running migration: add new enum values to learning_session_node_runs.node_type');
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE learning_session_node_runs
      MODIFY COLUMN node_type enum(
        'concept_explanation',
        'analogy_explanation',
        'worked_example_analysis',
        'socratic_questioning',
        'basic_practice',
        'adaptive_practice',
        'wrong_question_repair',
        'mastery_gate',
        'learning_summary',
        'multimodal_interaction',
        'diagnostic_pre_test',
        'deep_evaluation',
        'variant_question',
        'misconception_repair',
        'summary'
      ) NOT NULL
    `);
    console.log('Migration applied successfully!');

    // Verify
    const r = await prisma.$queryRaw`SHOW FULL COLUMNS FROM learning_session_node_runs WHERE Field = 'node_type'`;
    console.log('Updated column type:', r[0].Type);
    console.log('Enum count:', (r[0].Type.match(/'/g) || []).length / 2, 'values');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
  await prisma.$disconnect();
}

main();
