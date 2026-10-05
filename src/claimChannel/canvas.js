const CANVAS_MARKDOWN_MAX = 120000;

function truncateMarkdown(text, max = CANVAS_MARKDOWN_MAX) {
  const body = String(text || "");
  if (body.length <= max) return body;
  return `${body.slice(0, max)}\n\n_(report truncated)_`;
}

async function getChannelCanvasId(client, channelId) {
  const info = await client.conversations.info({ channel: channelId });
  return (
    info.channel?.properties?.canvas?.file_id ||
    info.channel?.properties?.canvas?.id ||
    null
  );
}

async function resolveCanvasOpenLink(client, channelId, canvasId) {
  if (canvasId) {
    try {
      const file = await client.files.info({ file: canvasId });
      if (file.file?.permalink) return file.file.permalink;
      if (file.file?.url_private) return file.file.url_private;
    } catch {
      // fall through to channel client link
    }
  }

  try {
    const auth = await client.auth.test();
    if (auth.team_id && channelId) {
      return `https://app.slack.com/client/${auth.team_id}/${channelId}`;
    }
  } catch {
    // ignore
  }

  return null;
}

async function createChannelCanvas(client, channelId, title, markdown) {
  const result = await client.conversations.canvases.create({
    channel_id: channelId,
    title: title.slice(0, 120),
    document_content: {
      type: "markdown",
      markdown: truncateMarkdown(markdown),
    },
  });
  return {
    created: true,
    canvasId: result.canvas_id || null,
  };
}

async function replaceChannelCanvas(client, channelId, canvasId, markdown) {
  await client.canvases.edit({
    canvas_id: canvasId,
    changes: [
      {
        operation: "replace",
        document_content: {
          type: "markdown",
          markdown: truncateMarkdown(markdown),
        },
      },
    ],
  });
  return { updated: true, canvasId };
}

async function appendChannelCanvasMarkdown(client, canvasId, markdown) {
  await client.canvases.edit({
    canvas_id: canvasId,
    changes: [
      {
        operation: "insert_at_end",
        document_content: {
          type: "markdown",
          markdown: truncateMarkdown(markdown, 50000),
        },
      },
    ],
  });
  return { appended: true, canvasId };
}

/**
 * Append an analysis report section to the channel canvas, creating one if needed.
 */
async function publishAnalysisToChannelCanvas(
  client,
  { channelId, claimId, title, markdown, logger }
) {
  const sectionTitle = title || `Analysis · ${claimId}`;
  const body = truncateMarkdown(markdown);
  const section = `\n\n---\n\n# ${sectionTitle}\n\n${body}`;

  let canvasId = await getChannelCanvasId(client, channelId);

  if (canvasId && client.canvases?.edit) {
    try {
      await appendChannelCanvasMarkdown(client, canvasId, section);
      logger?.info?.(`Canvas analysis appended: ${claimId} canvas=${canvasId}`);
      const openLink = await resolveCanvasOpenLink(client, channelId, canvasId);
      return { canvasId, openLink, appended: true };
    } catch (err) {
      logger?.warn?.(
        `Canvas append failed (${err.data?.error || err.message}) — will try create/update`
      );
    }
  }

  try {
    const created = await createChannelCanvas(
      client,
      channelId,
      `Claim reports · ${claimId}`,
      section.trimStart()
    );
    canvasId = created.canvasId || (await getChannelCanvasId(client, channelId));
    logger?.info?.(`Canvas analysis created: ${claimId} canvas=${canvasId || "unknown"}`);
    const openLink = await resolveCanvasOpenLink(client, channelId, canvasId);
    return { canvasId, openLink, created: true };
  } catch (err) {
    if (err.data?.error === "channel_canvas_already_exists") {
      canvasId = await getChannelCanvasId(client, channelId);
      if (canvasId && client.canvases?.edit) {
        await appendChannelCanvasMarkdown(client, canvasId, section);
        const openLink = await resolveCanvasOpenLink(client, channelId, canvasId);
        return { canvasId, openLink, appended: true };
      }
    }
    throw err;
  }
}

module.exports = {
  CANVAS_MARKDOWN_MAX,
  truncateMarkdown,
  getChannelCanvasId,
  resolveCanvasOpenLink,
  createChannelCanvas,
  replaceChannelCanvas,
  appendChannelCanvasMarkdown,
  publishAnalysisToChannelCanvas,
};
