const { sleep } = require("./streamCards");

async function streamMarkdownText(streamer, markdown, options = {}) {
  const { delayMs = 35, prefix = "\n\n" } = options;
  if (!markdown) return;

  const pieces = markdown.split(/\n\n+/);
  for (let i = 0; i < pieces.length; i++) {
    const lead = i === 0 ? prefix : "\n\n";
    await streamer.append({ markdown_text: `${lead}${pieces[i]}` });
    if (delayMs > 0 && i < pieces.length - 1) await sleep(delayMs);
  }
}

module.exports = { streamMarkdownText };
