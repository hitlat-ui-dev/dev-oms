"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { FiSearch, FiExternalLink, FiTruck, FiRotateCcw } from "react-icons/fi";

const TABS = [
  "ALL", "TO CHECK", "HISAB",
  "READY TO SHIP", "DELIVERY", "CANCELL ORDER", "RETURN ORDER"
];

export default function OrdersListPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [transporters, setTransporters] = useState<any[]>([]);
  const [deliveryData, setDeliveryData] = useState({
    transportName: "",
    transportRemark: ""
  });
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnQty, setReturnQty] = useState(0);

  // 1. Move fetchOrders outside of useEffect so other functions can call it
  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/seller-orders");
      const data = await res.json();
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch error", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Fetch Transporters
  useEffect(() => {
    const loadTransporters = async () => {
      try {
        const res = await fetch("/api/transporters");
        const data = await res.json();
        setTransporters(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to load transporters", err);
      }
    };
    loadTransporters();
  }, []);

  const handlePaymentToggle = async (orderId: string, currentStatus: boolean) => {
    try {
      setOrders(prev => prev.map(o => o._id === orderId ? { ...o, isPaid: !currentStatus } : o));
      const res = await fetch(`/api/seller-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaid: !currentStatus }),
      });
      if (!res.ok) throw new Error("Failed to save");
    } catch (err) {
      alert("Payment status failed to save. Reverting...");
      fetchOrders(); 
    }
  };

  const handleStatusUpdate = async (orderId: string, newStatus: string) => {
    const orderToUpdate = orders.find(o => o._id === orderId);
    if (!orderToUpdate) return;

    if (newStatus === "DELIVERY") {
      setSelectedOrderId(orderId);
      setShowDeliveryModal(true);
      return;
    }
    if (newStatus === "RETURN ORDER") {
      setSelectedOrderId(orderId);
      setReturnQty(orderToUpdate.reQty);
      setShowReturnModal(true);
      return;
    }

    if (!window.confirm(`Change status to ${newStatus}?`)) return;

    try {
      const res = await fetch(`/api/seller-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          activeTab: activeTab,
          itemName: orderToUpdate.itemName,
          reQty: orderToUpdate.reQty,
        }),
      });
      if (res.ok) fetchOrders();
    } catch (err) {
      alert("Error updating status.");
      fetchOrders();
    }
  };

  const submitDelivery = async () => {
    if (!deliveryData.transportName) return alert("Please select a transporter");
    try {
      const res = await fetch(`/api/seller-orders/${selectedOrderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "DELIVERY",
          activeTab: "READY TO SHIP",
          transportName: deliveryData.transportName,
          transportRemark: deliveryData.transportRemark
        }),
      });

      if (res.ok) {
        setShowDeliveryModal(false);
        setDeliveryData({ transportName: "", transportRemark: "" });
        setSelectedOrderId(null);
        fetchOrders();
      }
    } catch (err) {
      alert("Error saving delivery details");
    }
  };
  
  const submitReturn = async () => {
    const orderToUpdate = orders.find(o => o._id === selectedOrderId);
    if (!orderToUpdate) return;

    // Safety check: Don't allow returning more than available
    if (returnQty > orderToUpdate.reQty) {
        return alert("Return quantity cannot exceed order quantity");
    }

    const isPartial = returnQty < orderToUpdate.reQty;

    try {
      const res = await fetch(`/api/seller-orders/${selectedOrderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "RETURN ORDER",
          activeTab: "READY TO SHIP", // Tab context for stock logic
          reQty: returnQty, 
          isPartial: isPartial,
          itemName: orderToUpdate.itemName
        }),
      });

      if (res.ok) {
        setShowReturnModal(false);
        setSelectedOrderId(null);
        fetchOrders(); 
        alert(isPartial ? `Split Successful: ${returnQty} returned, ${orderToUpdate.reQty - returnQty} remains delivered.` : "Order fully returned.");
      }
    } catch (err) {
      alert("Error processing return");
    }
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesStatus = activeTab === "ALL" || order.status === activeTab;
      const matchesSearch =
        order.orderNo?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.instituteName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.contractNo?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesStatus && matchesSearch;
    });
  }, [orders, activeTab, searchQuery]);

  if (loading) return <div className="p-12 text-center font-black animate-pulse text-slate-400 uppercase">Loading Data...</div>;

  return (
    <div className="p-4 max-w-full mx-auto space-y-6">
      {/* Search and Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-800">Orders Management</h1>
          <p className="text-blue-600 text-[10px] font-black tracking-widest uppercase">Sales Control Panel</p>
        </div>
        <div className="relative">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 size-4" />
          <input
            type="text"
            placeholder="Search details..."
            className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl w-full md:w-80 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-sm"
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto gap-1 no-scrollbar border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-3 rounded-t-xl text-[12px] font-black tracking-wide transition-all whitespace-nowrap ${activeTab === tab ? "bg-slate-900 text-white shadow-md" : "bg-slate-50 text-slate-500 hover:bg-slate-200"}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-full">
          <thead className="bg-slate-100 border-b border-slate-200">
            <tr className="divide-x divide-slate-200">
              {activeTab === "ALL" && <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600 w-10 text-center">Paid</th>}
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600">Order No</th>
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600">Date</th>
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600">Firm / Buyer</th>
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600">Cat.</th>
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600">Item Details</th>
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600">Contract</th>
              <th className="px-3 py-3 text-[11px] font-bold uppercase text-slate-600 text-center">PR - OP Qty</th>
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600 text-center">O-Qty</th>
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600 text-right">Rate</th>
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600 text-right">Total</th>
              {activeTab === "DELIVERY" && <th className="px-3 py-3 text-[12px] font-bold uppercase text-emerald-600">Delivery Info</th>}
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-[11px]">
            {filteredOrders.map((order) => (
              <tr key={order._id} className="hover:bg-slate-50 transition-colors divide-x divide-slate-100">
                {activeTab === "ALL" && (
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-emerald-600 cursor-pointer" checked={order.isPaid || false} onChange={() => handlePaymentToggle(order._id, order.isPaid)} />
                  </td>
                )}
                <td className="px-3 py-2 font-black text-blue-600">{order.orderNo}</td>
                <td className="px-3 py-2 font-bold whitespace-nowrap text-slate-500">{order.contractDate || "N/A"}</td>
                <td className="px-3 py-2 max-w-[160px]">
                  <div className="font-black text-slate-800 uppercase truncate leading-tight">{order.firmCode}</div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase truncate">{order.instituteName}</div>
                </td>
                <td className="px-3 py-2 font-black text-blue-800/60 uppercase">{order.category}</td>
                <td className="px-3 py-2 max-w-52">
                  <div className="font-bold text-slate-900 truncate">{order.itemName}</div>
                  <div className="text-[9px] text-slate-400">SKU: {order.itemId?.slice(-6)}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <span className="truncate max-w-24 font-medium text-slate-600">{order.contractNo}</span>
                    {order.contractUrl && <a href={order.contractUrl} target="_blank" className="text-blue-500"><FiExternalLink size={11} /></a>}
                  </div>
                </td>
                <td className="px-3 py-2 text-center border-x border-slate-50 font-black text-slate-800 text-[12px]">
                  {order.prQty} — {order.opQty}
                </td>
                <td className="px-3 py-2 text-center leading-tight">
                  <div className="font-black text-[12px]">{order.reQty}</div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase">{order.unit}</div>
                </td>
                <td className="px-3 py-2 font-bold text-slate-500 text-right">₹{order.rate}</td>
                <td className="px-3 py-2 font-black text-slate-900 text-right">₹{order.totalAmount?.toLocaleString()}</td>
                
                {activeTab === "DELIVERY" && (
                  <td className="px-3 py-2 min-w-[180px]">
                    <div className="flex flex-col gap-0.5">
                      <div className="font-black text-slate-800 uppercase flex items-center gap-1.5">
                        <FiTruck className="text-emerald-500" size={12} />
                        {order.transportName || "No Transport"}
                      </div>
                      <div className="text-[10px] font-bold text-slate-400 italic truncate max-w-[200px]">
                        {order.transportRemark ? `Note: ${order.transportRemark}` : "No remark"}
                      </div>
                    </div>
                  </td>
                )}

                <td className="px-3 py-2 text-center">
                  {["TO CHECK", "READY TO SHIP", "DELIVERY"].includes(activeTab) ? (
                    <select
                      className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border cursor-pointer outline-none ${getStatusColor(order.status)}`}
                      value={order.status}
                      onChange={(e) => handleStatusUpdate(order._id, e.target.value)}
                    >
                      {activeTab === "TO CHECK" && (
                        <>
                          <option value="TO CHECK">TO CHECK</option>
                          <option value="HISAB">HISAB</option>
                          <option value="READY TO SHIP">READY TO SHIP</option>
                          <option value="CANCELL ORDER">CANCELL</option>
                        </>
                      )}
                      {activeTab === "READY TO SHIP" && (
                        <>
                          <option value="READY TO SHIP">READY TO SHIP</option>
                          <option value="DELIVERY">DELIVERY</option>
                          <option value="HISAB">HISAB</option>
                          <option value="CANCELL ORDER">CANCEL</option>
                        </>
                      )}
                      {activeTab === "DELIVERY" && (
                        <>
                          <option value="DELIVERY">DELIVERY</option>
                          <option value="RETURN ORDER">RETURN ORDER</option>
                        </>
                      )}
                    </select>
                  ) : (
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${getStatusColor(order.status)}`}>
                      {order.status || "PENDING"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* --- MODALS --- */}
      {showDeliveryModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl border border-slate-100">
             <div className="flex items-center gap-3 mb-6">
               <div className="p-3 bg-emerald-500 text-white rounded-2xl">
                 <FiTruck size={24} />
               </div>
               <h2 className="text-xl font-black uppercase tracking-tight">Delivery Details</h2>
             </div>
             <div className="space-y-5">
               <div className="space-y-1">
                 <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Select Transport</label>
                 <select
                   className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold outline-none focus:ring-2 focus:ring-emerald-500"
                   value={deliveryData.transportName}
                   onChange={(e) => setDeliveryData({ ...deliveryData, transportName: e.target.value })}
                 >
                   <option value="">Choose Transporter...</option>
                   {transporters.map(t => <option key={t._id} value={t.name}>{t.name}</option>)}
                 </select>
               </div>
               <div className="space-y-1">
                 <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Remark</label>
                 <textarea
                   className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold outline-none min-h-[100px] resize-none"
                   placeholder="LR No, Vehicle No, etc."
                   value={deliveryData.transportRemark}
                   onChange={(e) => setDeliveryData({ ...deliveryData, transportRemark: e.target.value })}
                 />
               </div>
               <div className="flex gap-3 pt-2">
                 <button onClick={() => setShowDeliveryModal(false)} className="flex-1 p-4 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase text-[10px]">Cancel</button>
                 <button onClick={submitDelivery} className="flex-1 p-4 bg-emerald-500 text-white rounded-2xl font-black uppercase text-[10px]">Confirm</button>
               </div>
             </div>
          </div>
        </div>
      )}

      {showReturnModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl border border-rose-100">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-rose-500 text-white rounded-2xl"><FiRotateCcw size={24} /></div>
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight text-slate-800">Return Order</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Stock Restoration</p>
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-2xl mb-6 flex justify-between items-center">
              <span className="text-[10px] font-black text-slate-400 uppercase">Current Order Qty</span>
              <span className="font-black text-slate-800 text-lg">
                {orders.find(o => o._id === selectedOrderId)?.reQty}
              </span>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Qty to Return</label>
                <input
                  type="number"
                  className="w-full p-4 bg-slate-100 border-none rounded-2xl font-black text-xl text-center outline-none focus:ring-2 focus:ring-rose-500"
                  value={returnQty}
                  onChange={(e) => setReturnQty(Number(e.target.value))}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowReturnModal(false)} className="flex-1 p-4 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase text-[10px]">Cancel</button>
                <button onClick={submitReturn} className="flex-1 p-4 bg-rose-500 text-white rounded-2xl font-black uppercase text-[10px]">Confirm Return</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getStatusColor(status: string) {
  switch (status) {
    case "DELIVERY": return "bg-emerald-50 text-emerald-700 border-emerald-100";
    case "CANCELL ORDER": return "bg-rose-50 text-rose-700 border-rose-100";
    case "READY TO SHIP": return "bg-blue-50 text-blue-700 border-blue-100";
    case "TO CHECK": return "bg-amber-50 text-amber-700 border-amber-100";
    case "RETURN ORDER": return "bg-purple-50 text-purple-700 border-purple-100";
    default: return "bg-slate-50 text-slate-600 border-slate-100";
  }
}