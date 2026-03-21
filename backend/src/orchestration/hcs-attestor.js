const { TopicMessageSubmitTransaction } = require("@hashgraph/sdk");
const { getConfig } = require("../config");
const { buildHederaClient } = require("../agents/hedera-toolkit-agent");

async function submitRunAttestation({ runId, commitment, stepCount, policyId, packId }) {
  const cfg = getConfig();
  if (!cfg.hcsTopicId) {
    return { ok: false, skipped: true, reason: "HCS_TOPIC_ID not set" };
  }
  const client = buildHederaClient();
  try {
    const payload = {
      run_id: runId,
      commitment,
      step_count: stepCount,
      policy_id: policyId,
      pack_id: packId,
      chain_id: cfg.hederaChainId,
      ts: new Date().toISOString(),
    };
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(cfg.hcsTopicId)
      .setMessage(JSON.stringify(payload))
      .execute(client);
    const receipt = await tx.getReceipt(client);
    return {
      ok: true,
      topicId: cfg.hcsTopicId,
      sequenceNumber: receipt.topicSequenceNumber?.toString?.() || null,
      transactionId: tx.transactionId?.toString?.() || null,
      mirrorTopicMessagesUrl: `${cfg.hederaMirrorRestBase}/topics/${cfg.hcsTopicId}/messages`,
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    client.close();
  }
}

module.exports = { submitRunAttestation };
