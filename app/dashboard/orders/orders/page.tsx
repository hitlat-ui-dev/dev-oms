"use client";
import { useState, useEffect, useMemo } from "react";
import { FiSearch, FiExternalLink } from "react-icons/fi";

const TABS = [
  "ALL", "TO CHECK", "HISAB",
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
console.log(orders);

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
      setOrders(prev => prev.map(o => o._id === orderId ? { ...o, isPaid: currentStatus } : o));
    }
  };
  const handleStatusUpdate = async (orderId: string, newStatus: string) => {
    // 1. Get the specific order data
    const orderToUpdate = orders.find(o => o._id === orderId);

    // 2. Specialized confirmation message for stock deduction
    const confirmMsg = newStatus === "READY TO SHIP"
      ? `⚠️ WARNING: Changing to READY TO SHIP will deduct ${orderToUpdate?.reQty} ${orderToUpdate?.unit} from your Stock Inventory. Proceed?`
      : `Change status to ${newStatus}?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      // 3. Optimistic UI update
      setOrders(prev => prev.map(o => o._id === orderId ? { ...o, status: newStatus } : o));

      // 4. Send update to API
      const res = await fetch(`/api/seller-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          // We pass these just in case the backend needs them for matching
          itemId: orderToUpdate?.itemId,
          itemName: orderToUpdate?.itemName
        }),
      });

      if (!res.ok) throw new Error("Failed to update status");

    } catch (err) {
      alert("Error updating status. Please refresh the page.");
      // Revert UI on error
      const originalOrders = await (await fetch("/api/seller-orders")).json();
      setOrders(originalOrders);
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

  if (loading) return <div className="p-12 text-center font-black animate-pulse text-slate-400">LOADING...</div>;

  return (
    <div className="p-4 max-w-full mx-auto space-y-6">
      {/* Header Section */}
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

      {/* Tabs Menu - FONT SIZE 14px */}
      <div className="flex overflow-x-auto gap-1 no-scrollbar border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-3 rounded-t-xl text-[12px] font-black tracking-wide transition-all whitespace-nowrap ${activeTab === tab
                ? "bg-slate-900 text-white shadow-md"
                : "bg-slate-50 text-slate-500 hover:bg-slate-200"
              }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-full">
          <thead className="bg-slate-100 border-b border-slate-200">
            <tr className="divide-x divide-slate-200">
              {activeTab === "ALL" && (
                <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600 w-10 text-center">Paid</th>
              )}
              {/* HEADERS - FONT SIZE 12px BOLD */}
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
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredOrders.map((order) => (
              /* TABLE BODY - FONT SIZE 11px */
              <tr key={order._id} className="hover:bg-slate-50 transition-colors text-[11px] divide-x divide-slate-100">
                {activeTab === "ALL" && (
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-slate-300 text-emerald-600 cursor-pointer"
                      checked={order.isPaid || false}
                      onChange={() => handlePaymentToggle(order._id, order.isPaid)}
                    />
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
                    {order.contractUrl && (
                      <a href={order.contractUrl} target="_blank" className="text-blue-500">
                        <FiExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-center border-x border-slate-50">
  <div className="flex flex-col items-center">
    <span className="font-black text-slate-800 text-[12px]">
      {order.prQty} — {order.opQty}
    </span>
    <div className="flex gap-2 text-[7px] font-bold text-slate-400 uppercase tracking-tighter">
      <span>PR</span>
      <span>OP</span>
    </div>
  </div>
</td>
                <td className="px-3 py-2 text-center leading-tight">
                  <div className="font-black text-[12px]">{order.reQty}</div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase">{order.unit}</div>
                </td>

                <td className="px-3 py-2 font-bold text-slate-500 text-right">₹{order.rate}</td>
                <td className="px-3 py-2 font-black text-slate-900 text-right">₹{order.totalAmount?.toLocaleString()}</td>

                <td className="px-3 py-2 text-center">
                  {activeTab === "TO CHECK" || activeTab === "READY TO SHIP" ? (
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