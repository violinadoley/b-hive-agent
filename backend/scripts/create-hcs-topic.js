#!/usr/bin/env node
const { TopicCreateTransaction } = require("@hashgraph/sdk");
const { buildHederaClient } = require("../src/agents/hedera-toolkit-agent");
const { getConfig } = require("../src/config");

async function main() {
  const cfg = getConfig();
  const client = buildHederaClient();
  try {
    const tx = await new TopicCreateTransaction()
      .setTopicMemo("b-hive decision attestations")
      .execute(client);
    const receipt = await tx.getReceipt(client);
    const topicId = receipt.topicId?.toString();
    if (!topicId) {
      throw new Error("Topic creation succeeded but topicId missing in receipt");
    }
    console.log("HCS topic created successfully.");
    console.log(`HCS_TOPIC_ID=${topicId}`);
    console.log(`Mirror URL: ${cfg.hederaMirrorRestBase}/topics/${topicId}/messages`);
    console.log("Add this to backend/.env and rerun: npm run orchestrate:verbose");
  } finally {
    client.close();
  }
}

main().catch((e) => {
  console.error(`Failed to create HCS topic: ${e.message || e}`);
  process.exit(1);
});
