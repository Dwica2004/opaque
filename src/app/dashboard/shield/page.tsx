/* eslint-disable */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { Loader2, ShieldCheck, Coins, ArrowDownUp, Clock, ExternalLink, Droplets } from "lucide-react";
import { OpaqueVaultABI, ERC20ABI, MockUSDCABI, VAULT_ADDRESS } from "@/lib/abi";

// ── Addresses (Arbitrum Sepolia) ─────────────────────────────────────
// TODO: Replace with your deployed MockUSDC address after deploying MockUSDC.sol
const MOCK_USDC_ADDRESS = (process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS ?? "") as `0x${string}`;
const ARBISCAN_BASE = "https://sepolia.arbiscan.io";

type TxLog = {
  id: string;
  type: "FAUCET" | "APPROVE" | "SHIELD" | "UNSHIELD";
  amount: string;
  token: string;
  txHash: string;
  timestamp: number;
  status: "PENDING" | "CONFIRMED" | "FAILED";
};

export default function ShieldPage() {
  const { address, isConnected } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 0); return () => clearTimeout(t); }, []);

  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"idle" | "faucet" | "approving" | "shielding" | "done">("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [txHistory, setTxHistory] = useState<TxLog[]>([]);
  const [pendingTx, setPendingTx] = useState<`0x${string}` | null>(null);

  // ── Real balances from chain ─────────────────────────────────────
  const [publicBalance, setPublicBalance] = useState<string>("—");
  const [shieldedBalance, setShieldedBalance] = useState<string>("—");
  const [loadingBal, setLoadingBal] = useState(false);

  const addLog = (msg: string) => setLogs(prev => [...prev, `> ${msg}`]);

  const addTxLog = (entry: TxLog) => setTxHistory(prev => [entry, ...prev]);

  const fetchBalances = useCallback(async () => {
    if (!address || !client) return;
    setLoadingBal(true);
    try {
      // Public wallet balance (mUSDC)
      const pubRaw = await client.readContract({
        address: MOCK_USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "balanceOf",
        args: [address],
      }) as bigint;
      setPublicBalance(Number(formatUnits(pubRaw, 6)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

      // Shielded balance = what the vault holds (from AssetShielded events for this address)
      const vaultRaw = await client.readContract({
        address: MOCK_USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "balanceOf",
        args: [VAULT_ADDRESS],
      }) as bigint;
      // We show vault total as "shielded" since per-user is private by design
      setShieldedBalance(Number(formatUnits(vaultRaw, 6)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    } catch (e) {
      console.error("Balance fetch error:", e);
    }
    setLoadingBal(false);
  }, [address, client]);

  useEffect(() => {
    if (mounted && isConnected) fetchBalances();
  }, [mounted, isConnected, fetchBalances]);

  // ── Get live gas price from chain ──────────────────────────────
  const getGasPrice = useCallback(async () => {
    if (!client) return undefined;
    try {
      const gasPrice = await client.getGasPrice();
      // Add 20% buffer to avoid 'max fee per gas less than base fee'
      return (gasPrice * 120n) / 100n;
    } catch {
      return 100_000_000n; // fallback: 0.1 gwei
    }
  }, [client]);

  // ── Faucet: mint 10k mUSDC ───────────────────────────────────────
  const handleFaucet = async () => {
    if (!address) return;
    try {
      setStep("faucet");
      addLog("Requesting 10,000 mUSDC from faucet...");
      const gp = await getGasPrice();
      const hash = await writeContractAsync({
        address: MOCK_USDC_ADDRESS,
        abi: MockUSDCABI,
        functionName: "faucet",
        gasPrice: gp,
      });
      setPendingTx(hash);
      addLog(`Faucet TX submitted: ${hash.slice(0, 18)}...`);
      addTxLog({
        id: hash,
        type: "FAUCET",
        amount: "10,000",
        token: "mUSDC",
        txHash: hash,
        timestamp: Date.now(),
        status: "PENDING",
      });
      // Wait for receipt
      if (client) {
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") {
          addLog("[OK] 10,000 mUSDC received in wallet!");
          setTxHistory(prev => prev.map(t => t.txHash === hash ? { ...t, status: "CONFIRMED" } : t));
          await fetchBalances();
        }
      }
      setStep("idle");
    } catch (e: any) {
      addLog("[ERROR] Faucet failed. You may have hit the 100k limit.");
      setStep("idle");
    }
  };

  // ── Shield assets ────────────────────────────────────────────────
  const handleShield = async () => {
    if (!amount || isNaN(Number(amount)) || !address) return;
    try {
      setStep("approving");
      setLogs([]);
      const amountWei = parseUnits(amount, 6); // 6 decimals for USDC
      addLog(`Initiating shield of ${amount} mUSDC into TEE Vault...`);

      if (!VAULT_ADDRESS || VAULT_ADDRESS === "0x") {
        // Demo mode
        addLog("DEMO MODE: No vault address configured.");
        await new Promise(r => setTimeout(r, 1500));
        addLog("[OK] Demo shield simulated.");
        setStep("done");
        addTxLog({ id: Date.now().toString(), type: "SHIELD", amount, token: "mUSDC", txHash: "0xdemo..." + Date.now(), timestamp: Date.now(), status: "CONFIRMED" });
        return;
      }

      addLog("Step 1/2: Approve vault to spend mUSDC...");
      const gp = await getGasPrice();
      const approveHash = await writeContractAsync({
        address: MOCK_USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "approve",
        args: [VAULT_ADDRESS, amountWei],
        gasPrice: gp,
      });
      addTxLog({ id: approveHash, type: "APPROVE", amount, token: "mUSDC", txHash: approveHash, timestamp: Date.now(), status: "PENDING" });
      addLog(`Approve TX: ${approveHash.slice(0, 18)}...`);

      if (client) {
        const approveReceipt = await client.waitForTransactionReceipt({ hash: approveHash });
        if (approveReceipt.status !== "success") throw new Error("Approve failed");
        setTxHistory(prev => prev.map(t => t.txHash === approveHash ? { ...t, status: "CONFIRMED" } : t));
      }

      setStep("shielding");
      addLog("Step 2/2: Shielding assets into iExec Nox Vault...");
      const shieldHash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: OpaqueVaultABI,
        functionName: "shield",
        args: [MOCK_USDC_ADDRESS, amountWei, "0x" as `0x${string}`],
        gasPrice: gp,
      });
      addLog(`Shield TX: ${shieldHash.slice(0, 18)}...`);
      addTxLog({ id: shieldHash, type: "SHIELD", amount, token: "mUSDC", txHash: shieldHash, timestamp: Date.now(), status: "PENDING" });

      if (client) {
        const shieldReceipt = await client.waitForTransactionReceipt({ hash: shieldHash });
        if (shieldReceipt.status === "success") {
          addLog("[SUCCESS] Assets secured in TEE Vault!");
          addLog(`Proof: ${shieldHash}`);
          setTxHistory(prev => prev.map(t => t.txHash === shieldHash ? { ...t, status: "CONFIRMED" } : t));
          await fetchBalances();
        }
      }
      setStep("done");
    } catch (e: any) {
      addLog("[ERROR] Transaction rejected or failed.");
      setStep("idle");
    }
  };

  const walletReady = mounted && isConnected && address;
  const shortAddr = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";

  const typeColor: Record<TxLog["type"], string> = {
    FAUCET: "#4ade80",
    APPROVE: "#facc15",
    SHIELD: "#0000FF",
    UNSHIELD: "#a78bfa",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", animation: "fade-in 0.3s ease" }}>

      {/* ── Wallet Status ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", background: walletReady ? "rgba(0,0,255,0.04)" : "rgba(255,50,50,0.04)", border: `1px solid ${walletReady ? "rgba(0,0,255,0.15)" : "rgba(255,50,50,0.15)"}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: walletReady ? "#4ade80" : "#ff4444", boxShadow: walletReady ? "0 0 8px #4ade80" : "0 0 8px #ff4444" }} />
          <span className="mono" style={{ fontSize: "11px", color: walletReady ? "#4ade80" : "#ff6666", letterSpacing: "1px" }}>
            {walletReady ? `CONNECTED · ${shortAddr}` : "WALLET NOT CONNECTED"}
          </span>
        </div>
        {walletReady && (
          <button onClick={fetchBalances} disabled={loadingBal} className="mono" style={{ background: "none", border: "none", color: "#555", fontSize: "11px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
            {loadingBal ? <Loader2 size={12} className="animate-spin" /> : "↻"} Refresh
          </button>
        )}
      </div>

      {/* ── Split Balance View ────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

        {/* Public Balance */}
        <div style={{ background: "#07070f", border: "1px solid #1a1a2e", padding: "28px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, right: 0, padding: "20px", color: "rgba(74,222,128,0.04)", fontSize: "80px", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900, lineHeight: 1 }}>PUB</div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
            <Coins size={18} color="#4ade80" />
            <span className="mono" style={{ fontSize: "11px", color: "#4ade80", letterSpacing: "2px" }}>PUBLIC BALANCE</span>
          </div>
          <div className="mono" style={{ fontSize: "32px", color: "#fff", marginBottom: "6px" }}>
            {walletReady ? publicBalance : "—"}
          </div>
          <div className="mono" style={{ fontSize: "11px", color: "#555" }}>mUSDC · Arbitrum Sepolia · Fully Visible On-Chain</div>
          {walletReady && (
            <button
              onClick={handleFaucet}
              disabled={step !== "idle"}
              style={{ marginTop: "20px", display: "flex", alignItems: "center", gap: "8px", background: step === "faucet" ? "#111" : "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80", padding: "10px 16px", cursor: step !== "idle" ? "not-allowed" : "pointer", fontSize: "12px" }}
              className="mono"
            >
              {step === "faucet" ? <Loader2 size={14} className="animate-spin" /> : <Droplets size={14} />}
              {step === "faucet" ? "MINTING..." : "GET 10K mUSDC FREE"}
            </button>
          )}
        </div>

        {/* Shielded Balance */}
        <div style={{ background: "#07070f", border: "1px solid #0000FF", padding: "28px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, right: 0, padding: "20px", color: "rgba(0,0,255,0.06)", fontSize: "80px", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900, lineHeight: 1 }}>TEE</div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
            <ShieldCheck size={18} color="#0000FF" />
            <span className="mono" style={{ fontSize: "11px", color: "#0000FF", letterSpacing: "2px" }}>SHIELDED VAULT</span>
          </div>
          <div className="mono" style={{ fontSize: "32px", color: "#fff", marginBottom: "6px" }}>
            {walletReady ? shieldedBalance : "—"}
          </div>
          <div className="mono" style={{ fontSize: "11px", color: "#555" }}>mUSDC · iExec Nox Enclave · Balance Private</div>
          <div className="mono" style={{ marginTop: "20px", fontSize: "10px", color: "#333", padding: "10px", background: "#04040d", border: "1px dashed #111" }}>
            🔒 Vault total visible. Individual shares sealed by TEE attestation.
          </div>
        </div>

      </div>

      {/* ── Shield Action + Terminal ────────────────────────────────────── */}
      <div className="dash-grid-2" style={{ animation: "fade-in 0.3s ease" }}>

        {/* Action Panel */}
        <div style={{ background: "#111", border: "1px solid #222", padding: "40px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
            <ArrowDownUp size={20} color="#0000FF" />
            <h2 className="bc" style={{ fontSize: "26px", textTransform: "uppercase", letterSpacing: "1px" }}>Asset Shielding Engine</h2>
          </div>
          <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)", marginBottom: "28px", lineHeight: 1.6 }}>
            Move mUSDC from your public wallet into the iExec Nox Confidential Vault. Your balance becomes invisible to on-chain observers.
          </p>

          {!walletReady ? (
            <div style={{ padding: "40px", background: "rgba(0,0,255,0.05)", border: "1px dashed rgba(0,0,255,0.3)", textAlign: "center", color: "#0000FF", fontSize: "12px" }} className="mono">
              [ WALLET CONNECTION REQUIRED TO SHIELD ASSETS ]
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: "20px" }}>
                <label className="bc" style={{ display: "block", fontSize: "12px", color: "#999", marginBottom: "8px", textTransform: "uppercase" }}>Amount to Shield (mUSDC)</label>
                <input
                  type="number"
                  placeholder="e.g. 1000"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  disabled={step !== "idle" && step !== "done"}
                  style={{ width: "100%", background: "#0a0a14", border: "1px solid #333", borderBottom: "2px solid #0000FF", color: "#fff", padding: "16px", fontSize: "18px", outline: "none" }}
                  className="mono"
                />
                <div className="mono" style={{ fontSize: "10px", color: "#555", marginTop: "6px" }}>Available: {publicBalance} mUSDC</div>
              </div>

              <button
                onClick={handleShield}
                disabled={step === "approving" || step === "shielding" || !amount}
                style={{ width: "100%", padding: "18px", background: (step === "approving" || step === "shielding" || !amount) ? "#111" : "linear-gradient(135deg, #0000FF, #3355FF)", color: "#fff", border: "none", fontSize: "16px", cursor: (step === "approving" || step === "shielding" || !amount) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", letterSpacing: "1px" }}
                className="bc"
              >
                {(step === "approving" || step === "shielding") ? <><Loader2 size={18} className="animate-spin" /> {step === "approving" ? "APPROVING..." : "SHIELDING..."}</> : "SHIELD ASSETS →"}
              </button>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "12px" }}>
                <div className="mono" style={{ fontSize: "9px", color: "#333", textAlign: "center" }}>Protocol Fee: 0.05%</div>
                <div className="mono" style={{ fontSize: "9px", color: "#333", textAlign: "center" }}>Powered by iExec Nox SGX</div>
              </div>
            </div>
          )}
        </div>

        {/* Terminal */}
        <div style={{ background: "#05050a", border: "1px solid #1a1a1a", padding: "24px", display: "flex", flexDirection: "column", minHeight: "360px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid #1a1a1a", paddingBottom: "16px", marginBottom: "16px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: step === "done" ? "#4ade80" : step !== "idle" ? "#0000FF" : "#333", animation: step !== "idle" && step !== "done" ? "pulse 2s infinite" : "none" }}></div>
            <div className="mono" style={{ fontSize: "11px", color: "#666", letterSpacing: "1px" }}>NOX ENCLAVE TERMINAL</div>
          </div>
          <div className="mono" style={{ flex: 1, fontSize: "12px", color: "#0000FF", display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", textShadow: "0 0 5px rgba(0,0,255,0.4)" }}>
            {logs.length === 0 && <div style={{ color: "#333" }}>&gt; Awaiting input...</div>}
            {logs.map((log, i) => (
              <div key={i} style={{ animation: "fade-in 0.3s ease", color: log.includes("[OK]") || log.includes("[SUCCESS]") ? "#4ade80" : log.includes("[ERROR]") ? "#ff4444" : "#0000FF" }}>{log}</div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Transaction History ───────────────────────────────────────── */}
      <div style={{ background: "#07070f", border: "1px solid #1a1a2e", padding: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px" }}>
          <Clock size={16} color="#888" />
          <h3 className="bc" style={{ fontSize: "20px", textTransform: "uppercase", letterSpacing: "1px", color: "#aaa" }}>Transaction History</h3>
        </div>

        {txHistory.length === 0 ? (
          <div className="mono" style={{ textAlign: "center", padding: "32px", color: "#333", fontSize: "12px", letterSpacing: "1px" }}>
            NO TRANSACTIONS YET — USE FAUCET OR SHIELD TO SEE HISTORY
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {/* Header */}
            <div style={{ display: "grid", gridTemplateColumns: "100px 80px 120px 1fr 100px", gap: "12px", padding: "8px 16px" }}>
              {["TYPE", "AMOUNT", "TOKEN", "TX HASH", "STATUS"].map(h => (
                <div key={h} className="mono" style={{ fontSize: "9px", color: "#555", letterSpacing: "2px" }}>{h}</div>
              ))}
            </div>
            {txHistory.map((tx) => (
              <div key={tx.id} style={{ display: "grid", gridTemplateColumns: "100px 80px 120px 1fr 100px", gap: "12px", padding: "12px 16px", background: "#04040d", border: "1px solid #111", alignItems: "center" }}>
                <div className="mono" style={{ fontSize: "11px", color: typeColor[tx.type], letterSpacing: "1px" }}>{tx.type}</div>
                <div className="mono" style={{ fontSize: "12px", color: "#fff" }}>{tx.amount}</div>
                <div className="mono" style={{ fontSize: "12px", color: "#888" }}>{tx.token}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="mono" style={{ fontSize: "11px", color: "#555" }}>{tx.txHash.slice(0, 22)}...</span>
                  {!tx.txHash.includes("demo") && (
                    <a href={`${ARBISCAN_BASE}/tx/${tx.txHash}`} target="_blank" rel="noreferrer" style={{ color: "#0000FF" }}>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <div className="mono" style={{ fontSize: "10px", color: tx.status === "CONFIRMED" ? "#4ade80" : tx.status === "FAILED" ? "#ff4444" : "#facc15", letterSpacing: "1px" }}>
                  {tx.status}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
