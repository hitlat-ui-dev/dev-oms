"use client";
import { useEffect, useState } from "react";
import { FiLock, FiX } from "react-icons/fi";

// Screen-locks a page behind a PIN - a page reload always re-checks the
// server (isSet), but a successful unlock is remembered for the rest of this
// tab's session (sessionStorage), so navigating away and back within the same
// tab doesn't ask again. Closing the tab / opening a new one does.
function unlockedKey(page: string) {
  return `oms_pin_unlocked_${page}`;
}

type Status = "checking" | "setup" | "locked" | "open";

export default function PinGate({ page, children }: { page: string; children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showChange, setShowChange] = useState(false);

  useEffect(() => {
    let unlocked = false;
    try {
      unlocked = sessionStorage.getItem(unlockedKey(page)) === "1";
    } catch {
      // storage blocked - falls through to asking for the PIN every time
    }
    if (unlocked) {
      setStatus("open");
      return;
    }
    fetch(`/api/page-lock?page=${page}`)
      .then((r) => r.json())
      .then((data) => setStatus(data?.isSet ? "locked" : "setup"))
      .catch(() => setStatus("setup"));
  }, [page]);

  const markUnlocked = () => {
    try {
      sessionStorage.setItem(unlockedKey(page), "1");
    } catch {
      // ignore - the tab will just ask again next time
    }
    setStatus("open");
  };

  const submitSetup = async () => {
    setError("");
    if (!/^\d{4,8}$/.test(pin)) return setError("PIN 4-8 digit ka number hona chahiye.");
    if (pin !== confirmPin) return setError("Dono PIN match nahi ho rahe.");
    setBusy(true);
    try {
      const res = await fetch("/api/page-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, action: "set", pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      markUnlocked();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitVerify = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/page-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, action: "verify", pin }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "Galat PIN");
      markUnlocked();
    } catch (err: any) {
      setError(err.message);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  if (status === "checking") return null;

  if (status === "open") {
    return (
      <>
        {children}
        {/* A tiny floating control so "PIN badalna hai" doesn't need re-locking
            the page first - it's a lock, not a hidden setting. */}
        <button
          onClick={() => setShowChange(true)}
          title="PIN badlo"
          className="fixed bottom-4 left-4 z-40 bg-slate-800/80 hover:bg-slate-900 text-white/70 hover:text-white rounded-full p-2.5 shadow-lg transition-colors"
        >
          <FiLock size={13} />
        </button>
        {showChange && <ChangePinModal page={page} onClose={() => setShowChange(false)} />}
      </>
    );
  }

  const inputCls =
    "w-full text-center text-lg tracking-[0.5em] font-black bg-slate-50 border border-slate-200 rounded-xl py-3 focus:outline-none focus:border-blue-500";

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f3f6f9] p-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="flex flex-col items-center text-center gap-2 mb-5">
          <div className="bg-[#0a2540] text-white p-4 rounded-2xl">
            <FiLock size={22} />
          </div>
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-900">
            {status === "setup" ? "PIN Set Karo" : "PIN Daalo"}
          </h2>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            {status === "setup" ? "Is page ko lock karne ke liye ek PIN banao" : "Is page ko kholne ke liye PIN chahiye"}
          </p>
        </div>

        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          onKeyDown={(e) => e.key === "Enter" && (status === "setup" ? submitSetup() : submitVerify())}
          placeholder="PIN"
          className={`${inputCls} mb-3`}
        />
        {status === "setup" && (
          <input
            type="password"
            inputMode="numeric"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            onKeyDown={(e) => e.key === "Enter" && submitSetup()}
            placeholder="PIN dobara"
            className={`${inputCls} mb-3`}
          />
        )}
        {error && <p className="text-[11px] font-bold text-rose-600 text-center mb-3">{error}</p>}
        <button
          onClick={status === "setup" ? submitSetup : submitVerify}
          disabled={busy || !pin}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl py-3 text-xs font-black uppercase tracking-wider"
        >
          {busy ? "..." : status === "setup" ? "PIN Set Karo" : "Unlock"}
        </button>
      </div>
    </div>
  );
}

function ChangePinModal({ page, onClose }: { page: string; onClose: () => void }) {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const inputCls =
    "w-full text-center text-base tracking-[0.4em] font-black bg-slate-50 border border-slate-200 rounded-xl py-2.5 focus:outline-none focus:border-blue-500";

  const submit = async () => {
    setError("");
    if (!/^\d{4,8}$/.test(newPin)) return setError("Naya PIN 4-8 digit ka number hona chahiye.");
    if (newPin !== confirmPin) return setError("Dono naye PIN match nahi ho rahe.");
    setBusy(true);
    try {
      const res = await fetch("/api/page-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, action: "change", currentPin, pin: newPin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-xs shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 bg-[#0a2540] text-white flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider">PIN Badlo</h3>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <FiX size={16} />
          </button>
        </div>
        <div className="p-5 flex flex-col gap-2.5">
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="Current PIN"
            className={inputCls}
          />
          <input
            type="password"
            inputMode="numeric"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="Naya PIN"
            className={inputCls}
          />
          <input
            type="password"
            inputMode="numeric"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Naya PIN dobara"
            className={inputCls}
          />
          {error && <p className="text-[11px] font-bold text-rose-600 text-center">{error}</p>}
          <button
            onClick={submit}
            disabled={busy}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl py-2.5 text-[11px] font-black uppercase tracking-wider mt-1"
          >
            {busy ? "Saving..." : "PIN Update Karo"}
          </button>
        </div>
      </div>
    </div>
  );
}
