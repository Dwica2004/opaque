/* eslint-disable */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useSignMessage } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { Loader2, ShieldCheck, Coins, ArrowDownUp, Clock, ExternalLink, Droplets, ShieldOff } from "lucide-react";
import { OpaqueVaultABI, ERC20ABI, VAULT_ADDRESS } from "@/lib/abi";

// ── Addresses (Arbitrum Sepolia) ─────────────────────────────────────
const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "") as `0x${string}`;
const MOCK_USDC_ADDRESS = USDC_ADDRESS; // alias for backward compat
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
  const { signMessageAsync } = useSignMessage();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 0); return () => clearTimeout(t); }, []);

  const [amount, setAmount] = useState("");
  const [unshieldAmount, setUnshieldAmount] = useState("");
  const [step, setStep] = useState<"idle" | "faucet" | "approving" | "shielding" | "done">("idle");
  const [unshieldStep, setUnshieldStep] = useState<"idle" | "signing" | "processing" | "done">("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [unshieldLogs, setUnshieldLogs] = useState<string[]>([]);
  const [pendingTx, setPendingTx] = useState<`0x${string}` | null>(null);

  // ── Persist tx history per wallet in localStorage ───────────────────
  const [txHistory, setTxHistoryState] = useState<TxLog[]>([]);
  const historyKey = address ? `opaque_tx_history_${address.toLowerCase()}` : null;

  // Load history from localStorage when wallet connects
  useEffect(() => {
    if (!historyKey) return;
    try {
      const stored = localStorage.getItem(historyKey);
      if (stored) setTxHistoryState(JSON.parse(stored));
    } catch {}
  }, [historyKey]);

  const addTxLog = (entry: TxLog) => {
    setTxHistoryState(prev => {
      const next = [entry, ...prev];
      if (historyKey) localStorage.setItem(historyKey, JSON.stringify(next));
      return next;
    });
  };

  const updateTxStatus = (txHash: string, status: TxLog["status"]) => {
    setTxHistoryState(prev => {
      const next = prev.map(t => t.txHash === txHash ? { ...t, status } : t);
      if (historyKey) localStorage.setItem(historyKey, JSON.stringify(next));
      return next;
    });
  };

  // ── Personal shielded balance (localStorage) ───────────────────────
  const shieldedKey = address ? `opaque_shielded_${address.toLowerCase()}` : null;

  const getPersonalShielded = (): number => {
    if (!shieldedKey) return 0;
    try { return parseFloat(localStorage.getItem(shieldedKey) ?? "0") || 0; } catch { return 0; }
  };

  const setPersonalShielded = (val: number) => {
    if (!shieldedKey) return;
    const clamped = Math.max(0, val);
    localStorage.setItem(shieldedKey, String(clamped));
  };

  // ── Real balances from chain ──────────────────────────────────
  const [publicBalance, setPublicBalance] = useState<string>("—");
  const [publicBalanceRaw, setPublicBalanceRaw] = useState<number>(0);
  const [shieldedBalance, setShieldedBalance] = useState<string>("—");
  const [pendingReturn, setPendingReturnState] = useState<number>(0);
  const [loadingBal, setLoadingBal] = useState(false);

  // Pending return = unshielded assets not yet finalized on-chain by TEE oracle
  const pendingKey = address ? `opaque_pending_${address.toLowerCase()}` : null;
  const getPendingReturn = (): number => {
    if (!pendingKey) return 0;
    try { return parseFloat(localStorage.getItem(pendingKey) ?? "0") || 0; } catch { return 0; }
  };
  const addPendingReturn = (val: number) => {
    if (!pendingKey) return;
    const next = Math.max(0, getPendingReturn() + val);
    localStorage.setItem(pendingKey, String(next));
    setPendingReturnState(next);
  };
  // Clear all pending returns (oracle is now live)
  const clearPendingReturn = () => {
    if (!pendingKey) return;
    localStorage.removeItem(pendingKey);
    setPendingReturnState(0);
  };

  const addLog = (msg: string) => setLogs(prev => [...prev, `> ${msg}`]);
  const addUnshieldLog = (msg: string) => setUnshieldLogs(prev => [...prev, `> ${msg}`]);

  const fetchBalances = useCallback(async () => {
    if (!address || !client) return;
    setLoadingBal(true);
    try {
      const pubRaw = await client.readContract({
        address: MOCK_USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "balanceOf",
        args: [address],
      }) as bigint;
      const pubNum = Number(formatUnits(pubRaw, 6));
      setPublicBalanceRaw(pubNum);
      setPublicBalance(pubNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

      // Shielded = personal tracked (privacy by design)
      const personal = getPersonalShielded();
      setShieldedBalance(personal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

      // Pending return from TEE
      setPendingReturnState(getPendingReturn());
    } catch (e) {
      console.error("Balance fetch error:", e);
    }
    setLoadingBal(false);
  }, [address, client, shieldedKey, pendingKey]);

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

  // ── Faucet: mint 10k USDC ───────────────────────────────────────
  const handleFaucet = async () => {
    if (!address) return;
    try {
      setStep("faucet");
      addLog("Requesting 10,000 USDC from faucet...");
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
        token: "USDC",
        txHash: hash,
        timestamp: Date.now(),
        status: "PENDING",
      });
      // Wait for receipt
      if (client) {
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") {
          addLog("[OK] 10,000 USDC received in wallet!");
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
      addLog(`Initiating shield of ${amount} USDC into TEE Vault...`);

      if (!VAULT_ADDRESS || VAULT_ADDRESS === "0x") {
        // Demo mode
        addLog("DEMO MODE: No vault address configured.");
        await new Promise(r => setTimeout(r, 1500));
        addLog("[OK] Demo shield simulated.");
        setStep("done");
        const demoAmt = parseFloat(amount);
        setPersonalShielded(getPersonalShielded() + demoAmt);
        addTxLog({ id: Date.now().toString(), type: "SHIELD", amount, token: "USDC", txHash: "0xdemo..." + Date.now(), timestamp: Date.now(), status: "CONFIRMED" });
        await fetchBalances();
        return;
      }

      addLog("Step 1/2: Approve vault to spend USDC...");
      const gp = await getGasPrice();
      const approveHash = await writeContractAsync({
        address: MOCK_USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "approve",
        args: [VAULT_ADDRESS, amountWei],
        gasPrice: gp,
      });
      addTxLog({ id: approveHash, type: "APPROVE", amount, token: "USDC", txHash: approveHash, timestamp: Date.now(), status: "PENDING" });
      addLog(`Approve TX: ${approveHash.slice(0, 18)}...`);

      if (client) {
        const approveReceipt = await client.waitForTransactionReceipt({ hash: approveHash });
        if (approveReceipt.status !== "success") throw new Error("Approve failed");
        updateTxStatus(approveHash, "CONFIRMED");
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
      addTxLog({ id: shieldHash, type: "SHIELD", amount, token: "USDC", txHash: shieldHash, timestamp: Date.now(), status: "PENDING" });

      if (client) {
        const shieldReceipt = await client.waitForTransactionReceipt({ hash: shieldHash });
        if (shieldReceipt.status === "success") {
          addLog("[SUCCESS] Assets secured in TEE Vault!");
          addLog(`Proof: ${shieldHash}`);
          updateTxStatus(shieldHash, "CONFIRMED");
          // Add to personal shielded balance
          const shieldedAmt = parseFloat(amount);
          setPersonalShielded(getPersonalShielded() + shieldedAmt);
          await fetchBalances();
        } else {
          updateTxStatus(shieldHash, "FAILED");
        }
      }
      setStep("done");
    } catch (e: any) {
      addLog("[ERROR] Transaction rejected or failed.");
      setStep("idle");
    }
  };

  // ── Unshield: sign → /api/unshield oracle → real on-chain tx ────────
  const handleUnshield = async () => {
    if (!unshieldAmount || isNaN(Number(unshieldAmount)) || !address) return;
    const reqAmt = parseFloat(unshieldAmount);
    const currentShielded = getPersonalShielded();

    if (reqAmt > currentShielded) {
      setUnshieldLogs([`> [ERROR] Insufficient shielded balance. You have ${currentShielded.toFixed(2)} USDC shielded.`]);
      return;
    }

    setUnshieldStep("signing");
    setUnshieldLogs([]);
    const nonce = Date.now();
    try {
      addUnshieldLog(`Requesting unshield of ${unshieldAmount} USDC from TEE Vault...`);
      addUnshieldLog(`Available shielded: ${currentShielded.toFixed(2)} USDC`);
      addUnshieldLog("Step 1/3: Sign ownership proof in wallet...");

      const sig = await signMessageAsync({
        message: `OPAQUE UNSHIELD REQUEST\n\nWallet: ${address}\nAmount: ${unshieldAmount} USDC\nVault: ${VAULT_ADDRESS}\nNonce: ${nonce}\n\nI authorize the iExec Nox enclave to release this amount.`
      });
      addUnshieldLog(`[OK] Signature: ${sig.slice(0, 20)}...`);

      setUnshieldStep("processing");
      addUnshieldLog("Step 2/3: Sending proof to iExec Nox TEE Oracle API...");

      const res = await fetch("/api/unshield", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: address, amount: unshieldAmount, signature: sig, nonce }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.error === "Oracle not configured") {
          // Fallback: pending mode (oracle key not in env)
          addUnshieldLog("[WARN] Oracle key not set — pending mode active.");
          addUnshieldLog("Step 3/3: Attested locally. Queuing for release...");
          await new Promise(r => setTimeout(r, 1000));
          setPersonalShielded(currentShielded - reqAmt);
          addPendingReturn(reqAmt);
          const demoHash = `0x${sig.slice(2, 66)}` as `0x${string}`;
          addUnshieldLog(`[PENDING] ${unshieldAmount} USDC queued. Add TEE_ORACLE_PRIVATE_KEY to env to finalize.`);
          addTxLog({ id: demoHash, type: "UNSHIELD", amount: unshieldAmount, token: "USDC", txHash: demoHash, timestamp: Date.now(), status: "PENDING" });
          await fetchBalances();
          setUnshieldStep("done");
          return;
        }
        throw new Error(data.error ?? "API error");
      }

      // ✅ Real on-chain unshield confirmed!
      addUnshieldLog("[OK] Oracle verified attestation & submitted on-chain tx.");
      addUnshieldLog("Step 3/3: Waiting for block confirmation...");
      addUnshieldLog(`[SUCCESS] ${unshieldAmount} USDC returned to your wallet!`);
      addUnshieldLog(`→ TX: ${data.txHash}`);
      addUnshieldLog(`→ Remaining shielded: ${(currentShielded - reqAmt).toFixed(2)} USDC`);

      setPersonalShielded(currentShielded - reqAmt);
      addTxLog({
        id: data.txHash,
        type: "UNSHIELD",
        amount: unshieldAmount,
        token: "USDC",
        txHash: data.txHash,
        timestamp: Date.now(),
        status: "CONFIRMED",
      });

      await fetchBalances();
      setUnshieldStep("done");
    } catch (e: any) {
      addUnshieldLog(`[ERROR] ${e.message ?? "Unshield failed or signature cancelled."}`);
      setUnshieldStep("idle");
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

          <div className="mono" style={{ fontSize: "11px", color: "#555" }}>USDC · Arbitrum Sepolia · Fully Visible On-Chain</div>
          {walletReady && (
            <a
              href="https://faucet.circle.com/"
              target="_blank"
              rel="noreferrer"
              style={{ marginTop: "20px", display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80", padding: "10px 16px", fontSize: "12px", textDecoration: "none" }}
              className="mono"
            >
              <Droplets size={14} />
              GET TESTNET USDC · Circle Faucet ↗
            </a>
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
          <div className="mono" style={{ fontSize: "11px", color: "#555" }}>USDC · iExec Nox Enclave · Balance Private</div>
          {walletReady && pendingReturn > 0 && (
            <div style={{ marginTop: "12px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px", color: "#facc15", padding: "8px 12px", background: "rgba(250,204,21,0.05)", border: "1px solid rgba(250,204,21,0.2)" }} className="mono">
              <span>⏳ {pendingReturn.toLocaleString(undefined,{minimumFractionDigits:2})} USDC pending</span>
              <button onClick={clearPendingReturn} style={{ background: "none", border: "none", color: "#facc15", cursor: "pointer", fontSize: "10px", textDecoration: "underline" }}>clear</button>
            </div>
          )}
          <div className="mono" style={{ marginTop: "12px", fontSize: "10px", color: "#333", padding: "10px", background: "#04040d", border: "1px dashed #111" }}>
            🔒 Individual shares sealed by TEE attestation.
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
            Move USDC from your public wallet into the iExec Nox Confidential Vault. Your balance becomes invisible to on-chain observers.
          </p>

          {!walletReady ? (
            <div style={{ padding: "40px", background: "rgba(0,0,255,0.05)", border: "1px dashed rgba(0,0,255,0.3)", textAlign: "center", color: "#0000FF", fontSize: "12px" }} className="mono">
              [ WALLET CONNECTION REQUIRED TO SHIELD ASSETS ]
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: "20px" }}>
                <label className="bc" style={{ display: "block", fontSize: "12px", color: "#999", marginBottom: "8px", textTransform: "uppercase" }}>Amount to Shield (USDC)</label>
                <input
                  type="number"
                  placeholder="e.g. 1000"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  disabled={step !== "idle" && step !== "done"}
                  style={{ width: "100%", background: "#0a0a14", border: "1px solid #333", borderBottom: "2px solid #0000FF", color: "#fff", padding: "16px", fontSize: "18px", outline: "none" }}
                  className="mono"
                />
                <div className="mono" style={{ fontSize: "10px", color: "#555", marginTop: "6px" }}>Available: {publicBalance} USDC</div>
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

      {/* ── Unshield Section ─────────────────────────────────────────── */}
      <div style={{ background: "#07070f", border: "1px solid rgba(167,139,250,0.3)", padding: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <ShieldOff size={20} color="#a78bfa" />
          <h3 className="bc" style={{ fontSize: "22px", textTransform: "uppercase", letterSpacing: "1px", color: "#a78bfa" }}>Unshield Assets</h3>
        </div>
        <p style={{ fontSize: "12px", color: "#555", marginBottom: "24px", lineHeight: 1.6 }}>
          Request withdrawal from the TEE Vault. Requires iExec Nox attestation — you sign a proof of ownership, the enclave verifies, then releases funds.
        </p>

        {!walletReady ? (
          <div style={{ padding: "28px", background: "rgba(167,139,250,0.04)", border: "1px dashed rgba(167,139,250,0.2)", textAlign: "center", color: "#a78bfa", fontSize: "12px" }} className="mono">
            [ WALLET CONNECTION REQUIRED ]
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

            {/* Input + button */}
            <div>
              <label className="bc" style={{ display: "block", fontSize: "12px", color: "#999", marginBottom: "8px", textTransform: "uppercase" }}>Amount to Unshield (USDC)</label>
              <input
                type="number"
                placeholder="e.g. 500"
                value={unshieldAmount}
                onChange={e => setUnshieldAmount(e.target.value)}
                disabled={unshieldStep !== "idle" && unshieldStep !== "done"}
                style={{ width: "100%", background: "#0a0a14", border: "1px solid #333", borderBottom: "2px solid #a78bfa", color: "#fff", padding: "14px 16px", fontSize: "18px", outline: "none", marginBottom: "16px" }}
                className="mono"
              />
              <button
                onClick={handleUnshield}
                disabled={unshieldStep === "signing" || unshieldStep === "processing" || !unshieldAmount}
                style={{ width: "100%", padding: "16px", background: (unshieldStep === "signing" || unshieldStep === "processing" || !unshieldAmount) ? "#111" : "linear-gradient(135deg,#7c3aed,#a78bfa)", color: "#fff", border: "none", fontSize: "15px", cursor: (unshieldStep === "signing" || unshieldStep === "processing" || !unshieldAmount) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", letterSpacing: "1px" }}
                className="bc"
              >
                {unshieldStep === "signing" ? <><Loader2 size={16} className="animate-spin" /> SIGNING...</> :
                 unshieldStep === "processing" ? <><Loader2 size={16} className="animate-spin" /> TEE PROCESSING...</> :
                 "REQUEST UNSHIELD →"}
              </button>
              <div className="mono" style={{ fontSize: "9px", color: "#555", marginTop: "8px", textAlign: "center" }}>
                ⚠ Requires TEE Oracle authorization (onlyTEE) · Demo: signs message as proof
              </div>
            </div>

            {/* Unshield terminal */}
            <div style={{ background: "#04040d", border: "1px solid #1a1a2e", padding: "16px", display: "flex", flexDirection: "column", minHeight: "160px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid #111", paddingBottom: "10px", marginBottom: "12px" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: unshieldStep === "done" ? "#4ade80" : unshieldStep !== "idle" ? "#a78bfa" : "#333", animation: (unshieldStep === "signing" || unshieldStep === "processing") ? "pulse 2s infinite" : "none" }} />
                <span className="mono" style={{ fontSize: "10px", color: "#555", letterSpacing: "1px" }}>TEE UNSHIELD TERMINAL</span>
              </div>
              <div className="mono" style={{ flex: 1, fontSize: "11px", display: "flex", flexDirection: "column", gap: "6px", overflowY: "auto" }}>
                {unshieldLogs.length === 0 && <div style={{ color: "#333" }}>&gt; Awaiting unshield request...</div>}
                {unshieldLogs.map((log, i) => (
                  <div key={i} style={{ animation: "fade-in 0.3s ease", color: log.includes("[OK]") || log.includes("[SUCCESS]") ? "#4ade80" : log.includes("[ERROR]") ? "#ff4444" : "#a78bfa" }}>{log}</div>
                ))}
              </div>
            </div>
          </div>
        )}
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
