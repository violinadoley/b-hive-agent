#!/usr/bin/env node
/**
 * Associates Bonzo testnet tokens with the operator account.
 * Tokens must be associated before the Discord faucet can deliver them.
 *
 * Usage: npm run testnet:setup
 *
 * After association, request tokens from Bonzo Discord:
 *   !test_bonzo USDC <ACCOUNT_ID>
 *   !test_bonzo SAUCE <ACCOUNT_ID>
 *   etc.
 */
const path = require("path");
const dotenv = require("dotenv");
const {
  Client,
  AccountId,
  PrivateKey,
  TokenAssociateTransaction,
  TokenId,
  AccountBalanceQuery,
} = require("@hashgraph/sdk");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const TESTNET_TOKENS = [
  { symbol: "USDC", tokenId: "0.0.5449" },
  { symbol: "SAUCE", tokenId: "0.0.1183558" },
  { symbol: "HBARX", tokenId: "0.0.2231533" },
  { symbol: "KARATE", tokenId: "0.0.3772909" },
  { symbol: "XSAUCE", tokenId: "0.0.1418651" },
];

function buildClient() {
  const accountId = process.env.ACCOUNT_ID;
  const privateKey = process.env.ECDSA_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!accountId || !privateKey) {
    throw new Error("ACCOUNT_ID and ECDSA_PRIVATE_KEY must be set in .env");
  }
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(accountId),
    PrivateKey.fromStringECDSA(privateKey),
  );
  return { client, accountId };
}

async function getAssociatedTokens(client, accountId) {
  const balance = await new AccountBalanceQuery()
    .setAccountId(AccountId.fromString(accountId))
    .execute(client);
  const tokenMap = balance.tokens || new Map();
  const associated = new Set();
  for (const [tokenId] of tokenMap) {
    associated.add(tokenId.toString());
  }
  return associated;
}

async function associateToken(client, accountId, tokenId, symbol) {
  console.log(`  Associating ${symbol} (${tokenId})...`);
  const tx = new TokenAssociateTransaction()
    .setAccountId(AccountId.fromString(accountId))
    .setTokenIds([TokenId.fromString(tokenId)]);
  const receipt = await (await tx.execute(client)).getReceipt(client);
  console.log(`  ${symbol}: ${receipt.status.toString()}`);
  return receipt.status.toString();
}

async function main() {
  const { client, accountId } = buildClient();
  console.log(`Account: ${accountId}`);
  console.log(`Network: Hedera Testnet\n`);

  try {
    console.log("Checking already associated tokens...");
    const alreadyAssociated = await getAssociatedTokens(client, accountId);

    const results = [];
    for (const { symbol, tokenId } of TESTNET_TOKENS) {
      if (alreadyAssociated.has(tokenId)) {
        console.log(`  ${symbol} (${tokenId}): already associated`);
        results.push({ symbol, tokenId, status: "already_associated" });
        continue;
      }
      try {
        const status = await associateToken(client, accountId, tokenId, symbol);
        results.push({ symbol, tokenId, status });
      } catch (e) {
        const msg = e.message || String(e);
        if (msg.includes("TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT")) {
          console.log(`  ${symbol} (${tokenId}): already associated (on-chain)`);
          results.push({ symbol, tokenId, status: "already_associated" });
        } else {
          console.error(`  ${symbol} FAILED: ${msg}`);
          results.push({ symbol, tokenId, status: "failed", error: msg });
        }
      }
    }

    console.log("\n--- Results ---");
    for (const r of results) {
      console.log(`  ${r.symbol} (${r.tokenId}): ${r.status}${r.error ? ` — ${r.error}` : ""}`);
    }

    console.log("\nChecking token balances...");
    const balance = await new AccountBalanceQuery()
      .setAccountId(AccountId.fromString(accountId))
      .execute(client);

    const hbar = balance.hbars;
    console.log(`  HBAR: ${hbar.toString()}`);
    const tokenMap = balance.tokens || new Map();
    for (const { symbol, tokenId } of TESTNET_TOKENS) {
      const tid = TokenId.fromString(tokenId);
      const amt = tokenMap.get(tid);
      console.log(`  ${symbol}: ${amt != null ? amt.toString() : "0"}`);
    }

    console.log("\nNext steps:");
    console.log("  1. Go to Bonzo Discord: https://discord.gg/bonzo");
    console.log("  2. Request tokens from the faucet bot:");
    for (const { symbol } of TESTNET_TOKENS) {
      console.log(`     !test_bonzo ${symbol} ${accountId}`);
    }
    console.log("  3. Wait for confirmation, then run this script again to check balances.");
  } finally {
    client.close();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
