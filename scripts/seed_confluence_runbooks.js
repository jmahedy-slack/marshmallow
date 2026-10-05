#!/usr/bin/env node
/**
 * Publish Marshmallow incident runbooks to Confluence.
 *
 * Usage: node scripts/seed_confluence_runbooks.js
 * Env: CLAIMS_FRAUD_CONFLUENCE_* and CLAIMS_FRAUD_JIRA_EMAIL / CLAIMS_FRAUD_JIRA_API_TOKEN
 */
const config = require("../src/config");
const { createConfluencePage, isConfluenceConfigured } = require("../src/confluence/client");
const { RUNBOOKS, parentPageHtml, PARENT_TITLE } = require("./lib/marshmallowRunbooks");

async function createPageWithRetry({ title, html, parentId = null }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const pageTitle = attempt ? `${title} (${new Date().toISOString().slice(0, 10)} #${attempt + 1})` : title;
      return await createConfluencePage({ title: pageTitle, html, parentId });
    } catch (err) {
      if (!/title already exists|same title/i.test(String(err.message)) || attempt === 2) throw err;
    }
  }
}

async function main() {
  if (!isConfluenceConfigured()) {
    throw new Error(
      "Confluence is not configured — set CLAIMS_FRAUD_CONFLUENCE_SPACE_KEY and Jira/Atlassian credentials in .env"
    );
  }

  console.log(`Publishing Marshmallow runbooks to Confluence space ${config.confluenceSpaceKey}…\n`);

  const parent = await createPageWithRetry({
    title: PARENT_TITLE,
    html: parentPageHtml(),
  });
  console.log(`Parent: ${parent.title}`);
  console.log(`        ${parent.url}\n`);

  const created = [];
  for (const runbook of RUNBOOKS) {
    const page = await createPageWithRetry({
      title: runbook.title,
      html: runbook.html,
      parentId: parent.id,
    });
    created.push(page);
    console.log(`  ${page.title}`);
    console.log(`  ${page.url}\n`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  console.log("Done:");
  console.log(`  Index: ${parent.url}`);
  for (const page of created) {
    console.log(`  • ${page.title}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
