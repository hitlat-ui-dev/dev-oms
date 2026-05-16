"use client";

import { useState, useEffect } from "react";

interface ItemHistory {
  type: string;
  qty: number;
  date: string | { $date: string | Date };
  remark?: string;
}

interface MasterItem {
  _id: { $oid: string } | string;
  itemName: string;
  sku: string;
  category: string;
  unit: string;
  currentStock: number;
  location?: string;
  createdAt?: string | { $date: string | Date };
  history?: ItemHistory[];
}

export default function MasterItemsPage() {
  const [items, setItems] = useState<MasterItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>("");

  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/stock/items");
      if (res.ok) {
        const data = await res.json();
        setItems(data);
      }
    } catch (error) {
      console.error("Failed fetching items database:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = items.filter((item) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      item.itemName?.toLowerCase().includes(searchLower) ||
      item.sku?.toLowerCase().includes(searchLower) ||
      item.category?.toLowerCase().includes(searchLower) ||
      item.location?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* Upper Action Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">Master Items Database</h1>
          <p className="text-sm text-gray-500">Central repository with active modification logs</p>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
          <input
            type="text"
            placeholder="Search by Name, SKU, Category, Room..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full md:w-80 bg-white"
          />
          <button 
            onClick={fetchItems}
            className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-sm font-medium rounded-md shadow-sm transition"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Main Content Table Wrapper */}
      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <span className="text-sm text-gray-500 font-medium">Loading Master Items...</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex justify-center items-center h-64">
            <span className="text-sm text-gray-400">No items matched your lookup criteria.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
              <thead className="bg-gray-50 text-gray-700 font-semibold uppercase tracking-wider text-xs border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3">Sr. No.</th>
                  <th className="px-6 py-3">SKU / Item Details</th>
                  <th className="px-6 py-3">Category</th>
                  <th className="px-6 py-3">Location</th>
                  <th className="px-6 py-3 text-center">Current Stock</th>
                  <th className="px-6 py-3 text-center">Unit</th>
                  <th className="px-6 py-3">Stock History Logs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white text-gray-700">
                {filteredItems.map((item, index) => {
                  return (
                    <tr key={index} className="hover:bg-gray-50/50 transition-colors align-top">
                      {/* Sr. No */}
                      <td className="px-6 py-4 whitespace-nowrap text-gray-400 font-mono text-xs pt-5">
                        {String(index + 1).padStart(2, "0")}
                      </td>

                      {/* SKU & Item Name */}
                      <td className="px-6 py-4 pt-5">
                        <div className="font-semibold text-blue-600 font-mono tracking-tight text-xs mb-1">
                          {item.sku || "N/A"}
                        </div>
                        <div className="font-medium text-gray-900 max-w-xs break-words">
                          {item.itemName}
                        </div>
                      </td>

                      {/* Category */}
                      <td className="px-6 py-4 whitespace-nowrap pt-5">
                        <span className="px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-50 text-blue-800 border border-blue-100 uppercase">
                          {item.category || "GENERAL"}
                        </span>
                      </td>

                      {/* Location */}
                      <td className="px-6 py-4 whitespace-nowrap font-mono text-xs text-gray-600 pt-5">
                        {item.location && item.location.trim() !== "" ? (
                          <span className="bg-gray-100 border border-gray-200 px-2 py-0.5 rounded text-gray-700">
                            {item.location}
                          </span>
                        ) : (
                          <span className="text-gray-300">Not Set</span>
                        )}
                      </td>

                      {/* Current Stock */}
                      <td className={`px-6 py-4 whitespace-nowrap text-center font-bold font-mono text-base pt-5 ${
                        item.currentStock > 0 ? "text-emerald-600" : "text-amber-500"
                      }`}>
                        {item.currentStock}
                      </td>

                      {/* Unit */}
                      <td className="px-6 py-4 whitespace-nowrap text-center text-xs font-semibold text-gray-500 uppercase pt-5">
                        {item.unit || "NOS"}
                      </td>

                      {/* History Logs Column */}
                      <td className="px-6 py-4 max-w-md pt-4">
                        {item.history && item.history.length > 0 ? (
                          <div className="space-y-1.5 max-h-32 overflow-y-auto pr-2">
                            {item.history.map((log, hIdx) => {
                              // --- Pure Type Guard to strip all TypeScript Redlines ---
                              const logDate = (log.date && typeof log.date === "object" && "$date" in log.date)
                                ? log.date.$date 
                                : log.date;

                              const formattedLogDate = logDate
                                ? new Date(logDate).toLocaleDateString("en-GB").replace(/\//g, "-")
                                : "---";

                              const isInward = log.type?.toLowerCase().includes("inward") || 
                                              log.type?.toLowerCase().includes("add") || 
                                              log.type?.toLowerCase().includes("purchase");

                              return (
                                <div 
                                  key={hIdx} 
                                  className="text-xs bg-gray-50 border border-gray-200 rounded p-1.5 flex justify-between items-center gap-4"
                                >
                                  <div className="truncate">
                                    <span className={`font-semibold uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded mr-1.5 ${
                                      isInward 
                                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200" 
                                        : "bg-red-50 text-red-700 border border-red-200"
                                    }`}>
                                      {log.type || "Update"}
                                    </span>
                                    {log.remark && (
                                      <span className="text-gray-500 text-[11px] italic" title={log.remark}>
                                        "{log.remark}"
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-right whitespace-nowrap font-mono text-[11px]">
                                    <span className={`font-bold ${isInward ? "text-emerald-600" : "text-red-600"}`}>
                                      {isInward ? "+" : "-"}{log.qty}
                                    </span>
                                    <span className="text-gray-400 ml-2 text-[10px]">{formattedLogDate}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-gray-400 text-xs italic inline-block pt-1">No history logged</span>
                        )}
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        
        {/* Foot Stats strip */}
        {!loading && (
          <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 text-xs text-gray-500 font-medium flex justify-between">
            <span>Showing {filteredItems.length} items</span>
            <span>Total Stock Units: {filteredItems.reduce((acc, curr) => acc + (curr.currentStock || 0), 0)}</span>
          </div>
        )}
      </div>
    </div>
  );
}