"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  FiArrowLeft,
  FiCheckCircle,
  FiTrash2,
  FiExternalLink,
  FiRefreshCw,
  FiSearch,
  FiBriefcase,
  FiInfo,
  FiClock,
  FiCheck,
  FiAlertCircle
} from "react-icons/fi";

interface RawGeMOrder {
  _id: string;
  contractNo: string;
  contractDate: string;
  contractUrl: string;
  buyerDesignation?: string;
  department?: string;
  location?: string;
  instituteName: string;
  itemName: string;
  qty: number;
  rate: number;
  totalAmount: number;
  status: string;
  createdAt: string;
}

export default function FetchGeMOrdersPage() {
  const router = useRouter();

  const [rawOrders, setRawOrders] = useState<RawGeMOrder[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Verification modal state
  const [selectedOrder, setSelectedOrder] = useState<RawGeMOrder | null>(null);
  const [selectedFirmCode, setSelectedFirmCode] = useState("");
  const [customItemName, setCustomItemName] = useState("");
  const [customQty, setCustomQty] = useState<number>(1);
  const [customRate, setCustomRate] = useState<number>(0);
  const [customRemark, setCustomRemark] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    fetchRawOrders();
    fetchCompanies();
  }, []);

  const fetchRawOrders = async () => {
    try {
      setRefreshing(true);
      const res = await fetch(`/api/gem-orders?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setRawOrders(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Error fetching raw GeM orders:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchCompanies = async () => {
    try {
      const res = await fetch(`/api/companies?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setCompanies(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Error fetching companies:", err);
    }
  };

  const handleDelete = async (id: string, contractNo: string) => {
    if (!confirm(`Are you sure you want to delete/reject order ${contractNo}?`)) return;

    try {
      const res = await fetch(`/api/gem-orders/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRawOrders(prev => prev.filter(o => o._id !== id));
      } else {
        const err = await res.json();
        alert(err.error || "Failed to delete order");
      }
    } catch (err) {
      alert("Error deleting order");
    }
  };

  const openVerifyModal = (order: RawGeMOrder) => {
    setSelectedOrder(order);
    setSelectedFirmCode(companies.length > 0 ? companies[0].firmCode : "GeM");
    setCustomItemName(order.itemName);
    setCustomQty(order.qty || 1);
    setCustomRate(order.rate || 0);
    setCustomRemark(order.location ? `Location: ${order.location}` : "Fetched from GeM");
  };

  const handleVerifySubmit = async () => {
    if (!selectedOrder) return;
    setVerifying(true);

    try {
      const res = await fetch(`/api/gem-orders/${selectedOrder._id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firmCode: selectedFirmCode,
          itemName: customItemName,
          qty: customQty,
          rate: customRate,
          totalAmount: customQty * customRate,
          remark: customRemark,
        })
      });

      if (res.ok) {
        const result = await res.json();
        alert(`✅ Order Verified Successfully! Saved to Main Orders as ${result.orderNo}`);
        setRawOrders(prev => prev.filter(o => o._id !== selectedOrder._id));
        setSelectedOrder(null);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to verify order");
      }
    } catch (err) {
      alert("System error verifying order");
    } finally {
      setVerifying(false);
    }
  };

  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return rawOrders;
    const q = searchQuery.toLowerCase().trim();
    return rawOrders.filter(o =>
      (o.contractNo || "").toLowerCase().includes(q) ||
      (o.instituteName || "").toLowerCase().includes(q) ||
      (o.itemName || "").toLowerCase().includes(q) ||
      (o.location || "").toLowerCase().includes(q)
    );
  }, [rawOrders, searchQuery]);

  return (
    <div className="p-4 md:p-10 max-w-7xl mx-auto font-sans">
      {/* Top Header Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <button
          onClick={() => router.push("/dashboard/orders")}
          className="flex items-center gap-2 text-slate-500 hover:text-blue-600 font-bold text-xs uppercase tracking-widest transition-colors"
        >
          <FiArrowLeft size={16} /> Back to Orders Dashboard
        </button>
        <button
          onClick={fetchRawOrders}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
        >
          <FiRefreshCw className={refreshing ? "animate-spin" : ""} size={14} /> Refresh
        </button>
      </div>

      {/* Page Title */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white p-6 md:p-8 rounded-2xl shadow-xl mb-8">
        <div className="flex items-center gap-3 text-amber-400 text-xs font-black uppercase tracking-[0.25em] mb-2">
          <FiClock size={16} /> Extension Staging Verification
        </div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Fetched GeM Orders</h1>
        <p className="text-slate-300 text-xs font-medium mt-2 max-w-2xl">
          Review, verify and approve raw orders fetched from the GeM Chrome Extension before moving them into your Main Sales Orders.
        </p>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="relative flex-1 min-w-[260px]">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contract no, buyer, or item name..."
            className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-medium"
          />
        </div>
        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          Total Pending: <span className="text-blue-600 font-black">{filteredOrders.length}</span>
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <FiRefreshCw className="animate-spin text-blue-600 mx-auto mb-3" size={28} />
          <p className="text-slate-500 font-bold text-sm">Loading fetched orders...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <FiAlertCircle className="text-slate-400 mx-auto mb-3" size={36} />
          <h3 className="text-lg font-black text-slate-700 uppercase">No Pending GeM Orders</h3>
          <p className="text-slate-400 text-xs mt-1">
            Fetch orders using the Chrome Extension on GeM marketplace to verify them here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredOrders.map((order) => (
            <div
              key={order._id}
              className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-6"
            >
              {/* Main Content */}
              <div className="flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="bg-amber-100 text-amber-800 text-[11px] font-black tracking-wider px-3 py-1 rounded-full uppercase">
                    UNVERIFIED
                  </span>
                  <a
                    href={order.contractUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 font-black text-sm uppercase tracking-tight group"
                  >
                    Contract: {order.contractNo}
                    {order.contractUrl && <FiExternalLink size={14} className="group-hover:translate-x-0.5 transition-transform" />}
                  </a>
                  {order.contractDate && (
                    <span className="text-slate-400 text-xs font-bold">
                      • Date: {order.contractDate}
                    </span>
                  )}
                </div>

                <div>
                  <div className="text-slate-800 font-black text-base uppercase tracking-tight">
                    {order.itemName}
                  </div>
                  <div className="text-slate-500 text-xs font-medium mt-1">
                    <strong className="text-slate-700 font-bold">Buyer:</strong> {order.instituteName}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-6 text-xs text-slate-600 font-semibold pt-1">
                  <div>
                    Qty: <span className="font-bold text-slate-900">{order.qty} nos</span>
                  </div>
                  <div>
                    Rate: <span className="font-bold text-slate-900">₹{order.rate}</span>
                  </div>
                  <div>
                    Total Value: <span className="font-bold text-emerald-700 text-sm">₹{order.totalAmount}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6">
                <button
                  onClick={() => openVerifyModal(order)}
                  className="flex-1 md:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider shadow-sm hover:shadow-md transition-all"
                >
                  <FiCheckCircle size={16} /> Verify & Move
                </button>
                <button
                  onClick={() => handleDelete(order._id, order.contractNo)}
                  className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                  title="Reject Order"
                >
                  <FiTrash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Verification Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden border border-slate-100">
            <div className="bg-slate-900 text-white p-6">
              <h3 className="text-lg font-black uppercase tracking-tight">Verify GeM Order</h3>
              <p className="text-slate-400 text-xs font-medium mt-1">
                Contract: {selectedOrder.contractNo}
              </p>
            </div>

            <div className="p-6 space-y-4 text-xs font-medium">
              <div>
                <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1">
                  Assign Firm (Company)
                </label>
                <select
                  value={selectedFirmCode}
                  onChange={(e) => setSelectedFirmCode(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold focus:outline-none focus:border-blue-500"
                >
                  {companies.length > 0 ? (
                    companies.map(c => (
                      <option key={c._id} value={c.firmCode}>{c.firmName} ({c.firmCode})</option>
                    ))
                  ) : (
                    <option value="GeM">GeM Marketplace</option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1">
                  Item Name
                </label>
                <input
                  type="text"
                  value={customItemName}
                  onChange={(e) => setCustomItemName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-semibold focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1">
                    Quantity
                  </label>
                  <input
                    type="number"
                    value={customQty}
                    onChange={(e) => setCustomQty(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-semibold focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1">
                    Rate (₹)
                  </label>
                  <input
                    type="number"
                    value={customRate}
                    onChange={(e) => setCustomRate(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-semibold focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1">
                  Total Amount (₹)
                </label>
                <div className="p-2.5 bg-emerald-50 text-emerald-800 font-black rounded-lg text-sm">
                  ₹{customQty * customRate}
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1">
                  Remark / Note
                </label>
                <input
                  type="text"
                  value={customRemark}
                  onChange={(e) => setCustomRemark(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                onClick={() => setSelectedOrder(null)}
                disabled={verifying}
                className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold uppercase text-xs tracking-wider transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleVerifySubmit}
                disabled={verifying}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold uppercase text-xs tracking-wider transition-all shadow-md"
              >
                {verifying ? "Verifying..." : "Approve & Move Order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
