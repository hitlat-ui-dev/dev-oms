"use client";
import { useState, useEffect } from "react";
import { FiPlus } from "react-icons/fi";
import PurchaseRequestModal from "@/components/PurchaseRequestModal";
import ReceivedQtyModal from "@/components/ReceivedQtyModal";
import PurchaseRequestTable from "@/components/purchase/PurchaseRequestTable";
import OrderPlaceTable from "@/components/purchase/OrderPlaceTable";
import ReceivedPurchaseTable from "@/components/purchase/ReceivedPurchaseTable";

export default function PurchaseLogisticsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState("Purchase Request");
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isReceivedModalOpen, setIsReceivedModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
  const [editData, setEditData] = useState<Record<string, any>>({});

  const fetchRequests = async () => {
    try {
      const res = await fetch("/api/purchase");
      const data = await res.json();
      setRequests(data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchRequests(); }, []);

  const handleInputChange = (id: string, field: string, value: any) => {
    setEditData((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleSaveOrder = async (req: any) => {
    const updates = editData[req._id] || {};
    const payload = {
      originalId: req._id,
      itemName: req.itemName,
      prQty: req.prQty,
      orderQty: updates.orderQty || req.prQty,
      unit: req.unit,
      remark: req.remark,
      rate: updates.rate || 0,
      vendor: updates.vendor || "",
    };

    if (!payload.vendor) return alert("Please select a vendor");

    try {
      const res = await fetch(`/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        alert("Success!");
        fetchRequests();
      }
    } catch (err) { alert("Failed"); }
  };
// Define handleCancel to revert "Order Place" items back to "Purchase Request"
const handleCancel = async (req: any) => {
  if (!confirm("Are you sure you want to revert this to a Purchase Request?")) return;
  
  try {
    const res = await fetch(`/api/orders/revert`, { // New specific endpoint
      method: "POST", // Using POST to handle moving data between collections
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: req._id }),
    });

    if (res.ok) {
      alert("✅ Reverted to Purchase Request and removed from Orders");
      fetchRequests(); 
    } else {
      const errorData = await res.json();
      alert("❌ Failed to revert: " + errorData.error);
    }
  } catch (err) {
    console.error("Error:", err);
    alert("❌ An error occurred");
  }
};
  const handleDelete = async (id: string) => {
    if (!confirm("Delete?")) return;
    await fetch(`/api/purchase-requests/${id}`, { method: "DELETE" });
    fetchRequests();
  };

  return (
    <div className="p-8 max-w-7xl mx-auto min-h-screen bg-slate-50/50">
      <div className="flex justify-between mb-8 items-center">
        <div className="flex gap-2 bg-white p-1.5 rounded-2xl border border-slate-200">
          {["Purchase Request", "Order Place", "Received Purchase", "Purchase Return"].map((t) => (
            <button 
              key={t} onClick={() => setActiveTab(t)} 
              className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${
                activeTab === t ? "bg-slate-900 text-white shadow-md" : "text-slate-400"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <button onClick={() => setIsRequestModalOpen(true)} className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-black text-[10px] flex items-center gap-2 tracking-widest shadow-xl shadow-blue-200">
          <FiPlus /> New Request
        </button>
      </div>

      {/* RENDER SEPARATE COMPONENTS BASED ON TAB */}
      {activeTab === "Purchase Request" && (
        <PurchaseRequestTable 
          data={requests.filter(r => r.status === "Purchase Request")}
          onInputChange={handleInputChange}
          onSave={handleSaveOrder}
          onDelete={handleDelete}
        />
      )}

      {activeTab === "Order Place" && (
  <OrderPlaceTable 
    // This filter handles the removal automatically once data is re-fetched
    data={requests.filter(r => r.status === "Order Place")} 
    // Ensure you pass the function that re-fetches 'requests' from the DB
    onRefresh={fetchRequests} 
    onCancel={handleCancel}
  />
      )}

      
      {activeTab === "Received Purchase" && (
  <ReceivedPurchaseTable 
    // Filter by the collection or status you use for stock
    data={requests.filter(r => r.status === "Received Purchase")} 
    onRefresh={fetchRequests} 
  />
)}

      {/* Add ReceivedTable and ReturnTable similarly */}

      <PurchaseRequestModal isOpen={isRequestModalOpen} onClose={() => { setIsRequestModalOpen(false); fetchRequests(); }} />
      {selectedRequest && (
        <ReceivedQtyModal 
          isOpen={isReceivedModalOpen} 
          request={selectedRequest} 
          onClose={() => { setIsReceivedModalOpen(false); setSelectedRequest(null); fetchRequests(); }} 
        />
      )}
    </div>
  );
}