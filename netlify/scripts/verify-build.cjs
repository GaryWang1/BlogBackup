const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const required = [
  'app/public/index.html',
  'app/public/app.js',
  'app/public/styles.css',
  'netlify/functions/api.mjs',
  'netlify/functions/archive-background.mjs',
  'netlify/functions/download.mjs'
];

for (const relativePath of required) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required deployment file: ${relativePath}`);
  }
}

console.log('Netlify build verification passed.');
