const { Client, AccountId, PrivateKey, AccountBalanceQuery } = require("@hashgraph/sdk");
const { HederaLangchainToolkit, AgentMode } = require("hedera-agent-kit");
const { getConfig } = require("../config");
const { bonzoPlugin } = require("@bonzofinancelabs/hak-bonzo-plugin");

function buildHederaClient() {
  const cfg = getConfig();
  const accountId = process.env.ACCOUNT_ID;
  const privateKey = process.env.ECDSA_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!accountId || !privateKey) {
    throw new Error("ACCOUNT_ID and ECDSA_PRIVATE_KEY (or PRIVATE_KEY) are required");
  }
  if (cfg.hederaChainId === 296) {
    return Client.forTestnet().setOperator(
      AccountId.fromString(accountId),
      PrivateKey.fromStringECDSA(privateKey),
    );
  }
  if (cfg.hederaChainId === 295) {
    return Client.forMainnet().setOperator(
      AccountId.fromString(accountId),
      PrivateKey.fromStringECDSA(privateKey),
    );
  }
  throw new Error(`Unsupported HEDERA_CHAIN_ID for SDK client: ${cfg.hederaChainId}`);
}

async function runHederaToolkitAgentBootstrap() {
  const client = buildHederaClient();
  try {
    // Initialize toolkit with bonzoPlugin — provides Bonzo LangChain tools
    const toolkit = new HederaLangchainToolkit({
      client,
      configuration: {
        tools: [],
        plugins: [bonzoPlugin],
        context: { mode: AgentMode.AUTONOMOUS },
      },
    });
    const tools = toolkit.getTools();

    // Query account balance natively via Hedera SDK (authoritative — not EVM/Mirror)
    const accountId = process.env.ACCOUNT_ID;
    const balanceResult = await new AccountBalanceQuery()
      .setAccountId(AccountId.fromString(accountId))
      .execute(client);

    const hbarBalance = balanceResult.hbars.toBigNumber().toFixed(4);

    // Summarise token balances (non-zero only)
    const tokenBalances = [];
    if (balanceResult.tokens) {
      for (const [tokenId, amount] of balanceResult.tokens) {
        const amt = amount.toNumber ? amount.toNumber() : Number(amount);
        if (amt > 0) {
          tokenBalances.push({ token_id: tokenId.toString(), balance: amt });
        }
      }
    }

    return {
      ok: true,
      account_id: accountId,
      hbar_balance: hbarBalance,
      token_balances: tokenBalances,
      toolkit_tools: tools.map((t) => t.name || "unknown"),
      tool_count: tools.length,
    };
  } finally {
    client.close();
  }
}

module.exports = {
  buildHederaClient,
  runHederaToolkitAgentBootstrap,
};
