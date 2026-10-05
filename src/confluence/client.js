const config = require("../config");

function validateSpaceKey(spaceKey) {
  if (!spaceKey?.trim()) return "CONFLUENCE_SPACE_KEY is not set.";
  if (/^ATATT/i.test(spaceKey) || spaceKey.length > 32) {
    return "CONFLUENCE_SPACE_KEY looks like an API token — use the space key (e.g. SD).";
  }
  return null;
}

function isConfluenceConfigured() {
  return Boolean(
    config.confluenceEnabled &&
      config.confluenceSpaceKey &&
      !validateSpaceKey(config.confluenceSpaceKey) &&
      config.jiraEmail &&
      config.jiraApiToken
  );
}

function getConfluenceConfig() {
  if (!isConfluenceConfigured()) {
    throw new Error(
      "Confluence is not configured. Set CLAIMS_FRAUD_CONFLUENCE_SPACE_KEY, CLAIMS_FRAUD_JIRA_EMAIL, and CLAIMS_FRAUD_JIRA_API_TOKEN in .env"
    );
  }
  const wikiBase = String(config.confluenceBaseUrl || `${config.jiraBaseUrl}/wiki`).replace(/\/$/, "");
  return {
    wikiBase,
    email: config.jiraEmail,
    apiToken: config.jiraApiToken,
    spaceKey: config.confluenceSpaceKey.trim(),
    parentPageId: config.confluenceParentPageId || null,
  };
}

function authHeader(email, apiToken) {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function createConfluencePage({ title, html, parentId = null }) {
  const { wikiBase, email, apiToken, spaceKey } = getConfluenceConfig();

  const body = {
    type: "page",
    title,
    space: { key: spaceKey },
    body: {
      storage: { value: html, representation: "storage" },
    },
  };

  const ancestorId = parentId || getConfluenceConfig().parentPageId;
  if (ancestorId) body.ancestors = [{ id: String(ancestorId) }];

  const response = await fetch(`${wikiBase}/rest/api/content`, {
    method: "POST",
    headers: {
      Authorization: authHeader(email, apiToken),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    const message =
      data.message ||
      data.reason ||
      (data.data ? JSON.stringify(data.data) : null) ||
      `Confluence API error ${response.status}`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }

  const base = (data._links?.base || wikiBase).replace(/\/$/, "");
  const webui = data._links?.webui || `/spaces/${spaceKey}/pages/${data.id}`;
  const url = `${base}${webui.startsWith("/") ? webui : `/${webui}`}`;

  return { id: data.id, title: data.title, url };
}

module.exports = {
  isConfluenceConfigured,
  getConfluenceConfig,
  escapeHtml,
  createConfluencePage,
};
