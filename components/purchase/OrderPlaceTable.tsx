"use client";
import { useState, useMemo } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  FiDownload,
  FiPackage,
  FiX,
  FiCheck,
  FiCheckCircle,
  FiXCircle
} from "react-icons/fi";

interface PurchaseOrder {
  _id: string;
  orderNumber?: string;
  itemName: string;
  sku?: string;
  category?: string;
  orderedAt?: string;
  createdAt: string;
  prQty: number;
  orderQty: number;
  unit: string;
  rate: number;
  vendor: string;
  remark?: string;
}

interface OrderPlaceTableProps {
  data: PurchaseOrder[];
  onRefresh: () => void;
  onCancel: (req: PurchaseOrder) => void;
}

export default function OrderPlaceTable({ data, onRefresh, onCancel }: OrderPlaceTableProps) {
  const [selectedRequest, setSelectedRequest] = useState<PurchaseOrder | null>(null);
  const [receivedQty, setReceivedQty] = useState<number>(0);
  const [isSaving, setIsSaving] = useState(false);
  const [damageQty, setDamageQty] = useState(0);
  const [moveRemainingTo, setMoveRemainingTo] = useState("Order Place");
  

  // Filter States
  const [filterDate, setFilterDate] = useState("");
  const [filterItem, setFilterItem] = useState("");
  const [filterVendor, setFilterVendor] = useState("");

  const filteredData = useMemo(() => {
    if (!Array.isArray(data)) return [];
    return data.filter((item) => {
      const dateStr = new Date(item.orderedAt || item.createdAt).toLocaleDateString('en-CA');
      const dateMatch = filterDate ? dateStr.includes(filterDate) : true;
      const itemMatch = item.itemName.toLowerCase().includes(filterItem.toLowerCase()) ||
        (item.sku && item.sku.toLowerCase().includes(filterItem.toLowerCase()));
      const vendorMatch = (item.vendor || "").toLowerCase().includes(filterVendor.toLowerCase());
      return dateMatch && itemMatch && vendorMatch;
    });
  }, [data, filterDate, filterItem, filterVendor]);

  const downloadPDF = () => {
    const doc = new jsPDF('landscape');
    const pageWidth = doc.internal.pageSize.getWidth();

    // Get Full Vendor Name
    const firstItem = filteredData[0];
    const fullVendorName = filterVendor && firstItem ? firstItem.vendor : "All Vendors";
    const reportTitle = `${fullVendorName.toUpperCase()} - PURCHASE ORDER REPORT`;
    const fileNameDate = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');

    // 1. Center Align Top Title & Generated Date (Prose remains centered)
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text(reportTitle, pageWidth / 2, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text(`Generated on: ${new Date().toLocaleDateString('en-GB')}`, pageWidth / 2, 28, { align: 'center' });

    // 2. Table Data
    const tableColumn = ["Order ID", "Date", "SKU", "Item Name", "Category", "Order Qty", "Vendor"];
    const tableRows = filteredData.map(item => [
      item.orderNumber || "N/A",
      new Date(item.orderedAt || item.createdAt).toLocaleDateString('en-GB'),
      item.sku || "N/A",
      item.itemName,
      item.category || "General",
      `${item.orderQty} ${item.unit}`,
      item.vendor
    ]);

    // 3. Render Table - All Left Aligned
    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 35,
      theme: 'grid',
      headStyles: {
        fillColor: [30, 41, 59],
        fontSize: 11,
        halign: 'left' // Change from 'center' to 'left' for Headers
      },
      styles: {
        fontSize: 10,
        cellPadding: 4,
        halign: 'left' // Body data already left-aligned
      },
      // Ensuring no overrides interfere
      columnStyles: {
        0: { halign: 'left' },
        5: { halign: 'left' }
      }
    });

    const cleanFileName = fullVendorName.replace(/[<>:"/\\|?*]/g, '');
    doc.save(`${cleanFileName}_${fileNameDate}.pdf`);
  };

  const handleSaveToStock = async () => {
  if (!selectedRequest) return;
  
  setIsSaving(true);
  try {
    const res = await fetch("/api/received-purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalOrderId: selectedRequest._id,
        orderNumber: selectedRequest.orderNumber,
        itemName: selectedRequest.itemName,
        sku: selectedRequest.sku,
        category: selectedRequest.category,
        orderQty: selectedRequest.orderQty,
        receivedQty: Number(receivedQty),
        damageQty: Number(damageQty),
        unit: selectedRequest.unit,
        vendor: selectedRequest.vendor,
        rate: selectedRequest.rate,
        moveRemainingTo: moveRemainingTo, // From Radio Button
      }),
    });

    if (res.ok) {
      alert("✅ Processed: Stock updated and remaining moved.");
      setSelectedRequest(null);
      setDamageQty(0);
      onRefresh(); // Refresh current tab
    }
  } catch (err) {
    console.error(err);
    alert("❌ Error processing receipt");
  } finally {
    setIsSaving(false);
  }
};


  const handleCancelClick = async (req: any) => {
    if (!confirm(`Move ${req.itemName} back to Purchase Request?`)) return;

    try {
      const res = await fetch(`/api/purchase-requests/${req._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending" }),
      });

      if (res.ok) {
        alert("✅ Success: Moved back to Purchase Requests.");
        onRefresh(); // This triggers fetchTabData() in your Page.tsx
      } else {
        const err = await res.json();
        alert(`❌ Error: ${err.error}`);
      }
    } catch (err) {
      alert("❌ Network error occurred.");
    }
  };


  return (
    <div className="flex flex-col gap-4">
      {/* Filter Bar */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[140px]">
          <label className="text-[10px] font-black uppercase text-slate-400 mb-1.5 block">Date</label>
          <input type="date" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold" onChange={(e) => setFilterDate(e.target.value)} />
        </div>
        <div className="flex-2 min-w-[220px]">
          <label className="text-[10px] font-black uppercase text-slate-400 mb-1.5 block">Search Item / SKU</label>
          <input type="text" placeholder="Search..." className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold" onChange={(e) => setFilterItem(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="text-[10px] font-black uppercase text-slate-400 mb-1.5 block">Vendor</label>
          <input type="text" placeholder="Vendor..." className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold" onChange={(e) => setFilterVendor(e.target.value)} />
        </div>
        <button onClick={downloadPDF} disabled={filteredData.length === 0} className="bg-blue-600 text-white px-6 py-3 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 hover:bg-blue-700 disabled:bg-slate-300">
          <FiDownload size={16} /> Export PDF
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50/80 border-b border-slate-100">
            <tr>
              <th className="py-3 px-4 text-[10px] font-black uppercase text-slate-400">Order ID</th>
              <th className="py-3 px-4 text-[10px] font-black uppercase text-slate-400">Date</th>
              <th className="py-3 px-4 text-[10px] font-black uppercase text-slate-400">Item Details</th>
              <th className="py-3 px-4 text-[10px] font-black uppercase text-slate-400">Category</th>
              <th className="py-3 px-4 text-[10px] font-black uppercase text-slate-400 text-center">PR Qty</th>
              <th className="py-3 px-4 text-[10px] font-black uppercase text-slate-400 text-center">Order Qty</th>
              <th className="py-3 px-4 text-[10px] font-black uppercase text-slate-400">Rate</th>
              <th className="py-3 px-4 text-[10px] font-black uppercase text-slate-400">Vendor</th>
              <th className="py-3 px-4 text-[10px] font-black uppercase text-slate-400 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.map((req) => (
              <tr key={req._id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                <td className="py-3 px-4 font-black text-blue-600 text-xs">{req.orderNumber || "---"}</td>
                <td className="py-3 px-4 text-[11px] font-bold text-slate-500">
                  {new Date(req.orderedAt || req.createdAt).toLocaleDateString('en-GB')}
                </td>
                <td className="py-3 px-4">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-blue-500 mb-1">{req.sku || "N/A"}</span>
                    <span className="font-black text-slate-800 text-xs uppercase">{req.itemName}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase">{req.category || "General"}</td>
                <td className="py-3 px-4 text-center text-xs font-bold text-slate-500">{req.prQty}</td>
                <td className="py-3 px-4 text-center font-black text-slate-800 text-xs">{req.orderQty}</td>
                <td className="py-3 px-4 font-bold text-blue-600 text-xs">₹{req.rate}</td>
                <td className="py-3 px-4 text-[10px] font-black text-slate-600 uppercase">{req.vendor}</td>
                <td className="py-3 px-4">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setSelectedRequest(req); setReceivedQty(req.orderQty); }} className="p-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-600 hover:text-white transition-all">
                      <FiCheckCircle size={14} />
                    </button>
                    <button
                      onClick={() => handleCancelClick(req)}
                      className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-600 hover:text-white transition-all"
                    >
                      <FiXCircle size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Received Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-slate-900 p-5 text-white flex justify-between items-center">
              <h3 className="font-black uppercase text-[10px] tracking-widest">Receive Stock (Order: {selectedRequest.orderNumber})</h3>
              <button onClick={() => setSelectedRequest(null)}><FiX size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Item: {selectedRequest.sku}</span>
                <h4 className="font-black text-slate-800 uppercase text-sm">{selectedRequest.itemName}</h4>
                <p className="text-[10px] text-blue-600 font-bold">Ordered Qty: {selectedRequest.orderQty}</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase">Rec. Qty</label>
                  <input type="number" value={receivedQty} onChange={(e) => setReceivedQty(Number(e.target.value))} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-black text-center" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase">Damage</label>
                  <input type="number" value={damageQty} onChange={(e) => setDamageQty(Number(e.target.value))} className="w-full p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl font-black text-center" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase text-blue-500">Remaining</label>
                  <div className="w-full p-3 bg-blue-50 border border-blue-100 rounded-xl font-black text-center text-blue-600">
                    {Math.max(0, selectedRequest.orderQty - receivedQty - damageQty)}
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <p className="text-[9px] font-black text-slate-500 mb-2 uppercase">Where to move remaining Qty?</p>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="moveRemaining" value="Purchase Request" checked={moveRemainingTo === "Purchase Request"} onChange={(e) => setMoveRemainingTo(e.target.value)} className="w-4 h-4 accent-slate-900" />
                    <span className="text-[10px] font-black uppercase">Purchase Req</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="moveRemaining" value="Order Place" checked={moveRemainingTo === "Order Place"} onChange={(e) => setMoveRemainingTo(e.target.value)} className="w-4 h-4 accent-slate-900" />
                    <span className="text-[10px] font-black uppercase">Order Place</span>
                  </label>
                </div>
              </div>

              <button onClick={handleSaveToStock} disabled={isSaving} className="w-full bg-blue-600 text-white font-black uppercase py-4 rounded-xl text-[10px] hover:bg-blue-700 transition-all shadow-lg shadow-blue-100">
                {isSaving ? "Processing..." : "Confirm & Update Stock"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}