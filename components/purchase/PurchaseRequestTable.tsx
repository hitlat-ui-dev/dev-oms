"use client";
import { useState, useMemo } from "react";
import { FiSave, FiTrash2, FiChevronUp, FiChevronDown, FiFilter, FiX } from "react-icons/fi";

interface Props {
  data: any[];
  vendors: any[];
  stockData: any[];
  onInputChange: (id: string, field: string, value: any) => void;
  onSave: (req: any) => void;
  onDelete: (id: string) => void;
}

export default function PurchaseRequestTable({ data, vendors, stockData, onInputChange, onSave, onDelete }: Props) {
  const [isSaving, setIsSaving] = useState(false);
  //console.log("Current Stock List:", stockData);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({
    key: 'createdAt',
    direction: 'desc'
  });
  const [filters, setFilters] = useState({
    itemName: "",
    category: ""
  });

  const filteredAndSortedData = useMemo(() => {
    // 1. First, Filter the data
    let result = data.filter(item => {
      const matchesItem = (item.itemName || "").toLowerCase().includes(filters.itemName.toLowerCase());
      const matchesCategory = (item.category || "").toLowerCase().includes(filters.category.toLowerCase());
      return matchesItem && matchesCategory;
    });

    // 2. Then, Sort the filtered data
    if (sortConfig !== null) {
      result.sort((a, b) => {
        const aValue = (a[sortConfig.key] || "").toString().toLowerCase();
        const bValue = (b[sortConfig.key] || "").toString().toLowerCase();

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [data, sortConfig, filters]);


  // Helper function to find stock for a specific item
  const getStockInfo = (itemName: string, sku: string) => {
    // 1. Find the item in stockData using a clean comparison
    const stockItem = stockData?.find(s =>
      (s.sku && s.sku === sku) ||
      (s.itemName && s.itemName.trim().toLowerCase() === itemName.trim().toLowerCase())
    );

    // 2. Use 'totalQty' as seen in your console log
    const availableQty = stockItem?.totalQty;
    const unit = stockItem?.unit || "";

    // 3. Return formatted string or default dash
    if (availableQty === undefined || availableQty === null) {
      return <span className="text-slate-400 font-normal italic">No stock</span>;
    }

    return (
      <span className="text-emerald-600 font-bold">{availableQty} {unit}</span>
    );
  };

  const sortedData = useMemo(() => {
    let sortableItems = [...data];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        // Handle potential null/undefined values and make sorting case-insensitive
        const aValue = (a[sortConfig.key] || "").toString().toLowerCase();
        const bValue = (b[sortConfig.key] || "").toString().toLowerCase();

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [data, sortConfig]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const renderSortIcon = (name: string) => {
    if (sortConfig?.key !== name) return <FiChevronDown className="text-slate-600 ml-auto" />;
    return sortConfig.direction === 'asc'
      ? <FiChevronUp className="text-blue-600 ml-auto" />
      : <FiChevronDown className="text-blue-600 ml-auto" />;
  };
  //console.log("Table Render Data:", filteredAndSortedData);
  return (
    <>
      <div className="flex flex-wrap gap-3 p-4 bg-slate-50 mb-3 rounded-xl border border-slate-200">
        <div className="flex-1 min-w-[200px]">
          <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Search Item</label>
          <div className="relative">
            <input
              type="text"
              placeholder="Filter by name..."
              value={filters.itemName}
              onChange={(e) => setFilters(prev => ({ ...prev, itemName: e.target.value }))}
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
            <FiFilter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        <div className="flex-1 min-w-[200px]">
          <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Search Category</label>
          <div className="relative">
            <input
              type="text"
              placeholder="Filter by category..."
              value={filters.category}
              onChange={(e) => setFilters(prev => ({ ...prev, category: e.target.value }))}
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
            <FiFilter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {(filters.itemName || filters.category) && (
          <button
            onClick={() => setFilters({ itemName: "", category: "" })}
            className="self-end px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-1"
          >
            <FiX size={14} /> <span className="text-[10px] font-black uppercase">Clear</span>
          </button>
        )}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse table-fixed">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="w-20 py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Date</th>

                <th
                  onClick={() => requestSort('itemName')}
                  className="w-56 py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    Item Name {renderSortIcon('itemName')}
                  </div>
                </th>

                {/* --- Category Sort Added Here --- */}
                <th
                  onClick={() => requestSort('category')}
                  className="w-28 py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    Category {renderSortIcon('category')}
                  </div>
                </th>

                <th className="w-20 py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">PR Qty</th>
                <th className="w-20 py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Order Qty</th>
                <th className="w-20 py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Rate</th>

                <th
                  onClick={() => requestSort('vendor')}
                  className="w-40 py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    Vendor {renderSortIcon('vendor')}
                  </div>
                </th>

                <th className="py-3 w-48 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Remarks</th>
                <th className="w-20 py-3 px-2 text-[10px] font-black uppercase text-slate-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAndSortedData.map((req) => (
                <tr key={req._id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-2 px-2 text-[11px] font-medium text-slate-500 border-r border-slate-100">
                    {new Date(req.createdAt).toLocaleDateString('en-GB')}
                  </td>

                  <td className="py-2 px-2 border-r border-slate-100">
                    <div className="flex flex-col  min-w-[200px]">
                      <div className="flex items-center mb-1">
                        <span className="text-[9px] font-bold text-blue-600 uppercase leading-none">{req.sku || "N/A"} - </span>
                        <span className="text-[9px] leading-none">{getStockInfo(req.itemName, req.sku)}</span>
                      </div>
                      <span className="font-bold text-slate-800 text-[12px] ">
                        {req.itemName}
                      </span>
                    </div>
                  </td>

                  <td className="py-2 px-2 border-r border-slate-100 text-[10px] font-bold text-slate-600 uppercase">
                    {req.category || "General"}
                  </td>

                  <td className="py-2 px-2 font-bold text-slate-700 text-[13px] border-r border-slate-100">
                    {req.prQty} <span className="text-[9px] text-slate-400 font-normal">{req.unit}</span>
                  </td>

                  <td className="py-2 px-2 border-r border-slate-100">
                    <input
                      type="number" defaultValue={req.prQty}
                      onChange={(e) => onInputChange(req._id, "orderQty", e.target.value)}
                      className="w-full p-1 bg-slate-50 border border-slate-200 rounded text-[12px] font-bold text-center outline-none"
                    />
                  </td>

                  <td className="py-2 px-2 border-r border-slate-100">
                    <input
                      type="number" placeholder="0"
                      onChange={(e) => onInputChange(req._id, "rate", e.target.value)}
                      className="w-full p-1 bg-slate-50 border border-slate-200 rounded text-[12px] font-bold text-center outline-none"
                    />
                  </td>

                  <td className="py-2 px-2 border-r border-slate-100">
                    {/* <select
                      onChange={(e) => onInputChange(req._id, "vendor", e.target.value)}
                      className="w-full p-1 bg-slate-50 border border-slate-200 rounded font-bold text-[9px] uppercase outline-none focus:border-blue-500"
                    >
                      <option value="">Select</option>
                      {vendors.map((v) => (
                        <option key={v._id} value={v.name}>{v.name}</option>
                      ))}
                    </select> */}
                    <div className="w-full">
                      <input
                        list={`vendor-options-${req._id}`}
                        placeholder="SEARCH VENDOR..."
                        className="w-full p-1 bg-slate-50 border border-slate-200 rounded font-bold text-[9px] uppercase outline-none focus:border-blue-500 transition-all"

                        defaultValue={req.vendor || ""}

                        onChange={(e) => {
                          const textVal = e.target.value;

                          // Look up if what they typed matches an actual vendor name in your array
                          const matchedVendor = vendors.find(
                            (v: any) => v?.name?.toString().trim().toUpperCase() === textVal.trim().toUpperCase()
                          ) as any;

                          if (matchedVendor) {
                            // 🟢 Pass the verified vendor name back to your row handler function when matched
                            onInputChange(req._id, "vendor", matchedVendor.name);
                          } else if (textVal === "") {
                            // Clear it if they empty out the box completely
                            onInputChange(req._id, "vendor", "");
                          } else {
                            // 🟢 Pass the typing text to the parent state so it updates live as you type
                            onInputChange(req._id, "vendor", textVal);
                          }
                        }}
                      />

                      {/* Unique datalist per row */}
                      <datalist id={`vendor-options-${req._id}`}>
                        {vendors.map((v: any) => (
                          <option key={v._id} value={v.name}>
                            {v.name}
                          </option>
                        ))}
                      </datalist>
                    </div>

                  </td>

                  <td className="py-2 px-2 text-[10px] text-slate-500 border-r border-slate-100 ">
                    {req.remark || "---"}
                  </td>

                  <td className="py-2 px-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button disabled={isSaving}
                        //onClick={() => onSave(req)} className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                        onClick={async () => {
                          if (isSaving) return; // Guard protection
                          setIsSaving(true);    // Instantly lock button

                          try {
                            await onSave(req);  // Execute the parent save handler
                          } catch (err) {
                            console.error(err);
                          } finally {
                            setIsSaving(false); // Unlock only if it fails (if it succeeds, row disappears)
                          }
                        }}
                        className={`p-1.5 rounded transition-colors ${isSaving ? "text-gray-400 bg-gray-100 cursor-not-allowed" : "text-green-600 hover:bg-green-50"
                          }`}
                      >
                        <FiSave size={14} />
                      </button>
                      <button onClick={() => onDelete(req._id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors">
                        <FiTrash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredAndSortedData.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 font-bold uppercase text-xs tracking-widest">
                    No purchase requests match your filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}