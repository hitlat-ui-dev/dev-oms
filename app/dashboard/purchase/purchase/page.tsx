"use client";
import { useState, useEffect } from "react";
import { FiPlus } from "react-icons/fi";
import PurchaseRequestModal from "@/components/PurchaseRequestModal";
import ReceivedQtyModal from "@/components/ReceivedQtyModal";
import PurchaseRequestTable from "@/components/purchase/PurchaseRequestTable";
import OrderPlaceTable from "@/components/purchase/OrderPlaceTable";
import ReceivedPurchaseTable from "@/components/purchase/ReceivedPurchaseTable";
import PurchaseReturnPage from "@/components/purchase/PurchaseReturnPage";

export default function PurchaseLogisticsPage() {
  const [prRequests, setPrRequests] = useState<any[]>([]);
  const [orderRequests, setOrderRequests] = useState<any[]>([]);
  const [receivedRequests, setReceivedRequests] = useState<any[]>([]);

  const [activeTab, setActiveTab] = useState("Purchase Request");
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isReceivedModalOpen, setIsReceivedModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [vendors, setVendors] = useState<any[]>([]);
  const [stock, setStock] = useState([]);

  const fetchVendors = async () => {
    const res = await fetch("/api/vendors");
    const data = await res.json();
    setVendors(data);
  };
  // 1. Fetch Logic (Unified)
  const fetchTabData = async () => {
    try {
      let endpoint = "";
      if (activeTab === "Purchase Request") endpoint = "/api/purchase/purchase-request";
      else if (activeTab === "Order Place") endpoint = "/api/purchase/order-place";
      else if (activeTab === "Received Purchase") endpoint = "/api/purchase/purchase-received";

      // Exit early if it's the Return tab (it handles its own fetching)
      if (!endpoint) return;

      const res = await fetch(endpoint);
      const data = await res.json();

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

  useEffect(() => {
  // Fetch your stock collection from the DB
  const fetchStock = async () => {
    const res = await fetch('/api/stock'); // Example API route
    const data = await res.json();
    setStock(data);
  };
  fetchStock();
}, []);

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

        {/* Hide New Request button if on Received or Return tabs */}
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
            stockData={stock}
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

        {/* FIXED: Changed to match button casing */}
        {activeTab === "Purchase Return" && <PurchaseReturnPage />}
      </div>

      <PurchaseRequestModal
        isOpen={isRequestModalOpen}
        stockData={stock}
        onClose={() => { setIsRequestModalOpen(false); fetchTabData(); }}
      />

      {selectedRequest && (
        <ReceivedQtyModal
          isOpen={isReceivedModalOpen}
          
          request={selectedRequest}
          onClose={() => { setIsReceivedModalOpen(false); setSelectedRequest(null); fetchTabData(); }}
        />
      )}
    </div>
  );
}