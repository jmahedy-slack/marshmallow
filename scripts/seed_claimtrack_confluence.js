#!/usr/bin/env node
/**
 * Seed Confluence pages for ClaimTrack spec challenge (stands in for Google Drive product docs).
 */
require("dotenv").config();
const config = require("../src/config");
const { createConfluencePage, isConfluenceConfigured } = require("../src/confluence/client");

const BUSINESS_HTML = `
<h1>Business feedback synthesis — claims visibility (H2 2026)</h1>
<p><strong>Source channels:</strong> #business-feedback, contact centre QA, broker feedback, app reviews.</p>
<h2>Volume</h2>
<p>5 catalogued feedback items (BF-2026-041 through BF-2026-063) plus Slack digest thread Sep 2026.</p>
<h2>Common themes</h2>
<ul>
<li>Customers cannot tell <em>where</em> the claim is beyond generic &quot;Under Review&quot;</li>
<li>No clear <em>next step</em> or whether Marshmallow is waiting on the customer</li>
<li>Repeat contacts often status-only (~47% in QA sample)</li>
<li>Requests for ETA / resolution timing</li>
<li>Outstanding actions (photos, police ref) not visible in-app</li>
</ul>
<h2>Duplicate problem?</h2>
<p>Yes — multiple requests describe one underlying gap: <strong>progress transparency</strong>, not separate features.</p>
<h2>Related Jira</h2>
<p>Search <code>project = MAR AND labels = claimtrack</code></p>
`;

const STANDARDS_HTML = `
<h1>Marshmallow Mobile API Standards (extract)</h1>
<h2>Versioning</h2>
<p>Customer BFF routes under <code>/v1/</code>; breaking changes require new major version.</p>
<h2>Security</h2>
<p>OAuth2 bearer tokens; claim resources scoped to authenticated policyholder.</p>
<h2>Observability</h2>
<p>Datadog: latency, 4xx/5xx, saturation. Product analytics events for funnel steps.</p>
<h2>Privacy</h2>
<p>Minimise fields in customer API; no internal fraud notes or SIU content.</p>
<p><em>Full standards live in engineering handbook — this page is demo seed for ClaimTrack spec challenge.</em></p>
`;

const DRAFT_SPEC_HTML = `
<h1>[DRAFT — superseded by AI spec challenge] Claims progress PRD fragment</h1>
<p>Early outline only. Do not implement from this page alone.</p>
<ul>
<li>MVP: status, stage, next step, action required, timeline messages</li>
<li>Non-goal v1: live chat with adjuster, fraud investigation detail</li>
</ul>
<p>See GitHub: <code>docs/product/claimtrack-discovery-index.md</code></p>
`;

async function main() {
  if (!isConfluenceConfigured()) {
    throw new Error("Confluence not configured in .env");
  }

  const pages = [
    { title: "Business feedback — claims visibility (H2 2026)", html: BUSINESS_HTML },
    { title: "Marshmallow Mobile API Standards (extract)", html: STANDARDS_HTML },
    { title: "ClaimTrack — draft PRD fragment (do not implement)", html: DRAFT_SPEC_HTML },
  ];

  for (const page of pages) {
    const created = await createConfluencePage({ title: page.title, html: page.html });
    console.log(created.title, "→", created.url);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
