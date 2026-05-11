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

  const fetchStock = async () => {
    try {
      const res = await fetch("/api/stock");
      const data = await res.json();
      setStock(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load stock");
    } finally {
      setLoading(false);
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
  // Filter logic for search
  const filteredStock = useMemo(() => {
    return stock.filter(item =>
      item.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [stock, searchQuery]);

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


          <div className="flex items-center gap-4 w-full md:w-auto">
            {/* Search Bar */}
            <div className="relative flex-1 md:w-64">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search SKU or Item..."
                className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 text-xs font-bold outline-none focus:border-blue-500 transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] font-black text-slate-400 uppercase block">Total SKUs</span>
              <span className="text-xl font-black text-blue-600 leading-none">{filteredStock.length}</span>
            </div>
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
                  <th className="py-5 px-6 text-[10px] font-black uppercase tracking-widest text-right">Last Rate</th>
                  {/* <th></th> */}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={6} className="py-20 text-center font-bold text-slate-400 animate-pulse">LOADING STOCK DATA...</td></tr>
                ) : filteredStock.map((item, idx) => (
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

                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <FiTrendingUp size={12} className="text-emerald-500" />
                        <span className="text-xs font-black text-slate-600 italic">
                          {item.rateDisplay}
                        </span>
                      </div>
                    </td>
                    {/* <td className="py-4 px-4 uppercase font-bold text-xs text-red-600">
                    <BlockGuard permission="editStock">
                    <button
                      onClick={() => handleEdit(item)}
                      className="hover:underline hover:text-blue-800 transition-all cursor-pointer"
                    >
                      <FiEdit />
                      </button>
                      </BlockGuard>
                  </td> */}
                  </tr>
                ))}
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