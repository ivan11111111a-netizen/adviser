const fs = require('node:fs/promises');

async function loadConfig(path) {
  const text = fs.readFile(path, 'utf8');
  return JSON.parse(text);
}
