"use client";
import { useState, useMemo, useEffect } from "react";
import { FiSave, FiSearch, FiCalendar, FiUser, FiTag, FiDownload } from "react-icons/fi";

interface ReceivedPurchaseTableProps {
  data: any[];
  onRefresh: () => void;
  loading?: boolean;
  // Add these value props:
  filterDate: string;
  filterItem: string;
  filterVendor: string;
  filterCategory: string;
  // Keep your setter props:
  setFilterDate: (val: string) => void;
  setFilterItem: (val: string) => void;
  setFilterVendor: (val: string) => void;
  setFilterCategory: (val: string) => void;
}

export default function ReceivedPurchaseTable({
  data,
  onRefresh,
  loading,
  filterDate,      // Add this
  filterItem,      // Add this
  filterVendor,    // Add this
  filterCategory,
  setFilterDate,
  setFilterItem,
  setFilterVendor,
  setFilterCategory
}: ReceivedPurchaseTableProps) {
  const [editState, setEditState] = useState<Record<string, any>>({});
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [hasRatePermission, setHasRatePermission] = useState<boolean>(false);
  const [displayLimit, setDisplayLimit] = useState(50);

  useEffect(() => {
    setDisplayLimit(50);
  }, [filterDate, filterItem, filterVendor, filterCategory]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const session = localStorage.getItem("oms_user");
    const userData = session ? JSON.parse(session) : null;
    const usernameLower = userData?.username?.trim().toLowerCase();
    const isSuperAdmin = ["chintan", "hitesh"].includes(usernameLower) || userData?.permissions?.boss === true;
    
    // Inverted logic: show rate if user is a super admin OR does NOT have receivePurchaseRate checked
    const hasPerm = isSuperAdmin || userData?.permissions?.receivePurchaseRate !== true;
    setHasRatePermission(hasPerm);
  }, []);

  // Filter States


  // 1. Filter Logic
  const filteredData = useMemo(() => {
    if (!Array.isArray(data)) return [];

    // First, filter the data
    const filtered = data.filter((item) => {

      const dateStr = new Date(item.receivedAt).toLocaleDateString('en-CA'); // yyyy-mm-dd
      const dateMatch = filterDate ? dateStr.includes(filterDate) : true;
      const itemMatch = item.itemName?.toLowerCase().includes(filterItem.toLowerCase()) ||
        item.sku?.toLowerCase().includes(filterItem.toLowerCase());
      const vendorMatch = (item.vendor || "").toLowerCase().includes(filterVendor.toLowerCase());
      const catMatch = (item.category || "").toLowerCase().includes(filterCategory.toLowerCase());

      return dateMatch && itemMatch && vendorMatch && catMatch;
    });

    // Second, SORT to show NEWEST data first
    return filtered.sort((a, b) => {
      return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
    });
  }, [data, filterDate, filterItem, filterVendor, filterCategory]);

  const visibleData = useMemo(() => {
    return filteredData.slice(0, displayLimit);
  }, [filteredData, displayLimit]);

  const handleLocalChange = (id: string, field: string, value: any) => {
    setEditState(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }));
  };

  const handleUpdate = async (item: any) => {
    const updates = editState[item._id];
    setIsUpdating(item._id);
    const newQty = updates.receivedQty ?? item.receivedQty;

    const session = localStorage.getItem("oms_user");
    const userData = session ? JSON.parse(session) : null;
    const Login_user = userData?.username || "Unknown User";

    try {
      const res = await fetch("/api/received-purchase", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item._id,
          receivedQty: newQty,
          rate: updates.rate ?? item.rate,
          userName: Login_user,
        }),
      });

      if (res.ok) {
        alert("✅ Update saved!");
        setEditState(prev => {
          const newState = { ...prev };
          delete newState[item._id];
          return newState;
        });
        onRefresh();
      }
    } catch (err) {
      alert("❌ Update failed");
    } finally {
      setIsUpdating(null);
    }
  };


  return (
    <div className="flex flex-col gap-4">
      {/* 2. Filter Bar */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="relative">
          <label className="text-[10px] font-black uppercase text-slate-400 mb-1.5 block px-1">Date</label>
          <div className="relative">
            <FiCalendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="date"
              className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
              onChange={(e) => setFilterDate(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-black uppercase text-slate-400 mb-1.5 block px-1">Item / SKU</label>
          <div className="relative">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text"
              placeholder="Search item..."
              className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
              onChange={(e) => setFilterItem(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-black uppercase text-slate-400 mb-1.5 block px-1">Vendor</label>
          <div className="relative">
            <FiUser className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Vendor name..." className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500" onChange={(e) => setFilterVendor(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-black uppercase text-slate-400 mb-1.5 block px-1">Category</label>
          <div className="relative">
            <FiTag className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Category..." className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500" onChange={(e) => setFilterCategory(e.target.value)} />
          </div>
        </div>
      </div>

      {/* 3. Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50/80 border-b border-slate-100">
              <tr>
                <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Order ID</th>
                <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Date</th>
                <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Item Details</th>
                <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Category</th>
                <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Vendor</th>
                <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400 text-center">Rec. Qty</th>
                <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400 text-center">Rate</th>
                <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Total</th>
                <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-20 text-center font-bold text-slate-400 animate-pulse uppercase tracking-widest text-xs">
                    Loading Received Purchase Data...
                  </td>
                </tr>
              ) : visibleData.map((item) => (
                <tr key={item._id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-4 px-6 font-black text-blue-600 text-xs">{item.orderNumber || "---"}</td>
                  <td className="py-4 px-6 text-[11px] font-bold text-slate-500">
                    {new Date(item.receivedAt).toLocaleDateString('en-GB')}
                  </td>
                  <td className="py-4 px-6">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-blue-500 mb-0.5">{item.sku || "N/A"}</span>
                      <span className="font-black text-slate-800 text-xs uppercase">{item.itemName}</span>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-[10px] font-bold text-slate-400 uppercase">{item.category || "General"}</td>
                  <td className="py-4 px-6 text-[10px] font-black text-slate-600 uppercase">{item.vendor}</td>

                  <td className="py-4 px-6 text-center">
                    <input
                      type="number"
                      className="w-16 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1.5 text-xs font-black text-blue-700 text-center outline-none focus:ring-2 focus:ring-blue-500"
                      value={editState[item._id]?.receivedQty ?? item.receivedQty}
                      onChange={(e) => handleLocalChange(item._id, 'receivedQty', e.target.value)}
                    />
                  </td>

                  <td className="py-4 px-6 text-center">
                    {hasRatePermission ? (
                      <div className="flex items-center justify-center gap-1">
                        <span className="text-xs font-bold text-slate-400">₹</span>
                        <input
                          type="number"
                          className="w-20 bg-green-50 border border-green-100 rounded-lg px-2 py-1.5 text-xs font-black text-green-700 text-center outline-none focus:ring-2 focus:ring-green-500"
                          value={editState[item._id]?.rate ?? item.rate}
                          onChange={(e) => handleLocalChange(item._id, 'rate', e.target.value)}
                        />
                      </div>
                    ) : (
                      <span className="text-slate-400 font-bold text-xs select-none">NA</span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-xs font-black text-slate-700">
                    {hasRatePermission ? (
                      (() => {
                        const stateRow = editState ? (editState as Record<string, any>)[item._id] : null;
                        const currentQty = Number(stateRow?.receivedQty ?? item.receivedQty ?? 0);
                        const currentRate = Number(stateRow?.rate ?? item.rate ?? 0);
                        const totalAmount = currentQty * currentRate;

                        return `₹${totalAmount.toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}`;
                      })()
                    ) : (
                      <span className="text-slate-400 font-bold text-xs select-none">NA</span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-right">
                    {editState[item._id] && (
                      <button
                        onClick={() => handleUpdate(item)}
                        disabled={isUpdating === item._id}
                        className="p-2.5 bg-slate-900 text-white rounded-xl hover:bg-black transition-all shadow-md active:scale-95 disabled:opacity-50"
                      >
                        <FiSave size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredData.length > 0 && !loading && (
                <tr className="bg-slate-100/80 font-black text-slate-800 border-t-2 border-slate-300 shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]">
                  {/* Span across first 5 columns to line up with the Total section */}
                  <td colSpan={5} className="py-4 px-6 text-xs font-black uppercase text-slate-500 tracking-wider text-left">
                    Grand Total
                  </td>

                  {/* Sum of all Quantities */}
                  <td className="py-4 px-6 text-center text-xs text-blue-700">
                    {filteredData.reduce((sum, item) => {
                      const stateRow = editState ? (editState as Record<string, any>)[item._id] : null;
                      const currentQty = Number(stateRow?.receivedQty ?? item.receivedQty ?? 0);
                      return sum + currentQty;
                    }, 0)}
                  </td>

                  {/* Leave rate column empty */}
                  <td className="py-4 px-6"></td>

                  {/* Sum of all calculated item totals */}
                  <td className="py-4 px-6 text-xs text-green-700 font-black">
                    {hasRatePermission ? (
                      (() => {
                        const grandTotalAmount = filteredData.reduce((sum, item) => {
                          const stateRow = editState ? (editState as Record<string, any>)[item._id] : null;
                          const currentQty = Number(stateRow?.receivedQty ?? item.receivedQty ?? 0);
                          const currentRate = Number(stateRow?.rate ?? item.rate ?? 0);
                          return sum + (currentQty * currentRate);
                        }, 0);

                        return `₹${grandTotalAmount.toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}`;
                      })()
                    ) : (
                      <span className="text-slate-400 font-bold text-xs select-none">NA</span>
                    )}
                  </td>

                  {/* Leave action column empty */}
                  <td className="py-4 px-6"></td>
                </tr>
              )}
            </tbody>
          </table>

          {filteredData.length > displayLimit && (
            <div className="flex justify-center p-6 bg-slate-50 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDisplayLimit((prev) => prev + 50)}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
              >
                Load More Items ({filteredData.length - displayLimit} Remaining)
              </button>
            </div>
          )}
          {filteredData.length === 0 && !loading && (
            <div className="p-10 text-center text-slate-400 font-bold uppercase text-[10px] tracking-widest">
              No matching records found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}