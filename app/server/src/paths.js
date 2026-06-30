const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const portableRoot = path.resolve(process.env.BLOG_BACKUP_ROOT || path.resolve(__dirname, '..', '..', '..'));
const appDir = process.env.BLOG_BACKUP_APP_DIR
  ? path.resolve(process.env.BLOG_BACKUP_APP_DIR)
  : path.join(portableRoot, 'app');

const paths = {
  portableRoot,
  appDir,
  serverDir: path.join(appDir, 'server'),
  publicDir: process.env.BLOG_BACKUP_PUBLIC_DIR
    ? path.resolve(process.env.BLOG_BACKUP_PUBLIC_DIR)
    : path.join(appDir, 'public'),
  profilesDir: process.env.BLOG_BACKUP_PROFILES_DIR
    ? path.resolve(process.env.BLOG_BACKUP_PROFILES_DIR)
    : path.join(appDir, 'profiles'),
  runtimeDir: path.join(appDir, 'runtime'),
  browsersDir: path.join(appDir, 'browsers'),
  archiveDir: path.join(portableRoot, 'archive'),
  archiveBlogsDir: path.join(portableRoot, 'archive', 'blogs'),
  archiveDataDir: path.join(portableRoot, 'archive', 'data'),
  exportsDir: path.join(portableRoot, 'exports'),
  logsDir: path.join(portableRoot, 'logs')
};

async function withTimeout(promise, message, timeoutMs = 10000) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

paths.ensureDir = async function ensureDir(dir) {
  if (fs.existsSync(dir)) {
    return;
  }

  await withTimeout(
    fsp.mkdir(dir, { recursive: true }),
    `Timed out creating ${dir}. Move BlogBackup to a local writable folder and try again.`
  );
};

paths.ensureDirs = async function ensureDirs() {
  for (const dir of [
    paths.profilesDir,
    paths.browsersDir,
    paths.archiveDir,
    paths.archiveBlogsDir,
    paths.archiveDataDir,
    paths.exportsDir,
    paths.logsDir
  ]) {
    await paths.ensureDir(dir);
  }
};

module.exports = paths;
