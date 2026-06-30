const { runBackup } = require('./crawler');

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createJobStore() {
  const jobs = new Map();

  function createJob({ profile, startUrl, blog, categories, incremental, includeComments, log }) {
    const job = {
      id: createId(),
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      profileId: profile.id,
      profileName: profile.name,
      startUrl,
      blog,
      categories,
      incremental,
      includeComments,
      messages: [],
      result: null,
      error: null,
      addMessage(message) {
        const entry = {
          time: new Date().toISOString(),
          message
        };
        this.messages.push(entry);
        if (this.messages.length > 500) {
          this.messages.shift();
        }
        log(`[job ${this.id}] ${message}`);
      },
      toJSON() {
        return {
          id: this.id,
          status: this.status,
          startedAt: this.startedAt,
          finishedAt: this.finishedAt,
          profileId: this.profileId,
          profileName: this.profileName,
          startUrl: this.startUrl,
          blog: this.blog,
          categories: this.categories,
          incremental: this.incremental,
          includeComments: this.includeComments,
          messages: this.messages,
          result: this.result,
          error: this.error
        };
      }
    };

    jobs.set(job.id, job);
    job.addMessage('Backup started.');

    runBackup({
      profile,
      startUrl,
      blog,
      categories,
      incremental,
      includeComments,
      progress: (message) => job.addMessage(message)
    })
      .then((result) => {
        job.status = 'complete';
        job.result = result;
        job.finishedAt = new Date().toISOString();
      })
      .catch((error) => {
        job.status = 'failed';
        job.error = error.stack || error.message;
        job.finishedAt = new Date().toISOString();
        job.addMessage(`Backup failed: ${error.message}`);
      });

    return job;
  }

  return {
    start: createJob,
    get(id) {
      return jobs.get(id);
    }
  };
}

module.exports = {
  createJobStore
};
