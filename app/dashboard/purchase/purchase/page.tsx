"use client";
import { useState, useEffect, useMemo } from "react";
import { FiDownload, FiPlus } from "react-icons/fi";
import PurchaseRequestModal from "@/components/PurchaseRequestModal";
import ReceivedQtyModal from "@/components/ReceivedQtyModal";
import PurchaseRequestTable from "@/components/purchase/PurchaseRequestTable";
import OrderPlaceTable from "@/components/purchase/OrderPlaceTable";
import ReceivedPurchaseTable from "@/components/purchase/ReceivedPurchaseTable";
import PurchaseReturnPage from "@/components/purchase/PurchaseReturnPage";
import * as XLSX from 'xlsx';
import BlockGuard from "@/components/BlockGuard";
import Link from "next/link";

// 1. Define the Interface to fix "red line" property errors
// interface StockItem {
//   _id: string;
//   sku: string;
//   itemName: string;
//   lastUpdated?: string | Date;
//   quantity: number;
//   vendor?: string;
//   category?: string;
//   unit?: string;
//   rate?: number;
// }
interface StockItem {
  _id: string;
  itemId?: { $oid: string } | string; // Handle MongoDB object format
  sku: string;
  itemName: string;
  lastUpdated?: string | Date;
  totalQty: number; // Changed from quantity to totalQty
  vendor?: string;
  category?: string;
  unit?: string;
  rate?: number;
}

export default function PurchaseLogisticsPage() {
  // 2. Properly typed State variables
  const [prRequests, setPrRequests] = useState<any[]>([]);
  const [orderRequests, setOrderRequests] = useState<any[]>([]);
  const [receivedRequests, setReceivedRequests] = useState<any[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]); // Typed as StockItem array
  const [vendors, setVendors] = useState<any[]>([]);

  const [activeTab, setActiveTab] = useState("Purchase Request");
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isReceivedModalOpen, setIsReceivedModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
  const [editData, setEditData] = useState<Record<string, any>>({});

  const [filterDate, setFilterDate] = useState("");
  const [filterItem, setFilterItem] = useState("");
  const [filterVendor, setFilterVendor] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  const fetchVendors = async () => {
    try {
      const res = await fetch("/api/vendors");
      const data = await res.json();
      setVendors(data);
    } catch (err) {
      console.error("Vendor fetch error:", err);
    }
  };


  // 3. Unified Fetch Logic with "Newest First" sorting
  const fetchTabData = async () => {
    try {
      // Always refresh stock to keep quantities accurate
      const stockRes = await fetch('/api/stock');
      const stockData = await stockRes.json();
      setStock(stockData);

      let endpoint = "";
      if (activeTab === "Purchase Request") endpoint = "/api/purchase/purchase-request";
      else if (activeTab === "Order Place") endpoint = "/api/purchase/order-place";
      else if (activeTab === "Received Purchase") endpoint = "/api/purchase/purchase-received";

      if (!endpoint) return;

      const res = await fetch(endpoint);
      const data = await res.json();

      // Sort table data by creation date (Newest First)
      const safeData = Array.isArray(data)
        ? data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : [];

      if (activeTab === "Purchase Request") setPrRequests(safeData);
      else if (activeTab === "Order Place") setOrderRequests(safeData);
      else if (activeTab === "Received Purchase") setReceivedRequests(safeData);

    } catch (err) {
      console.error("Fetch error:", err);
    }
  };

  // 4. Memoized Sorting for Stock (Fixes the red line error)
  const sortedStock = useMemo(() => {
  if (!stock || !Array.isArray(stock)) return [];
  
  return stock.map(item => ({
    ...item,
    // Add a normalized name for internal matching
    normalizedName: (item.itemName || "").replace(/\s+/g, ' ').trim().toUpperCase()
  })).sort((a, b) => {
    const dateA = new Date(a.lastUpdated || '1970-01-01').getTime();
    const dateB = new Date(b.lastUpdated || '1970-01-01').getTime();
    return dateB - dateA;
  });
}, [stock]);

  useEffect(() => {
    fetchVendors();
    fetchTabData();
  }, [activeTab]);

  const handleInputChange = (id: string, field: string, value: any) => {
    setEditData((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleSaveOrder = async (req: any) => {
    const updates = editData[req._id] || {};
    const selectedVendor = updates.vendor || "";
    if (!selectedVendor) {
      alert("⚠️ Please select a vendor before saving.");
      return;
    }

    const payload = {
      originalId: req._id,
      itemName: req.itemName,
      prQty: req.prQty,
      orderQty: updates.orderQty || req.prQty,
      unit: req.unit,
      remark: req.remark,
      sku: req.sku || "N/A",
      category: req.category || "General",
      location: req.location || "---",
      rate: updates.rate || 0,
      vendor: selectedVendor,
    };

    try {
      const res = await fetch(`/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const result = await res.json();
        alert(`✅ Order Created: ${result.orderNumber}`);
        setEditData((prev) => {
          const next = { ...prev };
          delete next[req._id];
          return next;
        });
        fetchTabData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCancel = async (req: any) => {
    if (!confirm("Are you sure you want to revert this?")) return;
    try {
      const res = await fetch(`/api/orders/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: req._id }),
      });
      if (res.ok) {
        alert("✅ Reverted successfully");
        fetchTabData();
      }
    } catch (err) { console.error(err); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this request?")) return;
    try {
      const res = await fetch(`/api/purchase-requests/${id}`, { method: "DELETE" });
      if (res.ok) fetchTabData();
    } catch (err) { alert("Delete failed"); }
  };

  // inside PurchaseLogisticsPage component
  const filteredReceivedData = useMemo(() => {
    return receivedRequests.filter((item) => {
      const matchesItem = !filterItem ||
        item.itemName?.toLowerCase().includes(filterItem.toLowerCase()) ||
        item.sku?.toLowerCase().includes(filterItem.toLowerCase());

      const matchesVendor = !filterVendor ||
        item.vendor?.toLowerCase().includes(filterVendor.toLowerCase());

      const matchesCategory = !filterCategory ||
        item.category?.toLowerCase().includes(filterCategory.toLowerCase());

      const matchesDate = !filterDate ||
        (item.createdAt && new Date(item.createdAt).toISOString().split('T')[0] === filterDate);

      return matchesItem && matchesVendor && matchesCategory && matchesDate;
    });
  }, [receivedRequests, filterItem, filterVendor, filterCategory, filterDate]);

  // Update handleExportExcel to use filteredReceivedData
  const handleExportExcel = () => {
    if (filteredReceivedData.length === 0) return alert("No data to export");

    const reportData = filteredReceivedData.map(item => ({
      "Order ID": item.orderNo || item.orderNumber || "N/A",
      "Date": new Date(item.createdAt).toLocaleDateString(),
      "Item Name": item.itemName,
      "SKU": item.sku || "N/A",
      "Vendor": item.vendor,
      "Category": item.category || "General",
      "Rec Qty": item.receivedQty || 0,
      "Rate": item.rate || 0,
      "Total": (item.rate || 0) * (item.receivedQty || 0)
    }));

    const ws = XLSX.utils.json_to_sheet(reportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Filtered Received Orders");
    XLSX.writeFile(wb, "Received_Orders_Report.xlsx");
  };
  return (
    <BlockGuard
      permission="purchase"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link
            href="/dashboard"
            className="text-sm bg-slate-900 text-white px-4 mt-4 py-2 rounded-lg hover:bg-slate-800 transition-all"
          >
            Go to Dashboard
          </Link>
        </div>
      }
    >
      <div className="pt-4 px-4 max-w-7xl mx-auto min-h-screen bg-slate-50/50">
        <div className="flex flex-col lg:flex-row lg:justify-between mb-8 gap-4 items-start lg:items-center">
          {/* Tabs Section - Stacks on Mobile, Rows on Desktop */}
          
          <div className="w-full lg:w-auto bg-white p-1.5 rounded-2xl border border-slate-200">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:flex gap-1.5">
              {["Purchase Request", "Order Place", "Received Purchase", "Purchase Return"].map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={`px-2 lg:px-6 py-2.5 rounded-xl text-[9px] lg:text-[10px] font-black uppercase transition-all text-center ${activeTab === t
                    ? "bg-slate-900 text-white shadow-md"
                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                    }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons Container */}
          <div className="flex items-center gap-2 w-full lg:w-auto">
            <button
              onClick={handleExportExcel}
              className="flex-1 lg:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-4 lg:px-6 py-3 rounded-2xl font-black text-[10px] flex items-center justify-center gap-2 tracking-widest shadow-xl shadow-emerald-100 transition-all active:scale-95 uppercase"
            >
              <FiDownload className="text-sm shrink-0" />
              <span className="truncate">Excel Report</span>
            </button>

            {activeTab === "Purchase Request" && (
              <button
                onClick={() => setIsRequestModalOpen(true)}
                className="flex-1 lg:flex-none bg-blue-600 text-white px-4 lg:px-8 py-3 rounded-2xl font-black text-[10px] flex items-center justify-center gap-2 tracking-widest shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95 uppercase"
              >
                <FiPlus className="shrink-0" />
                <span className="truncate">New Request</span>
              </button>
            )}
          </div>
        </div>

        <div className="mt-4">
          {activeTab === "Purchase Request" && (
            <PurchaseRequestTable
              data={prRequests}
              onInputChange={handleInputChange}
              vendors={vendors}
              stockData={sortedStock}
              onSave={handleSaveOrder}
              onDelete={handleDelete}
            />
          )}

          {activeTab === "Order Place" && (
            <OrderPlaceTable
              data={orderRequests}
              onRefresh={fetchTabData}
              onCancel={handleCancel}
            />
          )}

          {activeTab === "Received Purchase" && (
            <ReceivedPurchaseTable
              data={filteredReceivedData}
              onRefresh={fetchTabData}

              // Pass the state values:
              filterDate={filterDate}
              filterItem={filterItem}
              filterVendor={filterVendor}
              filterCategory={filterCategory}
              // Pass the setters:
              setFilterDate={setFilterDate}
              setFilterItem={setFilterItem}
              setFilterVendor={setFilterVendor}
              setFilterCategory={setFilterCategory}
            />
          )}

          {activeTab === "Purchase Return" && <PurchaseReturnPage />}
        </div>

        {/* <PurchaseRequestModal
          isOpen={isRequestModalOpen}
          stockData={sortedStock} // <--- Add this
          onClose={() => {
            setIsRequestModalOpen(false);
            fetchTabData(); // or fetchRequests() depending on your function name
          }}
        /> */}
        <PurchaseRequestModal
  isOpen={isRequestModalOpen}
  stockData={sortedStock} 
  onClose={() => {
    setIsRequestModalOpen(false);
    fetchTabData(); // Refresh both stock and requests
  }}
/>

        {selectedRequest && (
          <ReceivedQtyModal
            isOpen={isReceivedModalOpen}
            request={selectedRequest}
            onClose={() => {
              setIsReceivedModalOpen(false);
              setSelectedRequest(null);
              fetchTabData();
            }}
          />
        )}

      </div >
    </BlockGuard>
  );
}