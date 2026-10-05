require("dotenv").config();

function isHeroku() {
  return Boolean(process.env.DYNO);
}

function env(key, fallbackKey, defaultValue) {
  if (process.env[key] !== undefined && process.env[key] !== "") {
    return process.env[key];
  }
  if (fallbackKey && process.env[fallbackKey] !== undefined && process.env[fallbackKey] !== "") {
    return process.env[fallbackKey];
  }
  return defaultValue;
}

module.exports = {
  port: Number(env("CLAIMS_FRAUD_PORT", "PORT", 3002)),
  socketMode: String(env("CLAIMS_FRAUD_SOCKET_MODE", "SOCKET_MODE", "true")).toLowerCase() === "true",
  slackBotToken: env("CLAIMS_FRAUD_SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN"),
  slackAppToken: env("CLAIMS_FRAUD_SLACK_APP_TOKEN", "SLACK_APP_TOKEN"),
  slackSigningSecret: env("CLAIMS_FRAUD_SLACK_SIGNING_SECRET", "SLACK_SIGNING_SECRET"),
  slackUserToken: env("CLAIMS_FRAUD_SLACK_USER_TOKEN", "SLACK_USER_TOKEN"),
  publicBaseUrl: (() => {
    const explicit = env("CLAIMS_FRAUD_PUBLIC_BASE_URL", "PUBLIC_BASE_URL");
    if (explicit) return explicit;
    if (process.env.HEROKU_APP_NAME) {
      return `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
    }
    return undefined;
  })(),
  salesforceOrg: env("CLAIMS_FRAUD_SALESFORCE_ORG", "SALESFORCE_ORG", "mh-ss27-demo"),
  salesforceOrgId: env("CLAIMS_FRAUD_SALESFORCE_ORG_ID", "SALESFORCE_ORG_ID", "00DKB000001wZaD2AU"),
  salesforceCliPath: env("CLAIMS_FRAUD_SF_CLI_PATH", "SF_CLI_PATH"),
  salesforceEnabled:
    String(env("CLAIMS_FRAUD_SALESFORCE_ENABLED", "SALESFORCE_ENABLED", "true")).toLowerCase() !== "false",
  salesforceClaimObject: env("CLAIMS_FRAUD_SF_OBJECT", null, "Claim__c"),
  claimsAlertChannel: env("CLAIMS_ALERT_CHANNEL", null, "C0BAU8WGJA0"),
  debug: String(env("CLAIMS_FRAUD_DEBUG", "DEBUG", "false")).toLowerCase() === "true",
  ollamaEnabled:
    String(
      env("CLAIMS_FRAUD_OLLAMA_ENABLED", "OLLAMA_ENABLED", isHeroku() ? "false" : "true")
    ).toLowerCase() !== "false",
  ollamaBaseUrl: env("CLAIMS_FRAUD_OLLAMA_BASE_URL", "OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
  ollamaVisionModel: env("CLAIMS_FRAUD_OLLAMA_VISION_MODEL", "OLLAMA_VISION_MODEL", "llava"),
  ollamaTimeoutMs: Number(env("CLAIMS_FRAUD_OLLAMA_TIMEOUT_MS", "OLLAMA_TIMEOUT_MS", 120000)),
  visionProvider: String(
    env("CLAIMS_FRAUD_VISION_PROVIDER", "VISION_PROVIDER", isHeroku() ? "openai" : "ollama")
  ).toLowerCase(),
  openaiApiKey: env("CLAIMS_FRAUD_OPENAI_API_KEY", "OPENAI_API_KEY") || env("CLAIMS_FRAUD_VISION_API_KEY"),
  openaiVisionModel:
    env("CLAIMS_FRAUD_OPENAI_VISION_MODEL", "OPENAI_VISION_MODEL") ||
    env("CLAIMS_FRAUD_VISION_MODEL", null, "gpt-4o-mini"),
  openaiBaseUrl: env("CLAIMS_FRAUD_VISION_BASE_URL", null, "https://api.openai.com/v1"),
  openaiTimeoutMs: Number(
    env("CLAIMS_FRAUD_OPENAI_TIMEOUT_MS", "OPENAI_TIMEOUT_MS") ||
      env("CLAIMS_FRAUD_VISION_TIMEOUT_MS", null, 90000)
  ),
  jiraEnabled:
    String(env("CLAIMS_FRAUD_JIRA_ENABLED", "JIRA_ENABLED", "false")).toLowerCase() !== "false",
  jiraBaseUrl: env("CLAIMS_FRAUD_JIRA_BASE_URL", "JIRA_BASE_URL"),
  jiraEmail: env("CLAIMS_FRAUD_JIRA_EMAIL", "JIRA_EMAIL"),
  jiraApiToken: env("CLAIMS_FRAUD_JIRA_API_TOKEN", "JIRA_API_TOKEN"),
  jiraProjectKey: env("CLAIMS_FRAUD_JIRA_PROJECT_KEY", "JIRA_PROJECT_KEY", "EMAL"),
  jiraIssueType: env("CLAIMS_FRAUD_JIRA_ISSUE_TYPE", "JIRA_ISSUE_TYPE", "Task"),
  jiraDefaultLabels: env("CLAIMS_FRAUD_JIRA_DEFAULT_LABELS", null, "mobile-outage,sev1"),
  incidentSlackChannel: env("CLAIMS_FRAUD_INCIDENT_SLACK_CHANNEL", "INCIDENT_SLACK_CHANNEL", "C0BBZ0ERKNU"),
  confluenceEnabled:
    String(env("CLAIMS_FRAUD_CONFLUENCE_ENABLED", "CONFLUENCE_ENABLED", "false")).toLowerCase() !== "false",
  confluenceBaseUrl: env("CLAIMS_FRAUD_CONFLUENCE_BASE_URL", "CONFLUENCE_BASE_URL"),
  confluenceSpaceKey: env("CLAIMS_FRAUD_CONFLUENCE_SPACE_KEY", "CONFLUENCE_SPACE_KEY", "SD"),
  confluenceParentPageId: env("CLAIMS_FRAUD_CONFLUENCE_PARENT_PAGE_ID", "CONFLUENCE_PARENT_PAGE_ID"),
};
