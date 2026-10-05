/**
 * Serialize Ollama vision requests — llava handles one image poorly under concurrency.
 */
let chain = Promise.resolve();
let active = 0;

function withOllamaLock(label, fn) {
  const waitFor = active > 0;
  if (waitFor) {
    // eslint-disable-next-line no-console
    console.info(`[ollama-queue] waiting — ${label} (${active} active)`);
  }

  const run = chain.then(async () => {
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
    }
  });

  chain = run.catch(() => {});
  return run;
}

function ollamaQueueStats() {
  return { active };
}

module.exports = { withOllamaLock, ollamaQueueStats };
