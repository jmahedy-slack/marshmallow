const { resolveClaimIdForChannel } = require("../claimChannel/resolve");
const { publishAnalysisToChannelCanvas } = require("../claimChannel/canvas");
const {
  evaluateMessageSignals,
  loadClaimForWatch,
  buildWatchSummaryBlocks,
  buildWatchCanvasMarkdown,
} = require("../engine/messageWatch");
const { isImageFile, downloadSlackFile } = require("../slack/downloadFile");
const { analyzeVehicleDamage } = require("../vision/damageAnalysis");
const {
  formatDamageAnalysisSummaryBlocks,
  formatDamageAnalysisCanvasMarkdown,
  buildDamageAnalysisAckCard,
} = require("../vision/formatDamageReply");
const {
  compareInsuredVsDetected,
  formatVehicleConsistencySummaryBlocks,
  formatVehicleConsistencyCanvasMarkdown,
} = require("../vision/vehicleConsistency");
const {
  buildChannelSummaryPayload,
  buildCanvasReportMarkdown,
} = require("../blocks/claimChannelAnalysis");
const { buildClaimHoldStatusCard, isFraudHoldAction } = require("../blocks/claimHoldStatusCard");

const channelClaimCache = new Map();
const MIN_MESSAGE_LENGTH = 8;
const MAX_IMAGES_PER_MESSAGE = 2;
const WATCH_PROCESSING_REACTION = "eyes";
const WATCH_DONE_REACTION = "white_check_mark";
const REACTION_FALLBACKS = [WATCH_PROCESSING_REACTION, "mag"];

function filesFromMessage(message) {
  const files = [...(message.files || [])];
  if (message.file) files.push(message.file);
  if (message.file_id) files.push({ id: message.file_id });
  if (Array.isArray(message.file_ids)) {
    for (const id of message.file_ids) files.push({ id });
  }
  const seen = new Set();
  return files.filter((file) => {
    const key = file?.id || file?.name || file?.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function enrichMessageFiles(client, message, logger) {
  const files = filesFromMessage(message);
  const enriched = [];

  for (const file of files) {
    if ((file?.url_private || file?.url_private_download) && (file.mimetype || file.name || file.title)) {
      enriched.push(file);
      continue;
    }
    if (!file?.id) continue;
    try {
      const info = await client.files.info({ file: file.id });
      if (info.file) enriched.push(info.file);
    } catch (err) {
      logger?.warn?.(`files.info failed for ${file.id}: ${err.message}`);
      enriched.push(file);
    }
  }

  message.files = enriched;
  return enriched;
}

function isHumanChannelMessage(message) {
  if (!message?.user || message.bot_id || message.app_id) return false;
  if (message.subtype && message.subtype !== "file_share") return false;
  const text = String(message.text || "").trim();
  if (!text && !filesFromMessage(message).length) return false;
  if (text.includes("Profiler watch") || text.includes("Vehicle damage analysis")) return false;
  if (text.includes("Analysing vehicle damage image")) return false;
  return true;
}

function messageTextForWatch(message) {
  const parts = [];
  if (message.text) parts.push(message.text.replace(/<@[^>]+>/g, "@user"));
  const files = filesFromMessage(message);
  if (files.length) {
    parts.push(
      files.map((f) => `[file: ${f.name || f.title || "attachment"}]`).join(" ")
    );
  }
  return parts.join("\n").trim();
}

function imageFilesFromMessage(message) {
  const isFileShare = message.subtype === "file_share";
  return filesFromMessage(message)
    .filter((file) => isImageFile(file, { fileShare: isFileShare }))
    .slice(0, MAX_IMAGES_PER_MESSAGE);
}

async function addWatchReaction(client, message, logger) {
  for (const name of REACTION_FALLBACKS) {
    try {
      await client.reactions.add({
        channel: message.channel,
        timestamp: message.ts,
        name,
      });
      return name;
    } catch (err) {
      if (err.data?.error === "already_reacted") return name;
      logger?.debug?.(`Reaction :${name}: unavailable (${err.data?.error || err.message})`);
    }
  }
  logger?.warn("Could not add watch reaction (tried eyes, mag)");
  return null;
}

async function completeWatchReaction(client, message, processingEmoji, logger) {
  const channel = message.channel;
  const timestamp = message.ts;

  if (processingEmoji) {
    try {
      await client.reactions.remove({
        channel,
        timestamp,
        name: processingEmoji,
      });
    } catch (err) {
      if (err.data?.error !== "no_reaction") {
        logger?.debug?.(
          `Could not remove :${processingEmoji}: (${err.data?.error || err.message})`
        );
      }
    }
  }

  try {
    await client.reactions.add({
      channel,
      timestamp,
      name: WATCH_DONE_REACTION,
    });
  } catch (err) {
    if (err.data?.error !== "already_reacted") {
      logger?.debug?.(
        `Could not add :${WATCH_DONE_REACTION}: (${err.data?.error || err.message})`
      );
    }
  }
}

function parentThreadTs(message) {
  // Top-level posts (incl. file_share): thread under the user's message ts.
  // Replies inside an existing thread: anchor to that thread's root.
  return message.thread_ts || message.ts;
}

async function postThreadReply(client, { channel, threadTs, text, blocks, broadcast = false, logger }) {
  const payload = { channel, thread_ts: threadTs, text };
  if (blocks?.length) payload.blocks = blocks;
  if (broadcast) payload.reply_broadcast = true;
  const result = await client.chat.postMessage(payload);
  return result;
}

async function updateThreadReply(client, { channel, ts, text, blocks, logger }) {
  try {
    const payload = { channel, ts, text };
    if (blocks?.length) payload.blocks = blocks;
    await client.chat.update(payload);
    return true;
  } catch (err) {
    logger?.warn(`Could not update analysis message: ${err.data?.error || err.message}`);
    return false;
  }
}

async function analyzeDamageImages({ client, message, claim, claimId, logger }) {
  const images = imageFilesFromMessage(message);
  if (!images.length) return { summaryParts: [], canvasSections: [], results: [] };

  const caption = String(message.text || "").trim();
  const summaryParts = [];
  const canvasSections = [];
  const results = [];

  for (const file of images) {
    const fileName = file.name || file.title || "image";
    try {
      logger.info(`Damage analysis start: ${claimId} · ${fileName}`);
      const downloaded = await downloadSlackFile(client, file);
      const result = await analyzeVehicleDamage(downloaded.buffer, { claim, caption });
      results.push(result);
      summaryParts.push(
        formatDamageAnalysisSummaryBlocks({
          claimId,
          fileName: downloaded.name,
          result,
          claim,
        })
      );
      canvasSections.push({
        title: `Damage analysis · ${downloaded.name}`,
        body: formatDamageAnalysisCanvasMarkdown({
          claimId,
          fileName: downloaded.name,
          result,
        }),
      });
      if (result.ok) {
        logger.info(`Damage analysis done: ${claimId} · ${downloaded.name}`);
      } else {
        logger.warn(`Damage analysis failed: ${claimId} · ${result.message}`);
      }
    } catch (err) {
      logger.warn(`Damage image download/analysis failed for ${fileName}`, err);
      summaryParts.push({
        text: `Could not analyse damage image: ${fileName}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: Could not analyse damage image \`${fileName}\`: ${err.message}`,
            },
          },
        ],
      });
      canvasSections.push({
        title: `Damage analysis · ${fileName}`,
        body: `:warning: Could not analyse \`${fileName}\`: ${err.message}`,
      });
    }
  }

  return { summaryParts, canvasSections, results };
}

const SLACK_TEXT_MAX = 39000;

function truncateSlackText(text) {
  const body = String(text || "");
  if (body.length <= SLACK_TEXT_MAX) return body;
  return `${body.slice(0, SLACK_TEXT_MAX)}\n\n_(message truncated for Slack limit)_`;
}

async function deliverFinalAnalysis({ client, channel, threadTs, ackTs, text, blocks, claimId, logger }) {
  const body = truncateSlackText(text);

  if (ackTs) {
    const updated = await updateThreadReply(client, {
      channel,
      ts: ackTs,
      text: body,
      blocks,
      logger,
    });
    if (updated) {
      logger.info(`Slack analysis delivered (updated ack): claim ${claimId} channel=${channel} ts=${ackTs}`);
      return { method: "update", ts: ackTs };
    }
    logger.warn(`chat.update failed for claim ${claimId} ack ts=${ackTs} — posting new message`);
  }

  const postPayload = {
    channel,
    thread_ts: threadTs,
    text: body,
    reply_broadcast: false,
  };
  if (blocks?.length) postPayload.blocks = blocks;

  try {
    const result = await client.chat.postMessage(postPayload);
    logger.info(
      `Slack analysis delivered (broadcast post): claim ${claimId} channel=${channel} ts=${result.ts}`
    );
    return { method: "broadcast", ts: result.ts };
  } catch (err) {
    const code = err.data?.error || err.message;
    logger.warn(`Broadcast post failed (${code}) — trying thread-only for ${claimId}`);
    const threadPayload = { channel, thread_ts: threadTs, text: body };
    if (blocks?.length) threadPayload.blocks = blocks;
    const result = await client.chat.postMessage(threadPayload);
    logger.info(
      `Slack analysis delivered (thread-only): claim ${claimId} channel=${channel} ts=${result.ts}`
    );
    return { method: "thread", ts: result.ts };
  }
}

function buildAnalysisAckPayload(claimId) {
  return buildDamageAnalysisAckCard({ claimId });
}

async function postAnalysisAck(client, { channel, threadTs, claimId, logger }) {
  try {
    const ackPayload = buildAnalysisAckPayload(claimId);
    const ack = await postThreadReply(client, {
      channel,
      threadTs,
      text: ackPayload.text,
      blocks: ackPayload.blocks,
      logger,
    });
    if (ack?.ts) {
      logger.info(`Slack analysis ack posted: claim ${claimId} ts=${ack.ts}`);
      return ack.ts;
    }
    logger.warn(`Slack analysis ack returned no ts for claim ${claimId}`);
    return null;
  } catch (err) {
    logger.error(`Failed to post analysis ack for ${claimId}: ${err.data?.error || err.message}`);
    return null;
  }
}

async function publishWatchAnalysisToCanvas({
  client,
  channel,
  claimId,
  canvasSections,
  trigger,
  logger,
}) {
  const markdown = buildCanvasReportMarkdown({
    claimId,
    sections: canvasSections,
    analyzedAt: new Date().toISOString(),
    trigger,
  });

  if (!markdown || markdown.startsWith("_No analysis content")) {
    return { openLink: null };
  }

  const dateLabel = new Date().toISOString().slice(0, 10);
  return publishAnalysisToChannelCanvas(client, {
    channelId: channel,
    claimId,
    title: `Analysis · ${claimId} · ${dateLabel}`,
    markdown,
    logger,
  });
}

async function runImageAnalysisJob({
  client,
  message,
  claim,
  claimId,
  threadTs,
  ackTs,
  text,
  processingReaction,
  logger,
}) {
  const started = Date.now();
  const JOB_TIMEOUT_MS = 180000;

  const run = async () => {
    const { summaryParts, canvasSections, results: damageResults } = await analyzeDamageImages({
      client,
      message,
      claim,
      claimId,
      logger,
    });

    const lastOk = [...damageResults].reverse().find((r) => r?.ok && r.analysis);
    let vehicleHits = [];
    if (lastOk && claim) {
      try {
        const check = compareInsuredVsDetected(claim, lastOk.analysis);
        vehicleHits = check.hits || [];
        summaryParts.push(formatVehicleConsistencySummaryBlocks(check));
        canvasSections.push({
          title: "Policy vehicle check",
          body: formatVehicleConsistencyCanvasMarkdown(check),
        });
        const vehicleWatch = buildWatchSummaryBlocks({ hits: vehicleHits, claimId });
        if (vehicleWatch && !vehicleHits.some(isFraudHoldAction)) {
          summaryParts.push(vehicleWatch);
        }
        if (vehicleHits.length) {
          canvasSections.push({
            title: "Vehicle rule hits",
            body: buildWatchCanvasMarkdown({ hits: vehicleHits, claimId, messageText: text }),
          });
        }
        if (!check.consistent) {
          logger.warn(
            `Vehicle mismatch: ${claimId} · ${check.flags.map((f) => f.field).join(", ")}`
          );
        }
      } catch (consistencyErr) {
        logger.warn(`Vehicle consistency check failed for ${claimId}`, consistencyErr);
        summaryParts.push({
          text: "Policy vehicle check failed",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `:warning: Policy vehicle check could not run: ${consistencyErr.message || String(consistencyErr)}`,
              },
            },
          ],
        });
      }
    }

    const messageHits = evaluateMessageSignals(text, claim);
    if (messageHits.length) {
      const messageWatch = buildWatchSummaryBlocks({ hits: messageHits, claimId });
      if (messageWatch && !messageHits.some(isFraudHoldAction)) {
        summaryParts.push(messageWatch);
      }
      canvasSections.push({
        title: "Profiler watch",
        body: buildWatchCanvasMarkdown({ hits: messageHits, claimId, messageText: text }),
      });
    }

    const allHits = [...vehicleHits, ...messageHits];

    const baseParts =
      summaryParts.length > 0
        ? summaryParts
        : [
            {
              text: `Image received for ${claimId}`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `:information_source: Image received for \`${claimId}\`. No damage signals detected.`,
                  },
                },
              ],
            },
          ];

    const summary = buildChannelSummaryPayload({
      claimId,
      parts: baseParts,
      minimal: true,
      includeCanvasLink: false,
    });

    const holdCard = buildClaimHoldStatusCard({
      hits: allHits,
      claimId,
      claim,
      messageTs: message.ts,
    });
    if (holdCard?.blocks?.length) {
      summary.blocks = [...holdCard.blocks, ...(summary.blocks || [])];
      summary.text = `${holdCard.text} · ${summary.text}`;
    }

    await deliverFinalAnalysis({
      client,
      channel: message.channel,
      threadTs,
      ackTs,
      text: summary.text,
      blocks: summary.blocks,
      claimId,
      logger,
    });

    if (canvasSections.length) {
      publishWatchAnalysisToCanvas({
        client,
        channel: message.channel,
        claimId,
        canvasSections,
        trigger: "Image upload in claim channel",
        logger,
      }).catch((canvasErr) => {
        logger.warn(
          `Could not publish analysis canvas for ${claimId}: ${canvasErr.data?.error || canvasErr.message}`
        );
      });
    }

    const elapsed = Date.now() - started;
    if (messageHits.length) {
      logger.info(
        `Claim channel watch: ${claimId} · ${messageHits[0]?.ruleId} on ${message.ts} (${elapsed}ms)`
      );
    } else {
      logger.info(`Claim channel watch: ${claimId} · image analysis on ${message.ts} (${elapsed}ms)`);
    }
  };

  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Image analysis timed out after ${JOB_TIMEOUT_MS / 1000}s`)), JOB_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    logger.error("Image analysis job failed", err);
    const failPayload = {
      text: `Damage image review failed for ${claimId}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:warning: Could not analyse damage image for \`${claimId}\`.\n${err.message || String(err)}`,
          },
        },
      ],
    };
    await deliverFinalAnalysis({
      client,
      channel: message.channel,
      threadTs,
      ackTs,
      text: failPayload.text,
      blocks: failPayload.blocks,
      claimId,
      logger,
    }).catch((postErr) => logger.error("Could not post failure reply", postErr));
  } finally {
    await completeWatchReaction(client, message, processingReaction, logger);
  }
}

function registerClaimChannelWatch(app) {
  app.message(async ({ message, client, logger }) => {
    try {
      if (!isHumanChannelMessage(message)) return;

      const claimId = await resolveClaimIdForChannel(
        client,
        message.channel,
        channelClaimCache,
        logger
      );
      if (!claimId) {
        logger?.warn?.(
          `Claim channel watch skip: could not resolve claim for channel ${message.channel} (name may not match clm-* and no SF/local channel link)`
        );
        return;
      }

      await enrichMessageFiles(client, message, logger);

      const text = messageTextForWatch(message);
      const hasImages = imageFilesFromMessage(message).length > 0;
      if (text.length < MIN_MESSAGE_LENGTH && !hasImages) {
        logger?.debug?.(`Claim channel watch skip: ${claimId} message too short and no images`);
        return;
      }

      const threadTs = parentThreadTs(message);
      let ackTs = null;

      const claim = await loadClaimForWatch(claimId);

      if (hasImages) {
        logger.info(`Claim channel watch: image upload for ${claimId} ts=${message.ts}`);
        const processingReaction = await addWatchReaction(client, message, logger);
        ackTs = await postAnalysisAck(client, {
          channel: message.channel,
          threadTs,
          claimId,
          logger,
        });
        runImageAnalysisJob({
          client,
          message,
          claim,
          claimId,
          threadTs,
          ackTs,
          text,
          processingReaction,
          logger,
        }).catch((jobErr) => logger.error(`Image analysis job crashed for ${claimId}`, jobErr));
        return;
      }

      const hits = evaluateMessageSignals(text, claim);
      if (!hits.length) {
        logger?.debug?.(`Claim channel watch skip: ${claimId} no profiler rules matched`);
        return;
      }

      const processingReaction = await addWatchReaction(client, message, logger);

      const holdCard = buildClaimHoldStatusCard({
        hits,
        claimId,
        claim,
        messageTs: message.ts,
      });

      const summary = holdCard
        ? holdCard
        : buildChannelSummaryPayload({
            claimId,
            parts: [buildWatchSummaryBlocks({ hits, claimId })],
            minimal: true,
            includeCanvasLink: false,
          });

      try {
        await postThreadReply(client, {
          channel: message.channel,
          threadTs,
          text: summary.text,
          blocks: summary.blocks,
          broadcast: false,
          logger,
        });
        await completeWatchReaction(client, message, processingReaction, logger);
        logger.info(`Claim channel watch: ${claimId} · ${hits[0]?.ruleId} on ${message.ts}`);
      } catch (replyErr) {
        logger.error("Claim channel watch reply failed", replyErr);
      }
    } catch (err) {
      logger.error("Claim channel watch failed", err);
    }
  });
}

module.exports = { registerClaimChannelWatch };
