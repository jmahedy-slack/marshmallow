const config = require("../config");

function isJiraConfigured() {
  return Boolean(config.jiraEnabled && config.jiraBaseUrl && config.jiraEmail && config.jiraApiToken);
}

function getJiraConfig() {
  if (!isJiraConfigured()) {
    throw new Error(
      "Jira is not configured. Set CLAIMS_FRAUD_JIRA_BASE_URL, CLAIMS_FRAUD_JIRA_EMAIL, and CLAIMS_FRAUD_JIRA_API_TOKEN in .env"
    );
  }
  return {
    baseUrl: String(config.jiraBaseUrl).replace(/\/$/, ""),
    email: config.jiraEmail,
    apiToken: config.jiraApiToken,
    projectKey: config.jiraProjectKey,
    issueType: config.jiraIssueType,
  };
}

function textToAdf(text) {
  const paragraphs = String(text || "")
    .split(/\n\n+/)
    .filter(Boolean);
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((paragraph) => ({
      type: "paragraph",
      content: [{ type: "text", text: paragraph.replace(/\n/g, " ") }],
    })),
  };
}

function authHeader(email, apiToken) {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
}

async function createJiraIssue({ summary, description, labels = [] }) {
  const { baseUrl, email, apiToken, projectKey, issueType } = getJiraConfig();

  const response = await fetch(`${baseUrl}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: authHeader(email, apiToken),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        project: { key: projectKey },
        summary,
        description: textToAdf(description),
        issuetype: { name: issueType },
        ...(labels.length ? { labels } : {}),
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const message =
      data.errorMessages?.join("; ") ||
      JSON.stringify(data.errors || data.message || data);
    throw new Error(message);
  }

  return {
    key: data.key,
    id: data.id,
    url: `${baseUrl}/browse/${data.key}`,
  };
}

module.exports = {
  isJiraConfigured,
  getJiraConfig,
  textToAdf,
  createJiraIssue,
};
