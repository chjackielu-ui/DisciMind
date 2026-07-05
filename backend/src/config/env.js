const path = require('path');
const dotenv = require('dotenv');

let loaded = false;

function loadEnv() {
  if (loaded) return;

  // Always try backend/.env first so the app works even when launched from repo root.
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  dotenv.config({ quiet: true });

  loaded = true;
}

module.exports = { loadEnv };
