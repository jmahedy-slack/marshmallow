const { Assistant } = require("@slack/bolt");
const { listClaimChannels } = require("./engine/store");
const { readChannelContext } = require("./engine/channelContext");
const { analyzeInStages } = require("./engine/analyze");
const {
  buildStopBlocks,
  buildStreamingMarkdown,
  titleForResult,
  withoutTableBlocks,
  stripCreateChannelBlocks,
  createClaimChannelEligible,
  createClaimChannelActionBlock,
  buildCreateChannelCtaBlocks,
} = require("./blocks/formatResponse");
const {
  PIPELINE_STEPS,
  sleep,
  pipelineIntroChunks,
  stepStartChunks,
  stepCompleteChunks,
} = require("./blocks/streamCards");
const { streamMarkdownText } = require("./blocks/streamText");
const { getChannelSession, setChannelSession } = require("./engine/channelSession");
const { DEMO_CLAIM } = require("../data/planted_claim_ids");
const {
  createClaimChannel,
} = require("./claimChannel/create");

const CREATE_CHANNEL_TEXT_RE =
  /create\s+(?:a\s+)?(?:salesforce\s+)?channel(?:\s+for)?\s*(CLM-[A-Z0-9-]+)/i;

const LOADING_MESSAGES = [
  "Reading claims channel context…",
  "Loading Claim from Salesforce…",
  "Matching fraud patterns…",
  "Scoring suspect indicators…",
  "Preparing next steps…",
];

const STEP_MAP = Object.fromEntries(PIPELINE_STEPS.map((step) => [step.id, step]));
const STREAM_PAUSE_MS = 450;
const STREAM_BUFFER_SIZE = 64;
const STREAM_TEXT_DELAY_MS = 35;

function channelSelectBlocks() {
  const channels = listClaimChannels();
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Select the *claims channel* to include Slack messages and files in profiling:",
      },
      accessory: {
        type: "static_select",
        action_id: "claims_channel_select",
        placeholder: { type: "plain_text", text: "Choose claims channel" },
        options: channels.map((c) => ({
          text: { type: "plain_text", text: c.label },
          value: c.id,
        })),
      },
    },
  ];
}

function basePrompts(channelContext) {
  const prompts = [
    {
      title: "Review CLM-2026-004781",
      message: `Review claim ${DEMO_CLAIM.primary} for suspected fraud`,
    },
    {
      title: "Review SF fraud flag CLM-0010",
      message: "Review claim CLM-0010 for suspected fraud",
    },
    {
      title: "List profiler rules",
      message: "List all claims fraud profiling rules",
    },
  ];

  if (channelContext) {
    prompts.unshift({
      title: "Profile with channel context",
      message: `Review claim ${DEMO_CLAIM.primary} using the selected claims channel context`,
    });
  }

  return prompts.slice(0, 4);
}

function parseCreateChannelIntent(text) {
  const match = String(text || "").match(CREATE_CHANNEL_TEXT_RE);
  return match?.[1]?.toUpperCase() || null;
}

async function postCreateChannelResult({ say, claimChannel, claimId, err, logger }) {
  if (err) {
    logger?.error(err);
    await say(
      `:warning: Could not create claim channel for *${claimId}*: ${err.message || err.data?.error || "unknown error"}`
    );
    return;
  }

  await say({
    text: `Salesforce channel ready for ${claimChannel.claim?.id}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `:white_check_mark: *Salesforce channel ${claimChannel.existing ? "opened" : "created"}:* <#${claimChannel.channelId}>\n` +
            `Linked to Claim__c \`${claimChannel.claim?.id}\`${claimChannel.salesforceLinked ? " (Salesforce Channels)" : ""}` +
            (claimChannel.warning ? `\n:warning: ${claimChannel.warning}` : ""),
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open claim channel" },
            url: `slack://channel?id=${claimChannel.channelId}`,
          },
          ...(claimChannel.claim?.salesforceUrl
            ? [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Open Salesforce claim" },
                  url: claimChannel.claim.salesforceUrl,
                },
              ]
            : []),
        ],
      },
    ],
  });
}

async function handleCreateChannelFromAssistant({
  message,
  say,
  setStatus,
  client,
  logger,
  claimId,
}) {
  await setStatus("Creating Salesforce channel…");
  try {
    const claimChannel = await createClaimChannel({
      client,
      userId: message.user,
      sourceChannelId: message.channel,
      sourceThreadTs: message.thread_ts,
      seed: { claimId },
      teamId: message.team,
      logger,
    });
    await postCreateChannelResult({ say, claimChannel, claimId, logger });
  } catch (err) {
    await postCreateChannelResult({ say, claimId, err, logger });
  } finally {
    await setStatus("");
  }
}

async function streamClaimsResponse({
  sayStream,
  setStatus,
  setTitle,
  setSuggestedPrompts,
  say,
  logger,
  messageText,
  channelContext,
  client,
  channelId,
  threadTs,
}) {
  await setStatus({
    status: "Profiling claim…",
    loading_messages: LOADING_MESSAGES,
  });

  let result = null;
  let streamer = null;

  try {
    streamer = sayStream({
      task_display_mode: "timeline",
      buffer_size: STREAM_BUFFER_SIZE,
    });

    await streamer.append({ chunks: pipelineIntroChunks() });
    await sleep(STREAM_PAUSE_MS);

    for await (const update of analyzeInStages(messageText, {
      channelContext,
      client,
      persistToSalesforce: true,
    })) {
      const step = STEP_MAP[update.stage];
      if (!step) continue;

      if (update.status === "in_progress") {
        await streamer.append({ chunks: stepStartChunks(step, update.detail) });
        await sleep(STREAM_PAUSE_MS);
        continue;
      }

      if (update.status === "complete" || update.status === "error") {
        await streamer.append({ chunks: stepCompleteChunks(step, update.output) });
        if (update.result) result = update.result;
        if (update.status === "complete" && update.stage !== "report") {
          await sleep(STREAM_PAUSE_MS);
        }
      }
    }

    if (!result) {
      result = {
        type: "help",
        message: "Could not complete claims profiling. Please try again.",
        query: {},
      };
    }

    await setTitle(titleForResult(result));
    const md = buildStreamingMarkdown(result);
    const suffix = String(Date.now());
    const streamBlocks = stripCreateChannelBlocks(
      buildStopBlocks(result, suffix, { omitChannelAction: true })
    );
    const channelCtaBlocks = buildCreateChannelCtaBlocks(result);

    await streamMarkdownText(streamer, md, { delayMs: STREAM_TEXT_DELAY_MS });

    try {
      await streamer.stop({
        blocks: streamBlocks,
        text: titleForResult(result),
      });
    } catch (stopErr) {
      logger?.warn("Stream stop failed; retrying without tables", stopErr);
      await streamer.stop({
        blocks: withoutTableBlocks(streamBlocks),
        text: titleForResult(result),
      });
    }

    if (createClaimChannelEligible(result) && setSuggestedPrompts) {
      await setSuggestedPrompts({
        title: "Suggested next steps:",
        prompts: [
          {
            title: "Create Salesforce channel",
            message: `Create channel for ${result.query.claimId}`,
          },
          ...basePrompts(channelContext).slice(0, 3),
        ],
      });
    }

    if (channelCtaBlocks.length && client && channelId && threadTs) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `No Salesforce channel for ${result.query.claimId}. Tap Create Salesforce channel in suggested prompts, or type Create channel for ${result.query.claimId}.`,
        blocks: channelCtaBlocks,
      });
    }

    if (result.query?.claimId && channelId && threadTs) {
      setChannelSession(channelId, threadTs, {
        ...(getChannelSession(channelId, threadTs) || {}),
        lastClaimId: result.query.claimId,
      });
    }
  } catch (err) {
    logger?.error(err);
    if (say) {
      await say({
        text: ":warning: Claims profiling failed.",
        blocks: withoutTableBlocks(
          buildStopBlocks({ type: "help", message: err.message, query: {} }, Date.now())
        ),
      });
    }
  } finally {
    await setStatus("");
  }

  return result;
}

function registerAssistant(app) {
  const assistant = new Assistant({
    threadStarted: async ({ event, say, setSuggestedPrompts, saveThreadContext, logger }) => {
      try {
        await say(
          "I'm the *Marshmallow Claims Fraud Agent*. I profile claims, auto-match the *Salesforce channel* linked to each Claim__c (messages + files), and reconcile with Salesforce.\n\n" +
            "Ask me to review a claim reference. If no Salesforce channel exists for that Claim__c, I'll offer to create one with a canvas brief.",
        );
        await say({ blocks: channelSelectBlocks() });
        await saveThreadContext();
        await setSuggestedPrompts({
          title: "Suggested reviews:",
          prompts: basePrompts(),
        });
      } catch (err) {
        logger.error(err);
        await say(":warning: Could not initialise the claims assistant thread.");
      }
    },

    threadContextChanged: async ({ event, setSuggestedPrompts, saveThreadContext, logger }) => {
      try {
        const channelId = event.assistant_thread?.context?.channel_id;
        const threadTs = event.assistant_thread?.thread_ts;
        const session = channelId && threadTs ? getChannelSession(channelId, threadTs) : null;
        await saveThreadContext();
        await setSuggestedPrompts({
          title: "Suggested reviews:",
          prompts: basePrompts(session?.channelContext),
        });
      } catch (err) {
        logger.error(err);
      }
    },

    userMessage: async ({ message, sayStream, setStatus, setTitle, setSuggestedPrompts, say, client, logger }) => {
      if (!message.text || !message.thread_ts) return;
      const session = getChannelSession(message.channel, message.thread_ts);

      const explicitClaimId = parseCreateChannelIntent(message.text);
      const wantsCreateChannel =
        explicitClaimId ||
        /^create\s+(?:a\s+)?(?:salesforce\s+)?channel\b/i.test(message.text);

      if (wantsCreateChannel) {
        const claimId = explicitClaimId || session?.lastClaimId || null;
        if (!claimId) {
          await say(
            "Which claim should I create a channel for? e.g. `Create channel for CLM-0016`"
          );
          return;
        }
        await handleCreateChannelFromAssistant({
          message,
          say,
          setStatus,
          client,
          logger,
          claimId,
        });
        return;
      }

      try {
        await streamClaimsResponse({
          sayStream,
          setStatus,
          setTitle,
          setSuggestedPrompts,
          say,
          logger,
          client,
          messageText: message.text,
          channelContext: session?.channelContext,
          channelId: message.channel,
          threadTs: message.thread_ts,
        });
      } catch (err) {
        logger.error(err);
        await setStatus("");
      }
    },
  });

  app.assistant(assistant);
}

module.exports = {
  registerAssistant,
  streamClaimsResponse,
  channelSelectBlocks,
  basePrompts,
};
