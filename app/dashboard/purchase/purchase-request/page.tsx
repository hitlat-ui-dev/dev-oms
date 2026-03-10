"use client";
import { useState, useEffect } from "react";
import { FiArrowLeft, FiPlus, FiCheckCircle, FiPackage, FiShoppingCart } from "react-icons/fi";
import { useRouter } from "next/navigation";
import PurchaseRequestModal from "@/components/PurchaseRequestModal";
import ReceivedQtyModal from "@/components/ReceivedQtyModal"; // New Modal

export default function ViewPurchaseRequests() {
  const router = useRouter();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Purchase Request");
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  
  // Received Modal State
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [isReceivedModalOpen, setIsReceivedModalOpen] = useState(false);

  const fetchRequests = async () => {
    setLoading(true);
    const res = await fetch("/api/purchase-requests");
    const data = await res.json();
    setRequests(data);
    setLoading(false);
  };

  useEffect(() => { fetchRequests(); }, []);

  // Filter requests based on active tab
  const filteredRequests = requests.filter((req: any) => req.status === activeTab);

  const handleOpenReceivedModal = (req: any) => {
    setSelectedRequest(req);
    setIsReceivedModalOpen(true);
  };

  const tabs = [
    { id: "Purchase Request", icon: <FiPackage />, color: "blue" },
    { id: "Received Purchase", icon: <FiCheckCircle />, color: "green" },
    { id: "Purchase Orders", icon: <FiShoppingCart />, color: "purple" },
  ];

  return (
    <div className="p-4 md:p-12 max-w-7xl mx-auto min-h-screen bg-[#f8fafc]">
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 mb-4 font-bold text-xs uppercase tracking-widest transition-all">
            <FiArrowLeft /> Back to Purchase
          </button>
          <h1 className="text-4xl font-black text-slate-800 uppercase tracking-tight">Inventory Logistics</h1>
          <p className="text-blue-600 text-[10px] font-black tracking-widest uppercase mt-1">Management & Fulfillment Tracking</p>
        </div>
        
        <button 
          onClick={() => setIsRequestModalOpen(true)}
          className="bg-black hover:bg-slate-800 text-white px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center gap-3 shadow-2xl transition-all active:scale-95"
        >
          <FiPlus size={18}/> New Request
        </button>
      </div>

      {/* TAB MENU */}
      <div className="flex gap-2 mb-6 bg-white p-2 rounded-3xl border border-slate-200 shadow-sm w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${
              activeTab === tab.id 
                ? "bg-slate-900 text-white shadow-lg" 
                : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            }`}
          >
            {tab.icon} {tab.id}
          </button>
        ))}
      </div>

      {/* TABLE SECTION */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-400">Item Details</th>
                <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-400">Qty Configuration</th>
                {activeTab === "Received Purchase" && (
                  <th className="p-6 text-[10px] font-black uppercase tracking-widest text-green-500">Received Qty</th>
                )}
                <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredRequests.length > 0 ? filteredRequests.map((req: any) => (
                <tr key={req._id} className="hover:bg-slate-50/30 transition-colors">
                  <td className="p-6">
                    <p className="font-black text-slate-800 uppercase text-sm tracking-tight">{req.itemName}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">{new Date(req.createdAt).toDateString()}</p>
                  </td>
                  <td className="p-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-black text-slate-900">{req.qty}</span>
                      <span className="text-[10px] font-black text-blue-500 uppercase">{req.unit}</span>
                    </div>
                  </td>
                  {activeTab === "Received Purchase" && (
                    <td className="p-6">
                       <span className="text-xl font-black text-green-600">{req.receivedQty || 0}</span>
                    </td>
                  )}
                  <td className="p-6">
                    <span className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest border ${
                      activeTab === "Purchase Request" ? "bg-blue-50 text-blue-600 border-blue-100" :
                      activeTab === "Received Purchase" ? "bg-green-50 text-green-600 border-green-100" :
                      "bg-purple-50 text-purple-600 border-purple-100"
                    }`}>
                      {req.status}
                    </span>
                  </td>
                  <td className="p-6 text-right">
                    {activeTab === "Purchase Request" && (
                      <button 
                        onClick={() => handleOpenReceivedModal(req)}
                        className="bg-slate-900 hover:bg-green-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-tighter transition-all"
                      >
                        Mark Received
                      </button>
                    )}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="p-32 text-center">
                    <div className="flex flex-col items-center gap-4">
                       <div className="p-6 bg-slate-50 rounded-full text-slate-200"><FiPackage size={48}/></div>
                       <p className="text-slate-400 font-black uppercase tracking-[0.2em] text-xs">No {activeTab} Records</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODALS */}
      <PurchaseRequestModal 
        isOpen={isRequestModalOpen} 
        onClose={() => { setIsRequestModalOpen(false); fetchRequests(); }} 
      />

      {selectedRequest && (
        <ReceivedQtyModal 
          isOpen={isReceivedModalOpen}
          request={selectedRequest}
          onClose={() => {
            setIsReceivedModalOpen(false);
            setSelectedRequest(null);
            fetchRequests();
          }}
        />
      )}
    </div>
  );
}