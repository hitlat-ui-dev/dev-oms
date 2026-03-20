"use client";
import { useState, useEffect, useMemo } from "react";
import { FiPlus } from "react-icons/fi";
import PurchaseRequestModal from "@/components/PurchaseRequestModal";
import ReceivedQtyModal from "@/components/ReceivedQtyModal";
import PurchaseRequestTable from "@/components/purchase/PurchaseRequestTable";
import OrderPlaceTable from "@/components/purchase/OrderPlaceTable";
import ReceivedPurchaseTable from "@/components/purchase/ReceivedPurchaseTable";
import PurchaseReturnPage from "@/components/purchase/PurchaseReturnPage";

// 1. Define the Interface to fix "red line" property errors
interface StockItem {
  _id: string;
  sku: string;
  itemName: string;
  lastUpdated?: string | Date;
  quantity: number;
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
    return [...stock].sort((a, b) => {
      // Use fallback date string for items missing the lastUpdated field
      const dateA = new Date(a.lastUpdated || '1970-01-01').getTime();
      const dateB = new Date(b.lastUpdated || '1970-01-01').getTime();
      return dateB - dateA; // Descending order
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

  return (
    <div className="pt-4 px-4 max-w-7xl mx-auto min-h-screen bg-slate-50/50">
      <div className="flex justify-between mb-8 items-center">
        <div className="flex gap-2 bg-white p-1.5 rounded-2xl border border-slate-200">
          {["Purchase Request", "Order Place", "Received Purchase", "Purchase Return"].map((t) => (
            <button
              key={t} onClick={() => setActiveTab(t)}
              className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === t ? "bg-slate-900 text-white shadow-md" : "text-slate-400 hover:text-slate-600"
                }`}
            >
              {t}
            </button>
          ))}
        </div>

        {activeTab === "Purchase Request" && (
          <button
            onClick={() => setIsRequestModalOpen(true)}
            className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-black text-[10px] flex items-center gap-2 tracking-widest shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95"
          >
            <FiPlus /> New Request
          </button>
        )}
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
            data={receivedRequests}
            onRefresh={fetchTabData}
          />
        )}

        {activeTab === "Purchase Return" && <PurchaseReturnPage />}
      </div>

      <PurchaseRequestModal
        isOpen={isRequestModalOpen}
        stockData={sortedStock}
        onClose={() => {
          setIsRequestModalOpen(false);
          fetchTabData();
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
    </div>
  );
}