/**
 * Checkpointer Service
 * 使用 @langchain/langgraph-checkpoint-sqlite 官方实现
 */

const path = require('path');
const fs = require('fs');
const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const DEFAULT_DB_PATH = './storage/langgraph/checkpoints.sqlite';

let _instance = null;

function resolveDbPath() {
  return path.resolve(PROJECT_ROOT, process.env.LANGGRAPH_CHECKPOINT_DB || DEFAULT_DB_PATH);
}

function ensureDbDir(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function initCheckpointer() {
  if (_instance) return _instance;

  const dbPath = resolveDbPath();
  ensureDbDir(dbPath);

  _instance = SqliteSaver.fromConnString(dbPath);
  console.log('[Checkpointer] SqliteSaver initialized:', dbPath);
  return _instance;
}

function getCheckpointer() {
  if (!_instance) throw new Error('Checkpointer 未初始化');
  return _instance;
}

module.exports = { initCheckpointer, getCheckpointer };
