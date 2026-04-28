import { NextRequest, NextResponse } from "next/server";
import { createWalletClient, createPublicClient, http, recoverMessageAddress, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { OpaqueVaultABI } from "@/lib/abi";

const VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT_ADDRESS as `0x${string}`;
const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}`;
// TEE Oracle private key — stored ONLY in server-side env (no NEXT_PUBLIC_)
const ORACLE_PRIVATE_KEY = process.env.TEE_ORACLE_PRIVATE_KEY as `0x${string}`;

export async function POST(req: NextRequest) {
  try {
    const { recipient, amount, signature, nonce } = await req.json();

    if (!recipient || !amount || !signature) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }
    if (!ORACLE_PRIVATE_KEY || ORACLE_PRIVATE_KEY === "0x") {
      return NextResponse.json({ error: "Oracle not configured" }, { status: 503 });
    }
    if (!VAULT_ADDRESS || !USDC_ADDRESS) {
      return NextResponse.json({ error: "Vault not configured" }, { status: 503 });
    }

    // 1. Verify signature
    // ⚠ MUST match EXACTLY the message signed on frontend in handleUnshield
    const expectedMessage =
      "OPAQUE UNSHIELD REQUEST\n\n" +
      `Wallet: ${recipient}\n` +
      `Amount: ${amount} USDC\n` +
      `Vault: ${VAULT_ADDRESS}\n` +
      `Nonce: ${nonce}\n\n` +
      "I authorize the iExec Nox enclave to release this amount.";

    const recovered = await recoverMessageAddress({
      message: expectedMessage,
      signature: signature as `0x${string}`,
    });

    if (recovered.toLowerCase() !== recipient.toLowerCase()) {
      return NextResponse.json({ error: "Invalid signature — address mismatch" }, { status: 401 });
    }

    // 2. Build oracle wallet client
    const account = privateKeyToAccount(ORACLE_PRIVATE_KEY);
    const walletClient = createWalletClient({
      account,
      chain: arbitrumSepolia,
      transport: http(),
    });
    const publicClient = createPublicClient({
      chain: arbitrumSepolia,
      transport: http(),
    });

    // 3. Derive proof ID from signature (bytes32)
    const proofId = `0x${signature.slice(2, 66)}` as `0x${string}`;

    // 4. Call OpaqueVault.unshield() as TEE oracle
    const amountWei = parseUnits(String(amount), 6);
    const txHash = await walletClient.writeContract({
      address: VAULT_ADDRESS,
      abi: OpaqueVaultABI,
      functionName: "unshield",
      args: [recipient as `0x${string}`, USDC_ADDRESS, amountWei, proofId],
    });

    // 5. Wait for on-chain confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return NextResponse.json({ error: "On-chain unshield failed" }, { status: 500 });
    }

    return NextResponse.json({ success: true, txHash, proofId, recipient, amount });
  } catch (e: any) {
    console.error("Unshield API error:", e);
    return NextResponse.json({ error: e.message ?? "Internal error" }, { status: 500 });
  }
}
