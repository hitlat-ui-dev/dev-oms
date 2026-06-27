"use client";
import * as XLSX from "xlsx";
import AddItemModal from "@/components/AddItemModal";
import BlockGuard from "@/components/BlockGuard";
import ItemReportModal from "@/components/ItemReportModal";
import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import { FiMapPin, FiPackage, FiTrendingUp, FiSearch, FiEdit, FiDownload } from "react-icons/fi";


export default function StockPage() {
  const [stock, setStock] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [loginUser, setLoginUser] = useState<string>("");

  useEffect(() => {
    const session = localStorage.getItem("oms_user");
    const userData = session ? JSON.parse(session) : null;
    setLoginUser(userData?.username || "Unknown User");
  }, []);

  const fetchStock = async () => {
    try {
      setReloading(true);
      const res = await fetch("/api/stock");
      const data = await res.json();
      setStock(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load stock");
    } finally {
      setLoading(false);
      setReloading(false);
    }
  };

  useEffect(() => { fetchStock(); }, []);

  const handleEdit = (item: any) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    setEditingItem(null);
    setIsModalOpen(true);
  };

  const [nameSearch, setNameSearch] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [skuSearch, setSkuSearch] = useState("");

  // Filter logic for search
  const filteredStock = useMemo(() => {
    return stock.filter(item => {
      const matchesName = (item.itemName || "").toLowerCase().includes(nameSearch.toLowerCase());
      const matchesCategory = (item.category || "").toLowerCase().includes(categorySearch.toLowerCase());
      const matchesSku = (item.sku || "").toLowerCase().includes(skuSearch.toLowerCase());
      return matchesName && matchesCategory && matchesSku;
    });
  }, [stock, nameSearch, categorySearch, skuSearch]);

  const downloadExcel = () => {
    // Prepare the data for Excel
    const excelData = filteredStock.map((item) => ({
      SKU: item.sku,
      "Item Name": item.itemName,
      Category: item.category,
      Location: item.location,
      "Required Qty": item.reQty || 0,
      "Available Qty": item.totalQty,
      Unit: item.unit,
      "Last Rate": item.rateDisplay,
    }));

    // Create worksheet and workbook
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Stock Report");

    // Download the file
    XLSX.writeFile(workbook, `Stock_Report_${new Date().toLocaleDateString()}.xlsx`);
  };

  return (
    <BlockGuard
      permission="stock"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link
            href="/dashboard"
            className="text-sm bg-slate-900 text-white px-4 mt-4 py-2 rounded-lg hover:bg-slate-800 transition-all"
          >
            Go to Dashboard
          </Link>
        </div>
      }
    >
      <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen bg-slate-50/50">
        {/* Page Header */}
        <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Inventory Master List</h1>
            <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em]">Warehouse Live Stock Balance</p>
          </div>
          <div className="flex items-center gap-3">

            <button
              onClick={downloadExcel}
              className="flex items-center gap-2 bg-emerald-600 text-white px-6 py-4 rounded-2xl font-black uppercase text-xs hover:bg-emerald-700 hover:scale-105 active:scale-95 transition-all shadow-xl shadow-emerald-100"
            >
              <FiDownload size={16} />
              Export Excel
            </button>

            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 bg-blue-600 text-white px-8 py-4 rounded-2xl font-black uppercase text-xs hover:bg-blue-700 hover:scale-105 active:scale-95 transition-all shadow-xl shadow-blue-100"
            >Add New Item</button>
          </div>

        </div>
        <div className="mb-6 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full flex-1">

            {/* SKU Input Search */}
            <div className="relative">
              <input
                type="text"
                placeholder="TYPE SKU..."
                value={skuSearch}
                onChange={(e) => setSkuSearch(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider outline-none focus:bg-white focus:border-blue-500 transition-all placeholder:text-slate-400"
              />
            </div>

            {/* Item Name Input Search */}
            <div className="relative">
              <input
                type="text"
                placeholder="TYPE ITEM NAME..."
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider outline-none focus:bg-white focus:border-blue-500 transition-all placeholder:text-slate-400"
              />
            </div>

            {/* Category Input Search */}
            <div className="relative">
              <input
                type="text"
                placeholder="TYPE CATEGORY..."
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider outline-none focus:bg-white focus:border-blue-500 transition-all placeholder:text-slate-400"
              />
            </div>

          </div>

          {/* Right Status Block & Live Reload Button */}
          <div className="flex items-center gap-3 w-full md:w-auto justify-end border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">

            {/* Live Count Badge */}
            <div className="bg-slate-50 px-4 py-2 rounded-xl border border-slate-200 flex flex-col items-center min-w-[90px]">
              <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider block">MATCHED</span>
              <span className="text-sm font-black text-blue-600 leading-none mt-0.5">{filteredStock.length}</span>
            </div>

            {/* 🔄 Dynamic Reload Button (Wired up to fetchStock without reloading page) */}
            <button
              onClick={fetchStock}
              disabled={reloading}
              type="button"
              title="Refresh Live Stock Data"
              className="bg-slate-900 p-3 rounded-xl text-white hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center shadow-md shadow-slate-200"
            >
              <svg
                className={`w-4 h-4 ${reloading ? 'animate-spin text-blue-400' : 'text-white'}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </button>

          </div>
        </div>
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-900 text-white">
                <tr>
                  <th className="py-5 px-6 text-[10px] font-black uppercase tracking-widest border-r border-slate-800">SKU</th>
                  <th className="py-5 px-6 text-[10px] font-black uppercase tracking-widest border-r border-slate-800">Item Name</th>
                  <th className="py-5 px-6 text-[10px] font-black uppercase tracking-widest border-r border-slate-800">Category</th>
                  <th className="py-5 px-6 text-[10px] font-black uppercase tracking-widest border-r border-slate-800">Location</th>
                  <th className="py-5 px-6 text-[10px] font-black uppercase tracking-widest text-center border-r border-slate-800">Required Qty</th>
                  <th className="py-5 px-6 text-[10px] font-black uppercase tracking-widest text-center border-r border-slate-800">Available Qty</th>
                  <th className="py-5 px-6 text-[10px] font-black uppercase tracking-widest text-center border-r border-slate-800">Last Rate</th>
                  <th className="py-5 px-6 text-[10px] font-black uppercase tracking-widest text-right">Total</th>
                  {/* <th></th> */}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={6} className="py-20 text-center font-bold text-slate-400 animate-pulse">LOADING STOCK DATA...</td></tr>
                ) : filteredStock.map((item, idx) => {
                  const rateNumber = parseFloat(String(item.rateDisplay || item.rate || 0).replace(/[^0-9.-]+/g, "")) || 0;
                  const rowTotalValue = (item.totalQty || 0) * rateNumber;
                  return (
                    <tr key={idx} className="hover:bg-blue-50/30 transition-all group">
                      <td className="py-4 px-6 uppercase font-bold text-xs text-blue-600">{item.sku}</td>

                      <td className="py-4 px-6 border-r border-slate-50 cursor-pointer" onClick={() => setSelectedSku(item.sku)}>
                        <span className="font-black text-slate-800 text-sm uppercase flex items-center gap-2">
                          <FiPackage className="text-slate-400 group-hover:text-blue-500 transition-colors" />
                          {item.itemName}
                        </span>
                      </td>

                      <td className="py-4 px-6 border-r border-slate-50">
                        <span className="px-3 py-1 bg-slate-100 rounded-full text-slate-500 font-black text-[9px] uppercase">
                          {item.category}
                        </span>
                      </td>

                      <td className="py-4 px-6 border-r border-slate-50">
                        <span className="flex items-center gap-1.5 text-slate-500 font-bold text-xs uppercase">
                          <FiMapPin size={12} className={item.location !== "---" ? "text-red-400" : "text-slate-300"} />
                          {item.location}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center border-r border-slate-50 bg-slate-50/50">
                        <div className="flex flex-col items-center">
                          <span className="text-sm font-black text-blue-800">
                            {item.reQty?.toLocaleString() || 0}
                          </span>
                          <span className="text-[8px] font-black text-slate-400 uppercase">Total Req Qty</span>
                        </div>
                      </td>

                      <td className="py-4 px-6 text-center border-r border-slate-50">
                        <div className="flex flex-col items-center">
                          <span className={`text-sm font-black leading-none ${item.totalQty < 10 ? 'text-red-600' : 'text-slate-900'}`}>
                            {item.totalQty.toLocaleString()}
                          </span>
                          <span className="text-[9px] font-black text-blue-500 uppercase mt-1">
                            {item.unit}
                          </span>
                        </div>
                      </td>

                      {loginUser === "Chintan" ? (
                        <>
                          {/* Show rate to Chintan */}
                          <td className="py-4 px-6 text-right border-r border-slate-50">
                            <span className="text-xs font-black text-slate-600 italic">
                              {item.rateDisplay || item.rate || 0}
                            </span>
                          </td>
                          {/* Show row total to Chintan */}
                          <td className="py-4 px-6 text-right bg-blue-50/10">
                            <span className="text-xs font-black text-slate-900">
                              ₹{rowTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </td>
                        </>
                      ) : (
                        <>
                          {/* Show NA to other users */}
                          <td className="py-4 px-6 text-right border-r border-slate-50 text-slate-400 font-bold text-xs select-none">
                            NA
                          </td>
                          <td className="py-4 px-6 text-right bg-slate-50/30 text-slate-400 font-bold text-xs select-none">
                            NA
                          </td>
                        </>
                      )}

                    </tr>
                  );
                })}
                {filteredStock.length > 0 && (
                  <tr className="bg-slate-900 text-white font-black border-t-2 border-slate-700">
                    <td colSpan={4} className="py-5 px-6 text-xs uppercase tracking-wider text-left">
                      Grand Total Live Summary
                    </td>
                    <td className="py-5 px-6 text-center text-blue-300 text-sm">
                      {filteredStock.reduce((sum, item) => sum + (item.reQty || 0), 0).toLocaleString()}
                    </td>
                    <td className="py-5 px-6 text-center text-emerald-400 text-sm">
                      {filteredStock.reduce((sum, item) => sum + (item.totalQty || 0), 0).toLocaleString()}
                    </td>
                    <td className="border-r border-slate-800">{/* Empty padding column for Rate headers */}</td>
                    {loginUser === "Chintan" ? (
                      <>
                        <td className="py-5 px-6 text-right text-yellow-400 text-sm tracking-wide">
                          ₹{filteredStock.reduce((sum, item) => {
                            const cleanRate = parseFloat(String(item.rateDisplay || item.rate || 0).replace(/[^0-9.-]+/g, "")) || 0;
                            return sum + ((item.totalQty || 0) * cleanRate);
                          }, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-5 px-6 text-right text-yellow-400 text-sm tracking-wide">
                          NA
                        </td>
                      </>
                    )}
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {filteredStock.length === 0 && !loading && (
            <div className="py-20 text-center">
              <p className="text-slate-400 font-black uppercase tracking-widest text-xs">No matching stock found</p>
            </div>
          )}
        </div>
        <AddItemModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingItem(null);
            fetchStock(); // Refresh list after saving
          }}
          initialData={editingItem}
        />
        {selectedSku && (
          <ItemReportModal
            sku={selectedSku}
            onClose={() => setSelectedSku(null)}
          />
        )}
      </div>
    </BlockGuard>
  );
}