const fs = require('node:fs');
const path = require('node:path');
const archiver = require('archiver');
async function packageHelper() {
  const root = path.resolve(__dirname, '../..');
  const destination = path.join(root, 'app/public/downloads/wenxuecity-helper.zip');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const output = fs.createWriteStream(destination);
  const archive = archiver('zip', { zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve); output.on('error', reject);
    archive.on('error', reject); archive.on('warning', reject);
  });
  archive.pipe(output);
  for (const name of ['manifest.json', 'background.js', 'bridge.js', 'reader.js']) {
    archive.file(path.join(root, 'moderator-extension', name), { name, date: new Date('2026-01-01T00:00:00Z') });
  }
  archive.file(path.join(root, 'app/public/install-helper.html'), { name: 'INSTALL.html', date: new Date('2026-01-01T00:00:00Z') });
  await archive.finalize(); await done;
  console.log('Helper ZIP generated.');
}
module.exports = packageHelper;
if (require.main === module) packageHelper().catch((error) => { console.error(error); process.exitCode = 1; });
