"use client";
import { useState, useEffect } from "react";
import { FiPrinter } from "react-icons/fi";
import jsPDF from 'jspdf';

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
        const fromExtra = FIXED_CONTACTS[selectedFrom.firmCode] || { address: "TARU ADDRESS LAKHAVU, MALGODAWN ROAD, MEHSANA-2 384002", mobile: "00000 00000" };
        const options = { angle: -90 };

        if (is35x6) {
            // --- 3.5 x 6 VERTICAL DESIGN ---
            let colToX = 3.2;
            let yStart = 0.5;

            // 1. SHIP TO SECTION
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.text("SHIP TO:", colToX, yStart, options);

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

            // 2. CENTER DIVIDER
            doc.setLineWidth(0.01);
            doc.line(1.8, 0.5, 1.8, 5.5);

            // 3. FROM SECTION (Dynamic Name + Fixed Details)
            let colFromX = 1.5;

            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.text("FROM:", colFromX, yStart, options);

            colFromX -= 0.25;
            doc.setFontSize(12);
            doc.text(selectedFrom.firmName.toUpperCase(), colFromX, yStart, options);

            colFromX -= 0.2;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
            const fromAddr = doc.splitTextToSize(fromExtra.address.toUpperCase(), 5.0);
            doc.text(fromAddr, colFromX, yStart, options);

            colFromX -= (fromAddr.length * 0.14) + 0.05;
            doc.setFont("helvetica", "bold");
            doc.text(`MOB: ${fromExtra.mobile}`, colFromX, yStart, options);

        } else {
            // --- 4x4 STANDARD DESIGN ---
            let y = 0.5;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.text("SHIP TO:", 0.3, y);
            let currentY = y + 0.3;

            if (selectedTo.buyerName) {
                doc.setFontSize(12);
                doc.setFont("helvetica", "bold");
                const bName = (selectedTo.buyerName).toUpperCase();
                doc.text(bName, 0.3, currentY);
                currentY += 0.25; // Push Institute Name down
            }

            doc.setFontSize(16);
            doc.setFont("helvetica", "bold");
            const instName = (selectedTo.instituteName || "").toUpperCase();
            const instLines = doc.splitTextToSize(instName, 3.4);
            doc.text(instLines, 0.3, currentY);

            currentY += (instLines.length * 0.25) + 0.1;

            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            const toAddr = doc.splitTextToSize((selectedTo.address || "").toUpperCase(), 3.4);
            doc.text(toAddr, 0.3, currentY);

            currentY += (toAddr.length * 0.18) + 0.1;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.text(`MOB: ${selectedTo.mobile || ""}`, 0.3, currentY);

            const separatorY = y + 1.8;

            doc.setLineWidth(0.005);
            doc.line(0.3, separatorY, 3.7, separatorY);
            let fromTextY = separatorY + 0.3;

            doc.setFont("helvetica", "bold");
doc.setFontSize(10);
doc.text("FROM:", 0.3, fromTextY);

            fromTextY += 0.2;
            doc.setFontSize(12);
            doc.text(selectedFrom.firmName.toUpperCase(), 0.3, fromTextY);

            fromTextY += 0.2;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
            const fromAddr = doc.splitTextToSize(fromExtra.address.toUpperCase(), 3.4);
            doc.text(fromAddr, 0.3, fromTextY, { maxWidth: 3.4 });

            // Move the Mobile number down based on the address length
            fromTextY += (fromAddr.length * 0.15) + 0.1;
            doc.setFont("helvetica", "bold");
            doc.text(`MOB: ${fromExtra.mobile}`, 0.3, fromTextY);
        }

        doc.save(`Label_${selectedTo.mobile || 'Order'}.pdf`);
    };

    return (
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
    );
}