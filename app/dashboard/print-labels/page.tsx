"use client";
import { useState, useEffect } from "react";
import { FiPrinter, FiSearch, FiExternalLink, FiCamera } from "react-icons/fi";
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import BlockGuard from "@/components/BlockGuard";
import Link from "next/link";
import { newLabelId, dispatchScanUrl, DispatchLabelPayload } from "@/lib/dispatchLabel";

// Used only if a company has neither dispatchAddress nor mobile set (e.g. an
// older record created before those fields existed) - keeps label generation
// from crashing rather than pretending to be a real address.
const FALLBACK_CONTACT = {
    address: "ADDRESS NOT SET - please add it on the Companies page",
    mobile: "MOBILE NOT SET"
};

// Every extra character here adds a module to the printed QR, and the QR is
// already sized to the edge of what a phone camera can reliably read off a
// small sticker (see the addImage calls below). An unusually long institute
// name or address must not be free to grow the QR past that point - clamp it
// instead, same trade-off as the sender-address clamp on the FROM block.
function clampForQr(value: string, maxLen: number): string {
    const v = (value || "").trim();
    return v.length > maxLen ? v.slice(0, maxLen - 1).trimEnd() + "…" : v;
}

// A row of the Dispatch History table - these are SCANNED parcels, not
// printed labels. A label that was printed but never scanned has no record
// at all (see handlePrint below).
interface DispatchRecord {
    _id: string;
    fromFirmName: string;
    toInstituteName?: string;
    toBuyerName?: string;
    transporterName: string;
    scannedBy?: string;
    scannedAt: string;
    /** Only on rows saved by the earlier print-time design - see the date cell below. */
    createdAt?: string;
}

export default function PrintLabelsPage() {
    const [companies, setCompanies] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [selectedFrom, setSelectedFrom] = useState<any>(null);
    const [selectedTo, setSelectedTo] = useState<any>(null);
    const [labelSize, setLabelSize] = useState<"4x4" | "3.5x6">("3.5x6");
    const [fromSearch, setFromSearch] = useState("");
    const [toSearch, setToSearch] = useState("");
    const [printing, setPrinting] = useState(false);

    const [history, setHistory] = useState<DispatchRecord[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [historySearch, setHistorySearch] = useState("");

    useEffect(() => {
        Promise.all([
            fetch("/api/companies").then((res) => res.json()),
            fetch("/api/sellers").then((res) => res.json()),
        ]).then(([companyData, vendorData]) => {
            setCompanies(companyData);
            setVendors(vendorData);
        });
    }, []);
//console.log(selectedTo);

    // Dispatch History table - re-fetched (debounced) whenever the search box
    // changes, same "hit the API's own ?q= filter rather than filtering a
    // giant client-side list" approach as the Bill History search.
    const fetchHistory = () => {
        setLoadingHistory(true);
        const qs = historySearch.trim() ? `?q=${encodeURIComponent(historySearch.trim())}` : "";
        fetch(`/api/dispatch-labels${qs}`)
            .then((res) => res.json())
            .then((data) => setHistory(Array.isArray(data) ? data : []))
            .catch((err) => console.error("Failed to load dispatch history", err))
            .finally(() => setLoadingHistory(false));
    };

    useEffect(() => {
        const t = setTimeout(fetchHistory, 300);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [historySearch]);

    const handlePrint = async () => {
        if (!selectedFrom || !selectedTo) {
            alert("Please select both From and To addresses");
            return;
        }

        setPrinting(true);
        try {
            // Printing saves NOTHING. A printed label is just a sticker - the
            // parcel may never actually go out, or may go days later with a
            // transporter nobody has picked yet. The dispatch record is only
            // created when the parcel is scanned on the Dispatch Scanner page,
            // where the transporter is chosen.
            //
            // That means the QR itself has to carry the parcel's details
            // (there is no id in the database to point at yet), so it holds a
            // self-contained payload - see lib/dispatchLabel.ts. Values are
            // snapshotted at print time, same reasoning as firmSnapshot /
            // buyerSnapshot on Bills: editing a company or institute later
            // must never rewrite what an already-printed sticker says.
            const payload: DispatchLabelPayload = {
                id: newLabelId(),
                fromFirmCode: selectedFrom.firmCode || "",
                fromFirmName: clampForQr(selectedFrom.firmName, 35),
                toInstituteName: clampForQr(selectedTo.instituteName || "", 45),
                toBuyerName: clampForQr(selectedTo.buyerName || "", 30),
                toAddress: clampForQr(selectedTo.address || "", 50),
                toMobile: selectedTo.mobile || "",
                toPlace: selectedTo.place || "",
                printedAt: new Date().toISOString(),
            };

            // Encoded as a URL so an ordinary phone camera app opens the
            // public receipt page too - the OMS scanner reads the same string
            // and pulls the payload back out of it.
            const scanUrl = dispatchScanUrl(window.location.origin, payload);
            // margin here is the QR's own "quiet zone" - the blank border a
            // scanner uses to first LOCATE the code before it can even try to
            // read it. margin:1 was too tight for a real camera at printed
            // size/distance; 4 is the spec-recommended minimum.
            const qrDataUrl = await QRCode.toDataURL(scanUrl, { margin: 4, errorCorrectionLevel: "M" });

            printLabelPdf(qrDataUrl);
        } catch (err: any) {
            alert("QR code generate nahi hua: " + (err.message || "unknown error"));
        } finally {
            setPrinting(false);
        }
    };

    // Builds and opens the actual label PDF - split out from handlePrint so
    // the dispatch-record save (which must complete first, see above) stays
    // clearly separate from pure PDF-drawing logic.
    const printLabelPdf = (qrDataUrl: string) => {
        const is35x6 = labelSize === "3.5x6";
        const doc = new jsPDF({
            orientation: "portrait",
            unit: "in",
            format: is35x6 ? [3.5, 6] : [4, 4]
        });

        // Pull the sender's address/mobile from the selected company itself
        // (set on the Companies page) so it changes along with the Sender
        // dropdown, instead of a fixed lookup that only covered 2 firms.
        // dispatchAddress is deliberately separate from sellerRegisterAddress,
        // which is used for a different purpose elsewhere.
        const fromExtra = {
            address: selectedFrom.dispatchAddress || FALLBACK_CONTACT.address,
            mobile: selectedFrom.mobile || FALLBACK_CONTACT.mobile
        };
        const options = { angle: -90 };

        if (is35x6) {
            // --- 3.5 x 6 VERTICAL DESIGN ---
            let colToX = 3.2;
            let yStart = 0.5;

            // 1. SHIP TO SECTION
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.text("SHIP TO:", colToX, yStart, options);

            // --- START: ADD PLACE NAME BESIDE SHIP TO ---
            const placeName = (selectedTo.place || "MEHSANA").toUpperCase();
            doc.setFontSize(16); // Big font for Place
            // Positioned beside "SHIP TO:" (higher Y in rotated view)
            const placeY = yStart + 0.8;
            doc.text(placeName, colToX, placeY, options);

            // Add Underline for Place
            const placeWidth = doc.getTextWidth(placeName);
            doc.setLineWidth(0.01);
            // Draw line based on rotated coordinates
            doc.line(colToX - 0.04, placeY, colToX - 0.04, placeY + placeWidth);

            colToX -= 0.3;
            if (selectedTo.buyerName) {
                doc.setFontSize(11);
                doc.setFont("helvetica", "bold");
                const bName = (selectedTo.buyerName).toUpperCase();
                doc.text(bName, colToX, yStart, options);
                colToX -= 0.22; // Move left for the Institute Name
            }
            doc.setFontSize(14);
            const toName = (selectedTo.instituteName || selectedTo.buyerName || "").toUpperCase();
            const toNameLines = doc.splitTextToSize(toName, 5.0);
            doc.text(toNameLines, colToX, yStart, options);

            colToX -= (toNameLines.length * 0.22);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            const toAddr = doc.splitTextToSize((selectedTo.address || "").toUpperCase(), 5.0);
            doc.text(toAddr, colToX, yStart, options);

            colToX -= (toAddr.length * 0.16) + 0.15;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.text(`MOB: ${selectedTo.mobile || ""}`, colToX, yStart, options);

            // 2. CENTER DIVIDER (Adjusted to give more room to SHIP TO)
            doc.setLineWidth(0.005);
            doc.line(1.4, 0.5, 1.4, 5.5);

            // 3. FROM SECTION (Fixed to Bottom/Right of PDF)
            // colFromX set to 1.1 ensures it stays at the very bottom of the 3.5" width
            let colFromX = 1.1;
            let yStartFooter = 0.5;

            // Firm name and address are both wrapped to 3.8in rather than the
            // full 5.0in, so the whole sender block ends by y=4.3 and leaves
            // the bottom of this side of the label clear for the QR below.
            // The cost is extra wrapped lines, and on this rotated layout each
            // line steps colFromX further LEFT - enough of them and the block
            // walks off the edge of the sticker. So, exactly as in the 4x4
            // branch, step the type down until it fits and then clamp the
            // sender address to the lines there is room for.
            const FROM_WRAP = 3.8;
            const FROM_LEFT_LIMIT = 0.2;
            const colStep = (pt: number) => (pt / 72) * 1.15;
            const typeSteps = [
                { name: 12, addr: 9, mob: 11 },
                { name: 11, addr: 8, mob: 10 },
                { name: 10, addr: 7, mob: 9 },
            ];

            let chosen = typeSteps[typeSteps.length - 1];
            let fromName: string[] = [];
            let fromAddr: string[] = [];
            for (const step of typeSteps) {
                doc.setFont("helvetica", "bold");
                doc.setFontSize(step.name);
                const nameLines = doc.splitTextToSize(selectedFrom.firmName.toUpperCase(), FROM_WRAP);
                doc.setFont("helvetica", "normal");
                doc.setFontSize(step.addr);
                const addrLines = doc.splitTextToSize(fromExtra.address.toUpperCase(), FROM_WRAP);

                chosen = step;
                fromName = nameLines;
                fromAddr = addrLines;

                const mobX = colFromX - 0.22
                    - nameLines.length * colStep(step.name)
                    - addrLines.length * colStep(step.addr) - 0.05;
                if (mobX >= FROM_LEFT_LIMIT) break;
            }

            const addrStartX = colFromX - 0.22 - fromName.length * colStep(chosen.name);
            const maxAddrLines = Math.max(
                1,
                Math.floor((addrStartX - FROM_LEFT_LIMIT - 0.05) / colStep(chosen.addr))
            );
            fromAddr = fromAddr.slice(0, maxAddrLines);

            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.text("FROM:", colFromX, yStartFooter, options);

            colFromX -= 0.22;
            doc.setFontSize(chosen.name);
            doc.text(fromName, colFromX, yStartFooter, options);

            colFromX -= fromName.length * colStep(chosen.name);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(chosen.addr);
            doc.text(fromAddr, colFromX, yStartFooter, options);

            colFromX -= fromAddr.length * colStep(chosen.addr) + 0.05;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(chosen.mob);
            doc.text(`MOB: ${fromExtra.mobile}`, colFromX, yStartFooter, options);

            // 4. DISPATCH QR - scan this on the Dispatch Scanner page to
            // record the parcel going out. Sits on the FROM side (left of the
            // x=1.4 divider), below the sender block, which the narrower
            // address wrap above keeps clear from y=4.4 down.
            //
            // 1.05in, NOT the token-sized square a label usually gets: at this
            // payload the QR runs 77-85 modules, so anything smaller prints
            // modules thinner than a thermal printer dot. Kept 0.2in off the
            // left page edge and the x=1.4 divider - most printers refuse to
            // mark right up to a page edge, and anything actually clipped
            // there breaks the QR outright, not just makes it small. Left
            // unrotated - a QR scans from any angle, so matching the -90 text
            // orientation would buy nothing and only complicate the placement.
            doc.addImage(qrDataUrl, "PNG", 0.2, 4.6, 1.05, 1.05);

        } else {
            // --- 4x4 STANDARD DESIGN ---
            // Reduced top padding from 0.5 to 0.3 for a tighter look
            let y = 0.4;

            // 1. SHIP TO & PLACE HEADER
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.text("SHIP TO:", 0.3, y);

            // Get Place and Add Underline
            const placeName = (selectedTo.place || "MEHSANA").toUpperCase();
            doc.setFontSize(16);
            doc.text(placeName, 1.1, y + 0.02);

            // Drawing the underline for Place
            const placeWidth = doc.getTextWidth(placeName);
            doc.setLineWidth(0.01);
            doc.line(1.1, y + 0.06, 1.1 + placeWidth, y + 0.06);

            // Reduced gap between Header and Names
            let currentY = y + 0.50;

            // 2. BUYER NAME (Font: 16)
            if (selectedTo.buyerName) {
                doc.setFontSize(18);
                doc.setFont("helvetica", "bold");
                const bName = (selectedTo.buyerName).toUpperCase();
                doc.text(bName, 0.3, currentY);
                currentY += 0.28;
            }

            // 3. INSTITUTE NAME (Font: 18)
            doc.setFontSize(20);
            doc.setFont("helvetica", "bold");
            const instName = (selectedTo.instituteName || "").toUpperCase();
            const instLines = doc.splitTextToSize(instName, 3.4);
            doc.text(instLines, 0.3, currentY);

            // Tightened space between Institute Name and Address (from 0.3 to 0.15)
            currentY += (instLines.length * 0.26) + 0.05;

            // 4. ADDRESS
            doc.setFont("helvetica", "normal");
            doc.setFontSize(11);
            const toAddr = doc.splitTextToSize((selectedTo.address || "").toUpperCase(), 3.4);
            doc.text(toAddr, 0.3, currentY, { lineHeightFactor: 1.5 });

            // 5. MOBILE (Increased Font: 14 and Bold)
            currentY += (toAddr.length * 0.18) + 0.3;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(14);
            doc.text(`MOB: ${selectedTo.mobile || ""}`, 0.3, currentY);

            // 6. FIXED FOOTER (FROM SECTION)
            const footerY = 2.8;

            doc.setLineWidth(0.005);
            doc.line(0.3, footerY, 3.7, footerY);

            // Firm name and address are wrapped to 2.1in rather than the full
            // 3.4in, so the sender block stops short of the QR in the footer's
            // right-hand corner. That means a long firm name or address can no
            // longer just run wider - it wraps, and enough wraps would push
            // this block off the bottom of a 4in sticker. So step the type
            // down a notch at a time until the block fits, instead of letting
            // it overflow the label.
            const FROM_WRAP = 2.1;
            const FOOTER_BOTTOM = 3.9;
            const lineStep = (pt: number) => (pt / 72) * 1.08;
            const typeSteps = [
                { name: 12, addr: 9, mob: 11 },
                { name: 11, addr: 8, mob: 10 },
                { name: 10, addr: 7, mob: 9 },
                { name: 9, addr: 6.5, mob: 8 },
            ];

            let chosen = typeSteps[typeSteps.length - 1];
            let fromName: string[] = [];
            let fromAddr: string[] = [];
            for (const step of typeSteps) {
                doc.setFont("helvetica", "bold");
                doc.setFontSize(step.name);
                const nameLines = doc.splitTextToSize(selectedFrom.firmName.toUpperCase(), FROM_WRAP);
                doc.setFont("helvetica", "normal");
                doc.setFontSize(step.addr);
                const addrLines = doc.splitTextToSize(fromExtra.address.toUpperCase(), FROM_WRAP);

                chosen = step;
                fromName = nameLines;
                fromAddr = addrLines;

                const mobY = footerY + 0.22 + 0.18
                    + nameLines.length * lineStep(step.name)
                    + addrLines.length * lineStep(step.addr) + 0.1;
                if (mobY <= FOOTER_BOTTOM) break;
            }

            // Even at the smallest type a pathologically long firm name plus
            // address can still outrun the footer. Clamp the SENDER address to
            // the lines that fit: of everything on a shipping label it is the
            // least load-bearing text (the parcel is delivered by the
            // recipient block, and the mobile below still identifies us), and
            // losing its tail beats running off the bottom of the sticker.
            const addrTop = footerY + 0.22 + 0.18 + fromName.length * lineStep(chosen.name);
            const addrRoom = FOOTER_BOTTOM - addrTop - 0.1;
            const maxAddrLines = Math.max(1, Math.floor(addrRoom / lineStep(chosen.addr)));
            fromAddr = fromAddr.slice(0, maxAddrLines);

            let fromTextY = footerY + 0.22;

            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.text("FROM:", 0.3, fromTextY);

            fromTextY += 0.18;
            doc.setFontSize(chosen.name);
            doc.text(fromName, 0.3, fromTextY);

            fromTextY += fromName.length * lineStep(chosen.name);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(chosen.addr);
            doc.text(fromAddr, 0.3, fromTextY, { lineHeightFactor: 1.25 });

            fromTextY += fromAddr.length * lineStep(chosen.addr) + 0.1;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(chosen.mob); // Slightly larger for sender mobile too
            doc.text(`MOB: ${fromExtra.mobile}`, 0.3, fromTextY);

            // 7. DISPATCH QR - scan this on the Dispatch Scanner page to
            // record the parcel going out. Right side of the footer, beside
            // the sender block, which the narrower address wrap above keeps
            // out of this corner.
            //
            // Was 1.1in square starting at y=2.85 - its bottom edge landed at
            // 3.95, just 0.05in from the page's own 4.0in bottom edge. Most
            // printers won't mark that close to an edge, so that bottom strip
            // of the QR was likely being clipped outright - not shrunk, GONE -
            // which breaks a QR far worse than a slightly smaller code would.
            // Shrunk to 0.95in so a 0.2in bottom margin survives.
            doc.addImage(qrDataUrl, "PNG", 2.75, 2.85, 0.95, 0.95);
        }
        // Open the label straight into the browser's print dialog instead of
        // downloading a file the user then has to find and open themselves.
        doc.autoPrint();
        window.open(doc.output("bloburl") as unknown as string, "_blank");
    };

    return (
        <BlockGuard
            permission="printLabels"
            fallback={
                <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
                    <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
                    <Link
                        href="/dashboard"
                        className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg hover:bg-slate-800 transition-all"
                    >
                        Go to Dashboard
                    </Link>
                </div>
            }
        >
            <div className="p-10 max-w-3xl mx-auto bg-gray-50 min-h-screen">
            <div className="bg-white p-8 rounded-xl shadow-md border border-gray-200">
                <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-800">
                            <FiPrinter className="text-blue-600" /> Dispatch Label Generator
                        </h1>
                        <p className="text-xs text-gray-500 mt-1">
                            Label print karne se kuch save nahi hota - parcel par sticker lagane ke baad QR scan karo, tabhi dispatch record banega.
                        </p>
                    </div>
                    <Link
                        href="/dashboard/dispatch-scan"
                        className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap transition"
                    >
                        <FiCamera /> Scan Parcel
                    </Link>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    {/* FROM COMPANY */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-600 mb-2">Sender (From)</label>
                        <input
                            type="text"
                            list="from-company-options"
                            placeholder="Search company..."
                            value={fromSearch}
                            onChange={(e) => {
                                const val = e.target.value;
                                setFromSearch(val);
                                const match = companies.find((c: any) => c.firmName === val);
                                setSelectedFrom(match || null);
                            }}
                            className="w-full border-2 border-gray-100 p-3 rounded-lg focus:border-blue-500 outline-none transition"
                        />
                        <datalist id="from-company-options">
                            {companies.map((c: any) => (
                                <option key={c._id} value={c.firmName} />
                            ))}
                        </datalist>
                    </div>

                    {/* TO DESTINATION */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-600 mb-2">Recipient (To)</label>
                        <input
                            type="text"
                            list="to-destination-options"
                            placeholder="Search institute/buyer..."
                            value={toSearch}
                            onChange={(e) => {
                                const val = e.target.value;
                                setToSearch(val);
                                const match = vendors.find((v: any) => (v.instituteName || v.buyerName) === val);
                                setSelectedTo(match || null);
                            }}
                            className="w-full border-2 border-gray-100 p-3 rounded-lg focus:border-blue-500 outline-none transition"
                        />
                        <datalist id="to-destination-options">
                            {vendors.map((v: any) => (
                                <option key={v._id} value={v.instituteName || v.buyerName} />
                            ))}
                        </datalist>
                    </div>

                </div>

                {/* LABEL SIZE */}
                <div className="mb-8">
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Sticker Size</label>
                    <div className="flex gap-4">
                        <button
                            onClick={() => setLabelSize("4x4")}
                            className={`flex-1 py-3 border-2 rounded-lg font-medium transition ${labelSize === "4x4" ? "bg-blue-600 border-blue-600 text-white shadow-md" : "bg-white border-gray-100 text-gray-500"}`}
                        >
                            4 x 4 Square
                        </button>
                        <button
                            onClick={() => setLabelSize("3.5x6")}
                            className={`flex-1 py-3 border-2 rounded-lg font-medium transition ${labelSize === "3.5x6" ? "bg-blue-600 border-blue-600 text-white shadow-md" : "bg-white border-gray-100 text-gray-500"}`}
                        >
                            3.5 x 6 Vertical
                        </button>
                    </div>
                </div>

                {/* ACTION BUTTON */}
                <button
                    onClick={handlePrint}
                    disabled={printing}
                    className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl font-bold text-lg shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    <FiPrinter /> {printing ? "PREPARING..." : "PRINT SHIPPING LABEL"}
                </button>
            </div>

            {/* DISPATCH HISTORY - parcels that were actually SCANNED out
                (printed-but-never-scanned labels deliberately appear nowhere),
                searchable, with a link to each one's public receipt page. */}
            <div className="bg-white p-8 rounded-xl shadow-md border border-gray-200 mt-8">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                    <h2 className="text-lg font-bold text-gray-800">Dispatch History</h2>
                    <div className="relative w-full sm:w-72">
                        <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                        <input
                            type="text"
                            placeholder="Search recipient / firm / transporter..."
                            value={historySearch}
                            onChange={(e) => setHistorySearch(e.target.value)}
                            className="w-full border-2 border-gray-100 py-2 pl-9 pr-3 rounded-lg text-sm focus:border-blue-500 outline-none transition"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                                <th className="py-2 pr-3">Dispatch Date</th>
                                <th className="py-2 pr-3">From</th>
                                <th className="py-2 pr-3">To</th>
                                <th className="py-2 pr-3">Transporter</th>
                                <th className="py-2 pr-3">Scanned By</th>
                                <th className="py-2 pr-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {loadingHistory ? (
                                <tr><td colSpan={6} className="py-6 text-center text-gray-400">Loading...</td></tr>
                            ) : history.length === 0 ? (
                                <tr><td colSpan={6} className="py-6 text-center text-gray-400">No parcels scanned out yet.</td></tr>
                            ) : (
                                history.map((h) => (
                                    <tr key={h._id} className="hover:bg-gray-50">
                                        <td className="py-2.5 pr-3 whitespace-nowrap text-gray-500">
                                            {/* createdAt fallback is only for rows left over from the
                                                earlier design that saved at print time; drop it once
                                                those are cleared out. */}
                                            {new Date(h.scannedAt || h.createdAt || "").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                                        </td>
                                        <td className="py-2.5 pr-3 text-gray-600">{h.fromFirmName}</td>
                                        <td className="py-2.5 pr-3 font-semibold text-gray-800">{h.toInstituteName || h.toBuyerName}</td>
                                        <td className="py-2.5 pr-3 text-gray-600">{h.transporterName}</td>
                                        <td className="py-2.5 pr-3 text-gray-500">{h.scannedBy || "-"}</td>
                                        <td className="py-2.5 pr-3">
                                            <Link
                                                href={`/dispatch?id=${h._id}`}
                                                target="_blank"
                                                className="text-blue-600 hover:underline flex items-center gap-1 whitespace-nowrap"
                                            >
                                                View <FiExternalLink size={12} />
                                            </Link>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            </div>
        </BlockGuard>
    );
}