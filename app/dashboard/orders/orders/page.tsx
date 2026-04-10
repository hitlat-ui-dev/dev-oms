"use client";
import { useState, useEffect, useMemo } from "react";
import { FiSearch, FiExternalLink } from "react-icons/fi";


const TABS = [
  "ALL", "RECEIVE ORDER", "TO CHECK", "HISAB", 
  "READY TO SHIP", "DELIVERY", "CANCELL ORDER", "RETURN ORDER"
];

export default function OrdersListPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const res = await fetch("/api/seller-orders");
        const data = await res.json();
        setOrders(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Fetch error", err);
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
  }, []);

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

  if (loading) return <div className="p-12 text-center font-black animate-pulse">LOADING...</div>;

  return (
    <div className="p-4 md:p-8 max-w-full mx-auto space-y-6">
      {/* Header & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight">Orders Management</h1>
          <p className="text-blue-600 text-[10px] font-black tracking-widest uppercase">Sales Control Panel</p>
        </div>
        <div className="relative">
          <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text"
            placeholder="Search details..."
            className="pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl w-full md:w-96 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-sm"
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="flex overflow-x-auto gap-2 no-scrollbar border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-3 rounded-t-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
              activeTab === tab ? "bg-slate-900 text-white shadow-lg" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xl overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 w-12">SR</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400">Date</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400">Firm</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400">Buyer Name</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400">Item Details (SKU/CAT/Stock/Unit)</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400">Contract No</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-center">Qty</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400">Rate</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400">Total</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-center">PR/OP Qty</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400">Remark</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredOrders.map((order, index) => (
              <tr key={order._id} className="hover:bg-slate-50/80 transition-colors text-xs">
                <td className="p-4 font-bold text-slate-400">{order.orderNo}</td>
                <td className="p-4 font-bold whitespace-nowrap">{order.contractDate || "N/A"}</td>
                <td className="p-4 font-black text-blue-600">{order.firmCode}</td>
                <td className="p-4 font-bold uppercase text-slate-700">{order.instituteName}</td>
                
                {/* Item Details Block */}
                <td className="p-4 min-w-60">
                  <div className="font-black text-slate-900">{order.itemName}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <span className="bg-slate-100 text-[9px] px-1.5 py-0.5 rounded border border-slate-200">SKU: {order.itemId?.slice(-6) || "N/A"}</span>
                    <span className="bg-blue-50 text-blue-600 text-[9px] px-1.5 py-0.5 rounded border border-blue-100">{order.category}</span>
                    <span className="bg-amber-50 text-amber-700 text-[9px] px-1.5 py-0.5 rounded border border-amber-100 font-black">STK: {order.availableStock || 0}</span>
                    <span className="bg-slate-100 text-[9px] px-1.5 py-0.5 rounded border border-slate-200 uppercase">{order.unit}</span>
                  </div>
                </td>

                <td className="p-4">
                  {order.contractUrl ? (
                    <a href={order.contractUrl} target="_blank" className="text-blue-600 hover:underline font-bold flex items-center gap-1">
                      {order.contractNo} <FiExternalLink size={12} />
                    </a>
                  ) : <span className="font-bold text-slate-500">{order.contractNo}</span>}
                </td>

                <td className="p-4 font-black text-center text-base">{order.orderQty}</td>
                <td className="p-4 font-bold text-slate-500">₹{order.rate}</td>
                <td className="p-4 font-black text-slate-900">₹{order.totalAmount?.toLocaleString()}</td>
                
                {/* PR/OP Qty Placeholder */}
                <td className="p-4 text-center font-bold text-rose-500">{order.prOpQty || 0}</td>
                
                <td className="p-4 text-slate-400 italic max-w-40 truncate">{order.remark || "—"}</td>
                
                <td className="p-4">
                  <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${getStatusColor(order.status)}`}>
                    {order.status || "RECEIVE ORDER"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredOrders.length === 0 && (
          <div className="p-20 text-center text-slate-400 font-bold uppercase tracking-widest text-sm">
            No matching orders found
          </div>
        )}
      </div>
    </div>
  );
}

function getStatusColor(status: string) {
  switch (status) {
    case "DELIVERY": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "CANCELL ORDER": return "bg-rose-50 text-rose-700 border-rose-200";
    case "READY TO SHIP": return "bg-blue-50 text-blue-700 border-blue-200";
    case "TO CHECK": return "bg-amber-50 text-amber-700 border-amber-200";
    case "RETURN ORDER": return "bg-purple-50 text-purple-700 border-purple-200";
    default: return "bg-slate-50 text-slate-600 border-slate-200";
  }
}