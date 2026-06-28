"use client";
import { useState, useEffect } from "react";
import { FiPrinter } from "react-icons/fi";
import jsPDF from 'jspdf';
import BlockGuard from "@/components/BlockGuard";
import Link from "next/link";

// These details remain fixed based on the firmCode
const FIXED_CONTACTS: Record<string, { address: string; mobile: string }> = {
    "ELIP": {
        address: "TARU ADDRESS LAKHAVU, MALGODAWN ROAD, MEHSANA-2 384002",
        mobile: "+91 82000 93336"
    },
    "SHREEJI": {
        address: "G-45, INDUSTRIAL ESTATE, MEHSANA, GUJARAT - 384001",
        mobile: "+91 00000 00000"
    },
};

export default function PrintLabelsPage() {
    const [companies, setCompanies] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [selectedFrom, setSelectedFrom] = useState<any>(null);
    const [selectedTo, setSelectedTo] = useState<any>(null);
    const [labelSize, setLabelSize] = useState<"4x4" | "3.5x6">("3.5x6");

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

    const handlePrint = () => {
        if (!selectedFrom || !selectedTo) {
            alert("Please select both From and To addresses");
            return;
        }

        const is35x6 = labelSize === "3.5x6";
        const doc = new jsPDF({
            orientation: "portrait",
            unit: "in",
            format: is35x6 ? [3.5, 6] : [4, 4]
        });

        // Get the fixed contact info for the selected firm
        const fromExtra = FIXED_CONTACTS[selectedFrom.firmCode] || { address: "4/22/76,Old malgodawn,near D bhikhabhai office,Mehsana,Gujarat-384002.", mobile: "760 001 6442" };
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

            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.text("FROM:", colFromX, yStartFooter, options);

            colFromX -= 0.22;
            doc.setFontSize(12);
            doc.text(selectedFrom.firmName.toUpperCase(), colFromX, yStartFooter, options);

            colFromX -= 0.2;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
            // Using "Loha" or "High-Grade Metal" in descriptions if applicable for compliance
            const fromAddr = doc.splitTextToSize(fromExtra.address.toUpperCase(), 5.0);
            doc.text(fromAddr, colFromX, yStartFooter, options);

            colFromX -= (fromAddr.length * 0.14) + 0.05;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.text(`MOB: ${fromExtra.mobile}`, colFromX, yStartFooter, options);

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

            let fromTextY = footerY + 0.22;

            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.text("FROM:", 0.3, fromTextY);

            fromTextY += 0.18;
            doc.setFontSize(12);
            doc.text(selectedFrom.firmName.toUpperCase(), 0.3, fromTextY);

            fromTextY += 0.18;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
            const fromAddr = doc.splitTextToSize(fromExtra.address.toUpperCase(), 3.4);
            doc.text(fromAddr, 0.3, fromTextY, { lineHeightFactor: 1.25 });

            fromTextY += (fromAddr.length * 0.13) + 0.1;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11); // Slightly larger for sender mobile too
            doc.text(`MOB: ${fromExtra.mobile}`, 0.3, fromTextY);
        }
        doc.save(`Label_${selectedTo.mobile || 'Order'}.pdf`);
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
                <h1 className="text-2xl font-bold mb-8 flex items-center gap-2 text-gray-800">
                    <FiPrinter className="text-blue-600" /> Dispatch Label Generator
                </h1>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    {/* FROM COMPANY */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-600 mb-2">Sender (From)</label>
                        <select
                            className="w-full border-2 border-gray-100 p-3 rounded-lg focus:border-blue-500 outline-none transition"
                            onChange={(e) => setSelectedFrom(companies.find((c: any) => c.firmCode === e.target.value))}
                        >
                            <option value="">Select Company</option>
                            {companies.map((c: any) => (
                                <option key={c._id} value={c.firmCode}>{c.firmName}</option>
                            ))}
                        </select>
                    </div>

                    {/* TO DESTINATION */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-600 mb-2">Recipient (To)</label>
                        <select
                            className="w-full border-2 border-gray-100 p-3 rounded-lg focus:border-blue-500 outline-none transition"
                            onChange={(e) => setSelectedTo(vendors.find((v: any) => v._id === e.target.value))}
                        >
                            <option value="">Select Destination</option>
                            {vendors.map((v: any) => (
                                <option key={v._id} value={v._id}>
                                    {v.instituteName || v.buyerName}
                                </option>
                            ))}
                        </select>
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
                    className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl font-bold text-lg shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2"
                >
                    <FiPrinter /> DOWNLOAD SHIPPING LABEL
                </button>
            </div>
            </div>
        </BlockGuard>
    );
}