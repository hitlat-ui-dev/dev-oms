"use client";
import { useState, useEffect } from "react";
import { FiArrowLeft, FiPlus, FiCheckCircle, FiPackage, FiShoppingCart, FiRefreshCcw } from "react-icons/fi";
import { useRouter } from "next/navigation";
import PurchaseRequestModal from "@/components/PurchaseRequestModal";
import ReceivedQtyModal from "@/components/ReceivedQtyModal";

export default function ViewPurchaseRequests() {
  const router = useRouter();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Purchase Request");
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [isReceivedModalOpen, setIsReceivedModalOpen] = useState(false);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/purchase-requests");
      const data = await res.json();
      setRequests(data);
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRequests(); }, []);

  const filteredRequests = requests.filter((req: any) => req.status === activeTab);

  const tabs = [
    { id: "Purchase Request", icon: <FiPackage />, color: "blue" },
    { id: "Order Place", icon: <FiShoppingCart />, color: "orange" },
    { id: "Received Purchase", icon: <FiCheckCircle />, color: "green" },
    { id: "Purchase Return", icon: <FiRefreshCcw />, color: "red" },
  ];

  return (
    <div className="p-4 md:p-12 max-w-7xl mx-auto min-h-screen bg-[#f8fafc]">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 mb-4 font-bold text-xs uppercase tracking-widest transition-all">
            <FiArrowLeft /> Back
          </button>
          <h1 className="text-4xl font-black text-slate-800 uppercase tracking-tight">Inventory Logistics</h1>
        </div>
        <button onClick={() => setIsRequestModalOpen(true)} className="bg-black hover:bg-slate-800 text-white px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center gap-3 shadow-2xl transition-all active:scale-95">
          <FiPlus size={18}/> New Request
        </button>
      </div>

      {/* TABS */}
      <div className="flex flex-wrap gap-2 mb-6 bg-white p-2 rounded-3xl border border-slate-200 shadow-sm w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${
              activeTab === tab.id ? "bg-slate-900 text-white shadow-lg" : "text-slate-400 hover:bg-slate-50"
            }`}
          >
            {tab.icon} {tab.id}
          </button>
        ))}
      </div>

      {/* TABLE */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-400">Item Details</th>
                <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-400">Requested Qty</th>
                {activeTab === "Received Purchase" && (
                  <th className="p-6 text-[10px] font-black uppercase tracking-widest text-green-500">Received Qty</th>
                )}
                <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredRequests.map((req: any) => (
                <tr key={req._id} className="hover:bg-slate-50/30">
                  <td className="p-6">
                    <p className="font-black text-slate-800 uppercase text-sm">{req.itemName}</p>
                    {req.splitFrom && <span className="text-[9px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-bold">PARTIAL ENTRY</span>}
                  </td>
                  <td className="p-6 font-bold text-slate-900">{req.qty} <span className="text-[10px] text-slate-400">{req.unit}</span></td>
                  {activeTab === "Received Purchase" && (
                    <td className="p-6 text-xl font-black text-green-600">{req.receivedQty || 0}</td>
                  )}
                  <td className="p-6 text-right">
                    {activeTab === "Order Place" && (
                      <button 
                        onClick={() => { setSelectedRequest(req); setIsReceivedModalOpen(true); }}
                        className="bg-green-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase"
                      >
                        Receive Item
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* <PurchaseRequestModal isOpen={isRequestModalOpen} onClose={() => { setIsRequestModalOpen(false); fetchRequests(); }} /> */}
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