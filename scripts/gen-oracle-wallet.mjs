// Generate a fresh oracle wallet for TEE simulation
// Run: node scripts/gen-oracle-wallet.mjs
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log("\n=== OPAQUE TEE ORACLE WALLET ===");
console.log("Address:     ", account.address);
console.log("Private Key: ", privateKey);
console.log("\n>> Add to .env.local:");
console.log(`TEE_ORACLE_PRIVATE_KEY="${privateKey}"`);
console.log(`TEE_ORACLE_ADDRESS="${account.address}"`);
console.log("\n>> Use this address as constructor arg when deploying OpaqueVault in Remix");
console.log("================================\n");
