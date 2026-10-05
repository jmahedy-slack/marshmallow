const sessions = new Map();

function sessionKey(channelId, threadTs) {
  return `${channelId}:${threadTs}`;
}

function setChannelSession(channelId, threadTs, data) {
  sessions.set(sessionKey(channelId, threadTs), {
    ...data,
    updatedAt: Date.now(),
  });
}

function getChannelSession(channelId, threadTs) {
  return sessions.get(sessionKey(channelId, threadTs)) || null;
}

function clearChannelSession(channelId, threadTs) {
  sessions.delete(sessionKey(channelId, threadTs));
}

module.exports = {
  setChannelSession,
  getChannelSession,
  clearChannelSession,
};
