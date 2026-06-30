const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');

function configureRuntime(rootDir) {
  const workspaceRoot = rootDir || path.join(os.tmpdir(), 'blog-backup-netlify');
  process.env.BLOG_BACKUP_ROOT = workspaceRoot;
  process.env.BLOG_BACKUP_PROFILES_DIR = path.join(projectRoot, 'app', 'profiles');
  process.env.BLOG_BACKUP_PUBLIC_DIR = path.join(projectRoot, 'app', 'public');
  process.env.BLOG_BACKUP_NO_OPEN = '1';
  return {
    projectRoot,
    workspaceRoot
  };
}

module.exports = {
  configureRuntime,
  projectRoot
};
