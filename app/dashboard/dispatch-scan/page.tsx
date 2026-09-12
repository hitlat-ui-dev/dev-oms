"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FiCamera, FiCheckCircle, FiAlertCircle, FiTruck, FiMapPin, FiRefreshCw, FiArrowLeft } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { decodeDispatchPayload, DispatchLabelPayload } from "@/lib/dispatchLabel";

// Dispatch Scanner - the ONLY place a dispatch record gets created.
// Printing a label saves nothing (see app/dashboard/print-labels/page.tsx);
// the QR stuck on the parcel carries the parcel's own details, and the
// dispatch is recorded only here, once someone scans the parcel and picks the
// transporter it is actually going out with.
type Stage = "idle" | "scanning" | "review" | "saved";

// Most parcels here go out with this one transporter, so it's pinned to the
// top of the picker instead of sitting wherever it falls in a 25+ entry list
// - one tap instead of a search on the common case.
const PINNED_TRANSPORTER = "MAHAVEER COURIER";

export default function DispatchScanPage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [payload, setPayload] = useState<DispatchLabelPayload | null>(null);
  const [alreadyScanned, setAlreadyScanned] = useState<any>(null);
  const [transporters, setTransporters] = useState<any[]>([]);
  const [transporterSearch, setTransporterSearch] = useState("");
  const [selectedTransporter, setSelectedTransporter] = useState<any>(null);
  const [showTransporterList, setShowTransporterList] = useState(false);
  const [savedRecord, setSavedRecord] = useState<any>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const scannerRef = useRef<any>(null);
  const transporterBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/transporters")
      .then((res) => res.json())
      .then((data) => setTransporters(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load transporters", err));
  }, []);

  // Tap outside the search box or its dropdown closes it, same as any
  // standard combobox - otherwise it stays open over the rest of the form.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (transporterBoxRef.current && !transporterBoxRef.current.contains(e.target as Node)) {
        setShowTransporterList(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Search-filtered transporter list for the dropdown below the input, with
  // the pinned transporter always floated to the top (even while filtering,
  // as long as it still matches) instead of a plain native <datalist> - which
  // renders inconsistently (or not at all) as a scrollable list on mobile
  // browsers, exactly where this page is actually used.
  const filteredTransporters = (() => {
    const q = transporterSearch.trim().toLowerCase();
    const list = q ? transporters.filter((t: any) => (t.name || "").toLowerCase().includes(q)) : transporters;
    const pinnedIndex = list.findIndex((t: any) => (t.name || "").trim().toUpperCase() === PINNED_TRANSPORTER);
    if (pinnedIndex > 0) {
      const reordered = [...list];
      const [pinned] = reordered.splice(pinnedIndex, 1);
      reordered.unshift(pinned);
      return reordered;
    }
    return list;
  })();

  const selectTransporter = (t: any) => {
    setSelectedTransporter(t);
    setTransporterSearch(t.name);
    setShowTransporterList(false);
  };

  const stopCamera = async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      await scanner.stop();
      scanner.clear();
    } catch {
      // camera already released
    }
  };

  // Release the camera if the user navigates away mid-scan - a live video
  // track left running keeps the camera busy for every other app on the phone.
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const currentUsername = (): string => {
    try {
      const stored = localStorage.getItem("oms_user");
      if (stored) return JSON.parse(stored)?.username || "";
    } catch {
      // ignore
    }
    return "";
  };

  const handleScanned = async (text: string) => {
    // The QR holds the receipt URL (.../dispatch?d=<payload>) so that a plain
    // phone camera app can open it too - pull the payload back out of it here.
    let encoded = "";
    try {
      encoded = new URL(text).searchParams.get("d") || "";
    } catch {
      encoded = text.includes("d=") ? text.split("d=")[1] : "";
    }
    const decoded = encoded ? decodeDispatchPayload(encoded) : null;

    if (!decoded) {
      setError("Yeh Dev OMS ka dispatch label nahi hai - sahi QR dobara scan karo.");
      return;
    }

    await stopCamera();
    setError("");
    setPayload(decoded);

    // Same sticker scanned twice? Show what is already on file instead of
    // quietly creating a second dispatch for one parcel.
    try {
      const res = await fetch(`/api/dispatch-labels?labelId=${encodeURIComponent(decoded.id)}`);
      setAlreadyScanned(res.ok ? await res.json() : null);
    } catch {
      setAlreadyScanned(null);
    }
    setStage("review");
  };

  const startCamera = async () => {
    setError("");
    setPayload(null);
    setAlreadyScanned(null);
    setSavedRecord(null);
    setSelectedTransporter(null);
    setTransporterSearch("");
    setStage("scanning");

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("dispatch-qr-reader");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText: string) => {
          handleScanned(decodedText);
        },
        () => {
          // fires for every frame with no QR in view - not worth showing
        }
      );
    } catch (err: any) {
      scannerRef.current = null;
      setStage("idle");
      setError(
        "Camera nahi khul payi: " +
          (err?.message || "permission denied") +
          ". Phone par site HTTPS se kholo aur camera permission allow karo."
      );
    }
  };

  const handleSave = async () => {
    if (!payload) return;
    const transporterName = selectedTransporter?.name || transporterSearch.trim();
    if (!transporterName) {
      alert("Pehle transport select karo.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/dispatch-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labelId: payload.id,
          printedAt: payload.printedAt,
          fromFirmCode: payload.fromFirmCode,
          fromFirmName: payload.fromFirmName,
          toInstituteName: payload.toInstituteName,
          toBuyerName: payload.toBuyerName,
          toAddress: payload.toAddress,
          toMobile: payload.toMobile,
          toPlace: payload.toPlace,
          transporterName,
          transporterMobile: selectedTransporter?.contacts?.[0]?.mobile || "",
          scannedBy: currentUsername(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed");
      setSavedRecord(data);
      setStage("saved");
    } catch (err: any) {
      alert("Dispatch save nahi hua: " + (err.message || "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  const recipientName = payload?.toInstituteName || payload?.toBuyerName || "";

  return (
    <BlockGuard
      permission="printLabels"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link href="/dashboard" className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg hover:bg-slate-800 transition-all">
            Go to Dashboard
          </Link>
        </div>
      }
    >
      <div className="p-4 sm:p-10 max-w-xl mx-auto bg-gray-50 min-h-screen">
        <Link
          href="/dashboard/print-labels"
          className="flex items-center gap-2 text-slate-500 hover:text-blue-600 font-bold text-xs uppercase tracking-widest mb-4"
        >
          <FiArrowLeft /> Back to Labels
        </Link>

        <div className="bg-white p-6 sm:p-8 rounded-xl shadow-md border border-gray-200">
          <h1 className="text-xl sm:text-2xl font-bold mb-2 flex items-center gap-2 text-gray-800">
            <FiCamera className="text-blue-600" /> Dispatch Scanner
          </h1>
          <p className="text-xs text-gray-500 mb-6">
            Parcel par laga QR scan karo, transport select karo - dispatch record OMS me save ho jayega.
          </p>

          {error && (
            <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
              <FiAlertCircle className="mt-0.5 shrink-0" /> <span>{error}</span>
            </div>
          )}

          {/* html5-qrcode mounts the camera preview into this div - it must stay
              in the DOM while scanning, so it is hidden, never unmounted. */}
          <div className={stage === "scanning" ? "block" : "hidden"}>
            <div id="dispatch-qr-reader" className="w-full rounded-xl overflow-hidden border-2 border-blue-200" />
            <button
              onClick={async () => {
                await stopCamera();
                setStage("idle");
              }}
              className="w-full mt-4 border-2 border-gray-200 text-gray-600 py-3 rounded-xl font-bold"
            >
              Cancel
            </button>
          </div>

          {stage === "idle" && (
            <button
              onClick={startCamera}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-bold text-lg shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2"
            >
              <FiCamera /> START SCANNING
            </button>
          )}

          {stage === "review" && payload && (
            <div className="space-y-5">
              {alreadyScanned && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg text-sm">
                  <FiAlertCircle className="mt-0.5 shrink-0" />
                  <span>
                    Yeh parcel pehle hi scan ho chuka hai - <b>{alreadyScanned.transporterName}</b> se,{" "}
                    {new Date(alreadyScanned.scannedAt).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}{" "}
                    ko.
                  </span>
                </div>
              )}

              <div className="border border-gray-100 rounded-xl p-4 bg-gray-50 space-y-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">From</div>
                  <div className="font-bold text-gray-800">{payload.fromFirmName}</div>
                </div>
                <div className="flex items-start gap-2">
                  <FiMapPin className="mt-1 text-gray-700 shrink-0" size={14} />
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">To</div>
                    <div className="font-bold text-gray-800">{recipientName}</div>
                    {payload.toAddress && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        {payload.toAddress}
                        {payload.toPlace ? `, ${payload.toPlace}` : ""}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div ref={transporterBoxRef} className="relative">
                <label className="block text-sm font-semibold text-gray-600 mb-2">Transport Detail *</label>
                <input
                  type="text"
                  placeholder="Search transporter..."
                  value={transporterSearch}
                  onFocus={() => setShowTransporterList(true)}
                  onChange={(e) => {
                    const val = e.target.value;
                    setTransporterSearch(val);
                    setSelectedTransporter(null);
                    setShowTransporterList(true);
                  }}
                  className="w-full border-2 border-gray-100 p-3 rounded-lg focus:border-blue-500 outline-none transition"
                />

                {/* Scrollable tap-to-select list - opens on focus, filters as
                    you type, closes on pick or tap-outside. */}
                {showTransporterList && (
                  <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto bg-white border-2 border-gray-100 rounded-lg shadow-xl">
                    {filteredTransporters.length === 0 ? (
                      <div className="p-3 text-sm text-gray-400 text-center">
                        No match - "{transporterSearch}" will be saved as typed.
                      </div>
                    ) : (
                      filteredTransporters.map((t: any) => {
                        const isPinned = (t.name || "").trim().toUpperCase() === PINNED_TRANSPORTER;
                        return (
                          <button
                            type="button"
                            key={t._id}
                            onClick={() => selectTransporter(t)}
                            className={`w-full text-left px-4 py-3 border-b border-gray-50 last:border-b-0 hover:bg-blue-50 active:bg-blue-100 transition ${isPinned ? "bg-amber-50" : ""}`}
                          >
                            <div className="font-bold text-sm text-gray-800 flex items-center gap-2">
                              {t.name}
                              {isPinned && (
                                <span className="text-[9px] font-black uppercase tracking-wider text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded shrink-0">
                                  Most Used
                                </span>
                              )}
                            </div>
                            {(t.deliveryArea || t.address) && (
                              <div className="text-xs text-gray-500 mt-0.5">{t.deliveryArea || t.address}</div>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                {selectedTransporter?.contacts?.[0]?.mobile && (
                  <p className="text-xs text-gray-500 mt-1">Contact: {selectedTransporter.contacts[0].mobile}</p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setStage("idle");
                    setPayload(null);
                  }}
                  className="flex-1 border-2 border-gray-200 text-gray-600 py-3 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-bold shadow-lg disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  <FiTruck /> {saving ? "Saving..." : "SAVE DISPATCH"}
                </button>
              </div>
            </div>
          )}

          {stage === "saved" && savedRecord && (
            <div className="text-center space-y-4">
              <FiCheckCircle size={44} className="text-green-600 mx-auto" />
              <div>
                <div className="font-bold text-lg text-gray-800">
                  {savedRecord.alreadyScanned ? "Pehle se saved tha" : "Dispatch saved!"}
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  {savedRecord.toInstituteName || savedRecord.toBuyerName} - {savedRecord.transporterName}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {new Date(savedRecord.scannedAt).toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              <button
                onClick={startCamera}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2"
              >
                <FiRefreshCw /> SCAN NEXT PARCEL
              </button>
            </div>
          )}
        </div>
      </div>
    </BlockGuard>
  );
}
