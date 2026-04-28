"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useDisconnect } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState, useEffect } from "react";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  
  useEffect(() => { const t = setTimeout(() => setMounted(true), 0); return () => clearTimeout(t); }, []);
  useEffect(() => setMobileOpen(false), [pathname]); // Close sidebar on route change

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#080810", color: "#fff", position: "relative" }}>
      
      {/* Mobile Overlay */}
      <div className={`mobile-overlay ${mobileOpen ? 'open' : ''}`} onClick={() => setMobileOpen(false)}></div>

      {/* Sidebar */}
      <aside className={`dash-sidebar ${mobileOpen ? 'open' : ''}`} style={{ width: "260px", borderRight: "2px solid #1a1a1a", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "32px 24px", background: "#05050a" }}>
        <div>
           <Link href="/" className="bc" style={{ fontSize: "32px", fontWeight: 900, color: "#fff", textDecoration: "none", letterSpacing: "-1px" }}>OPAQUE_</Link>
           <div className="mono" style={{ fontSize: "10px", color: "#0000FF", marginTop: "4px", letterSpacing: "2px" }}>SYS:LIVE · ARBITRUM</div>
           
           <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "48px" }}>
             <Link href="/dashboard" className="bc" style={{ color: pathname === '/dashboard' ? "#fff" : "#666", fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", background: pathname === '/dashboard' ? "rgba(0,0,255,0.1)" : "transparent", borderLeft: pathname === '/dashboard' ? "3px solid #0000FF" : "3px solid transparent", textDecoration: "none", textTransform: "uppercase", letterSpacing: "1px", transition: "all 0.2s" }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                Compute Vault
             </Link>
             <Link href="/dashboard/shield" className="bc" style={{ color: pathname === '/dashboard/shield' ? "#fff" : "#666", fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", background: pathname === '/dashboard/shield' ? "rgba(0,0,255,0.1)" : "transparent", borderLeft: pathname === '/dashboard/shield' ? "3px solid #0000FF" : "3px solid transparent", textDecoration: "none", textTransform: "uppercase", letterSpacing: "1px", transition: "all 0.2s" }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                Shield Assets
             </Link>
             <Link href="/dashboard/analytics" className="bc" style={{ color: pathname === '/dashboard/analytics' ? "#fff" : "#666", fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", background: pathname === '/dashboard/analytics' ? "rgba(0,0,255,0.1)" : "transparent", borderLeft: pathname === '/dashboard/analytics' ? "3px solid #0000FF" : "3px solid transparent", textDecoration: "none", textTransform: "uppercase", letterSpacing: "1px", transition: "all 0.2s" }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
                Analytics
             </Link>
             <Link href="/dashboard/settings" className="bc" style={{ color: pathname === '/dashboard/settings' ? "#fff" : "#666", fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", background: pathname === '/dashboard/settings' ? "rgba(0,0,255,0.1)" : "transparent", borderLeft: pathname === '/dashboard/settings' ? "3px solid #0000FF" : "3px solid transparent", textDecoration: "none", textTransform: "uppercase", letterSpacing: "1px", transition: "all 0.2s" }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
                Settings
             </Link>
           </div>
        </div>

        <div>
         {mounted && isConnected ? (
             <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
               <div className="mono" style={{ fontSize: "10px", color: "#555", letterSpacing: "1px", paddingLeft: "2px" }}>CONNECTED WALLET</div>
               <div className="mono" style={{ fontSize: "11px", color: "#4ade80", padding: "8px 12px", background: "rgba(74,222,128,0.05)", border: "1px solid rgba(74,222,128,0.15)" }}>
                 {address?.slice(0,8)}...{address?.slice(-4)}
               </div>
               <button
                 className="mono"
                 onClick={() => disconnect()}
                 style={{ width: "100%", padding: "10px", fontSize: "11px", background: "rgba(255,50,50,0.06)", border: "1px solid rgba(255,50,50,0.25)", color: "#ff6666", cursor: "pointer", letterSpacing: "1px", transition: "all 0.2s" }}
                 onMouseOver={e => { e.currentTarget.style.background = "rgba(255,50,50,0.15)"; e.currentTarget.style.borderColor = "#ff4444"; e.currentTarget.style.color = "#fff"; }}
                 onMouseOut={e => { e.currentTarget.style.background = "rgba(255,50,50,0.06)"; e.currentTarget.style.borderColor = "rgba(255,50,50,0.25)"; e.currentTarget.style.color = "#ff6666"; }}
               >
                 ⏻ DISCONNECT
               </button>
             </div>
           ) : (
             <ConnectButton.Custom>
               {({ openConnectModal }) => (
                 <button className="btn-primary bc" onClick={openConnectModal} style={{ width: "100%", padding: "14px", fontSize: "14px" }}>
                   CONNECT WALLET
                 </button>
               )}
             </ConnectButton.Custom>
           )}
           <div style={{ marginTop: "24px", paddingTop: "24px", borderTop: "2px solid #1a1a1a" }}>
             <Link href="/" className="mono" style={{ color: "#666", fontSize: "11px", textDecoration: "none", display: "flex", alignItems: "center", gap: "8px", transition: "color 0.2s" }} onMouseOver={e => e.currentTarget.style.color = '#fff'} onMouseOut={e => e.currentTarget.style.color = '#666'}>
               ← RETURN TO HOME
             </Link>
           </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="dash-main" style={{ flex: 1, height: "100vh", overflowY: "auto" }}>
        
        <header className="dash-header-wrap" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "48px", borderBottom: "2px solid #1a1a1a", paddingBottom: "24px" }}>
           <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
             <button className="hamburger-btn" onClick={() => setMobileOpen(true)}>
               <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
             </button>
             <div>
             <h1 className="bc" style={{ fontSize: "clamp(28px, 6vw, 40px)", textTransform: "uppercase", lineHeight: 1, letterSpacing: "-1px" }}>
               {pathname === '/dashboard' && "Confidential Compute"}
               {pathname === '/dashboard/shield' && "Asset Shielding"}
               {pathname === '/dashboard/analytics' && "Risk & Analytics"}
               {pathname === '/dashboard/settings' && "Protocol Settings"}
             </h1>
             <div className="mono" style={{ color: "#666", fontSize: "12px", marginTop: "8px" }}>iExec Nox TEE Enclave</div>
            </div>
           </div>
           <div className="mono" style={{ padding: "8px 16px", background: "rgba(0,0,255,0.1)", color: "#0000FF", fontSize: "11px", border: "1px solid #0000FF", display: "flex", alignItems: "center", gap: "8px", textTransform: "uppercase", letterSpacing: "1px" }}>
             <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#0000FF" }}></div>
             Nox Layer: Active
           </div>
        </header>

        {children}

      </main>
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .dash-main { padding: 48px 60px; }
        .hamburger-btn { display: none; }
        .mobile-overlay { display: none; }
        .dash-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
        .dash-grid-2fr { display: grid; grid-template-columns: 2fr 1fr; gap: 40px; }
        .dash-grid-3col { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        
        @media (max-width: 900px) {
          .dash-sidebar { position: fixed; height: 100vh; left: 0; top: 0; transform: translateX(-100%); z-index: 50; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
          .dash-sidebar.open { transform: translateX(0); }
          .dash-main { padding: 24px 20px; }
          .hamburger-btn { display: flex; align-items: center; justify-content: center; background: #0000FF; border: none; color: #fff; width: 44px; height: 44px; cursor: pointer; border-radius: 4px; flex-shrink: 0; }
          .mobile-overlay.open { display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 40; backdrop-filter: blur(4px); }
          .dash-header-wrap { flex-direction: column; align-items: flex-start !important; gap: 20px; }
          .dash-grid-2, .dash-grid-2fr, .dash-grid-3col { grid-template-columns: 1fr; gap: 24px; }
        }
      `}} />
    </div>
  );
}
