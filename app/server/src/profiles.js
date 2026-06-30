const fs = require('fs/promises');
const path = require('path');
const paths = require('./paths');

const REQUIRED_SELECTORS = [
  'articleLinkSelector',
  'titleSelector',
  'contentSelector',
  'nextPageSelector'
];

function profileIdFromFile(fileName) {
  return path.basename(fileName, path.extname(fileName));
}

function normalizeProfile(profile, fileName) {
  const id = profile.id || profileIdFromFile(fileName);
  const normalized = {
    id,
    name: profile.name || id,
    description: profile.description || '',
    selectors: {
      articleLinkSelector: profile.articleLinkSelector || profile.selectors?.articleLinkSelector || '',
      titleSelector: profile.titleSelector || profile.selectors?.titleSelector || '',
      contentSelector: profile.contentSelector || profile.selectors?.contentSelector || '',
      nextPageSelector: profile.nextPageSelector || profile.selectors?.nextPageSelector || '',
      sourceCreatedAtSelector: profile.sourceCreatedAtSelector || profile.selectors?.sourceCreatedAtSelector || '',
      commentsSelector: profile.commentsSelector || profile.selectors?.commentsSelector || ''
    }
  };

  for (const selector of REQUIRED_SELECTORS) {
    if (!normalized.selectors[selector] && selector !== 'nextPageSelector') {
      throw new Error(`Profile "${id}" is missing ${selector}.`);
    }
  }

  return normalized;
}

async function readProfileFile(fileName) {
  const filePath = path.join(paths.profilesDir, fileName);
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return normalizeProfile(parsed, fileName);
}

async function listProfiles() {
  const files = (await fs.readdir(paths.profilesDir))
    .filter((fileName) => fileName.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));

  const profiles = [];
  for (const fileName of files) {
    profiles.push(await readProfileFile(fileName));
  }
  return profiles;
}

async function getProfile(profileId) {
  const requestedId = String(profileId || '').trim();
  const profiles = await listProfiles();
  const profile = profiles.find((candidate) => candidate.id === requestedId) || profiles[0];

  if (!profile) {
    throw new Error('No backup profiles are available.');
  }

  return profile;
}

function profileIdForUrl(startUrl) {
  try {
    const host = new URL(startUrl).hostname.toLowerCase();
    if (host === 'bbs.wenxuecity.com') {
      return 'bbs';
    }

    if (host === 'blog.wenxuecity.com' || host.endsWith('.wenxuecity.com')) {
      return 'wenxuecity';
    }
  } catch {
    return null;
  }

  return null;
}

async function getProfileForUrl(startUrl) {
  const profiles = await listProfiles();
  const detectedId = profileIdForUrl(startUrl);
  const detectedProfile = profiles.find((candidate) => candidate.id === detectedId);
  if (detectedProfile) {
    return detectedProfile;
  }

  return profiles.find((candidate) => candidate.id === 'wenxuecity')
    || profiles.find((candidate) => candidate.id === 'generic')
    || profiles[0];
}

module.exports = {
  listProfiles,
  getProfile,
  getProfileForUrl,
  profileIdForUrl
};
