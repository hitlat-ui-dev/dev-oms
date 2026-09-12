"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { FiTruck, FiMapPin, FiCalendar, FiAlertCircle, FiClock, FiCheckCircle } from "react-icons/fi";
import { decodeDispatchPayload, DispatchLabelPayload } from "@/lib/dispatchLabel";

// Public read-only receipt the printed QR points at. Two ways in:
//   ?d=<payload>  - straight off the sticker (works even before anyone has
//                   scanned the parcel into OMS, because the QR carries the
//                   parcel's own details - see lib/dispatchLabel.ts)
//   ?id=<record>  - the "View" link on the Dispatch History table
// Deliberately outside app/dashboard/ so it carries no dashboard chrome or
// login expectation - whoever is holding the parcel (courier, recipient)
// can scan and read it. Read-only: saving a dispatch happens in OMS's own
// scanner page, never here.
interface SavedDispatch {
  labelId?: string;
  fromFirmName: string;
  fromAddress?: string;
  fromMobile?: string;
  toInstituteName?: string;
  toBuyerName?: string;
  toAddress?: string;
  toMobile?: string;
  toPlace?: string;
  transporterName?: string;
  transporterMobile?: string;
  printedAt?: string;
  scannedAt?: string;
  /** Only on rows saved by the earlier print-time design. */
  createdAt?: string;
}

const label = { color: "#94a3b8", fontSize: 10, fontWeight: 900, textTransform: "uppercase" as const, letterSpacing: "0.15em", marginBottom: 4 };
const value = { color: "#0f172a", fontWeight: 700, fontSize: 14 };
const sub = { color: "#64748b", fontSize: 12, marginTop: 2 };

function DispatchReceipt() {
  const searchParams = useSearchParams();
  const d = searchParams.get("d");
  const id = searchParams.get("id");

  const [payload, setPayload] = useState<DispatchLabelPayload | null>(null);
  const [saved, setSaved] = useState<SavedDispatch | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      try {
        if (id) {
          const res = await fetch(`/api/dispatch-labels/${id}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || "Not found");
          setSaved(data);
          return;
        }
        if (d) {
          const decoded = decodeDispatchPayload(d);
          if (!decoded) throw new Error("This QR code could not be read");
          setPayload(decoded);
          // Already scanned into OMS? Then show the real dispatch details too.
          const res = await fetch(`/api/dispatch-labels?labelId=${encodeURIComponent(decoded.id)}`);
          if (res.ok) setSaved(await res.json());
          return;
        }
        throw new Error("Nothing to show");
      } catch (err: any) {
        setError(err.message || "Dispatch not found");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [d, id]);

  const info = saved || payload;
  const recipientName = (info as any)?.toInstituteName || (info as any)?.toBuyerName || "";
  const isDispatched = !!saved?.transporterName;

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ color: "#f97316", fontWeight: 900, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase" }}>Dev OMS</div>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: 20, marginTop: 4 }}>Dispatch Receipt</div>
        </div>

        <div style={{ background: "#fff", borderRadius: 20, overflow: "hidden", boxShadow: "0 20px 40px rgba(0,0,0,0.35)" }}>
          {loading && <div style={{ padding: 40, textAlign: "center", color: "#64748b", fontSize: 14 }}>Loading...</div>}

          {!loading && error && (
            <div style={{ padding: 40, textAlign: "center" }}>
              <FiAlertCircle size={32} color="#dc2626" style={{ margin: "0 auto 12px" }} />
              <div style={{ color: "#dc2626", fontWeight: 700, fontSize: 14 }}>{error}</div>
              <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 6 }}>Yeh QR code invalid hai ya record maujood nahi hai.</div>
            </div>
          )}

          {!loading && !error && info && (
            <>
              <div style={{ background: isDispatched ? "#065f46" : "#7c2d12", padding: "14px 24px", display: "flex", alignItems: "center", gap: 10 }}>
                {isDispatched ? <FiCheckCircle size={18} color="#6ee7b7" /> : <FiClock size={18} color="#fdba74" />}
                <div style={{ color: "#fff", fontWeight: 800, fontSize: 13 }}>
                  {isDispatched ? "Dispatched" : "Not scanned yet"}
                </div>
              </div>

              <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <div style={label}>From</div>
                  <div style={value}>{info.fromFirmName}</div>
                  {/* Sender address/mobile are deliberately not in the QR
                      payload (see lib/dispatchLabel.ts) - they only show on
                      records saved with them, never off a fresh sticker. */}
                  {saved?.fromAddress && <div style={sub}>{saved.fromAddress}</div>}
                  {saved?.fromMobile && <div style={sub}>Mob: {saved.fromMobile}</div>}
                </div>

                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <FiMapPin size={16} color="#0f172a" style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={label}>To</div>
                    <div style={value}>{recipientName}</div>
                    {info.toBuyerName && info.toInstituteName && <div style={sub}>{info.toBuyerName}</div>}
                    {info.toAddress && <div style={sub}>{info.toAddress}{info.toPlace ? `, ${info.toPlace}` : ""}</div>}
                    {info.toMobile && <div style={sub}>Mob: {info.toMobile}</div>}
                  </div>
                </div>

                {isDispatched && (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <FiTruck size={16} color="#0f172a" style={{ marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <div style={label}>Transporter</div>
                      <div style={value}>{saved?.transporterName}</div>
                      {saved?.transporterMobile && <div style={sub}>Mob: {saved.transporterMobile}</div>}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
                  <FiCalendar size={16} color="#0f172a" style={{ flexShrink: 0 }} />
                  <div>
                    <div style={label}>{isDispatched ? "Dispatched On" : "Label Printed On"}</div>
                    <div style={value}>
                      {/* createdAt is only reached by rows left over from the
                          earlier design that saved at print time. */}
                      {new Date((isDispatched ? (saved?.scannedAt || saved?.createdAt) : (saved?.printedAt || payload?.printedAt)) || Date.now())
                        .toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{ textAlign: "center", color: "#475569", fontSize: 10, marginTop: 16, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Dev OMS Internal Management System
        </div>
      </div>
    </div>
  );
}

export default function DispatchReceiptPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0f172a" }} />}>
      <DispatchReceipt />
    </Suspense>
  );
}
