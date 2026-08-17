"use client";
import { useState, useMemo } from "react";
import { FiPlus, FiX, FiSearch, FiTrash2 } from "react-icons/fi";

interface BuildSheetModalProps {
  stockItems: any[];
  onClose: () => void;
  onCreate: (sheetName: string, items: { item: any; qty: number }[]) => void;
}

// A separate component (not inline state in the giant gem-sync page) on
// purpose: that page re-renders its entire JSX - including a Requirement
// Mapping Console table that can run to 200+ rows - on every state change.
// Typing in this modal's search/name inputs was triggering that same
// full-page re-render on every keystroke, which is what made "Build Sheet
// From Scratch" feel slow. Keeping this state local means a keystroke here
// only re-renders this modal.
export default function BuildSheetModal({ stockItems, onClose, onCreate }: BuildSheetModalProps) {
  const [buildSheetName, setBuildSheetName] = useState("");
  const [buildItemSearch, setBuildItemSearch] = useState("");
  const [buildSelectedItems, setBuildSelectedItems] = useState<{ item: any; qty: number }[]>([]);

  const buildItemSuggestions = useMemo(() => {
    const q = buildItemSearch.toLowerCase().trim();
    const pool = q
      ? stockItems.filter(s => s.itemName?.toLowerCase().includes(q) || (s.sku || "").toLowerCase().includes(q))
      : stockItems;
    return pool.slice(0, 25);
  }, [buildItemSearch, stockItems]);

  const handleAddBuildItem = (item: any) => {
    setBuildSelectedItems(prev => (prev.some(p => p.item._id === item._id) ? prev : [...prev, { item, qty: 1 }]));
  };

  const handleRemoveBuildItem = (itemId: string) => {
    setBuildSelectedItems(prev => prev.filter(p => p.item._id !== itemId));
  };

  const handleBuildQtyChange = (itemId: string, qty: number) => {
    setBuildSelectedItems(prev => prev.map(p => (p.item._id === itemId ? { ...p, qty } : p)));
  };

  const handleSubmit = () => {
    const sheetName = buildSheetName.trim();
    if (!sheetName) {
      alert("Sheet/Buyer ka naam daalo.");
      return;
    }
    if (buildSelectedItems.length === 0) {
      alert("Kam se kam ek item select karo Inventory se.");
      return;
    }
    onCreate(sheetName, buildSelectedItems);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--gem-card)] border border-[var(--gem-border)] rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 gem-sync-card">

        <div className="p-6 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)] flex items-start justify-between gap-4">
          <div>
            <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider flex items-center gap-2">
              <FiPlus className="text-blue-500" /> Build Sheet From Scratch
            </h3>
            <p className="text-xs text-[var(--gem-text-secondary)] mt-1">
              No client Excel? Pick items straight from Inventory/Master List and fill the same mapping console.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)] p-1"
          >
            <FiX size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">Sheet / Buyer Name</label>
            <input
              type="text"
              autoFocus
              value={buildSheetName}
              onChange={(e) => setBuildSheetName(e.target.value)}
              placeholder="e.g. Kathalal ITI"
              className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)] font-bold outline-none focus:border-blue-500"
            />
            <p className="text-[10px] text-[var(--gem-text-secondary)] mt-1">This becomes the sheet's file name (and the downloaded Excel's file name).</p>
          </div>

          <div>
            <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">Add Items From Inventory</label>
            <div className="relative">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gem-text-secondary)] text-xs" />
              <input
                type="text"
                value={buildItemSearch}
                onChange={(e) => setBuildItemSearch(e.target.value)}
                placeholder="Search item name or SKU..."
                className="w-full pl-8 pr-3 py-2.5 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-xs text-[var(--gem-text-primary)] outline-none focus:border-blue-500 font-semibold"
              />
            </div>
            <div className="max-h-40 overflow-y-auto mt-2 border border-[var(--gem-border)] rounded-xl divide-y divide-[var(--gem-border)]/40">
              {buildItemSuggestions.length === 0 ? (
                <div className="p-3 text-center text-xs text-[var(--gem-text-secondary)] italic">No matching items</div>
              ) : (
                buildItemSuggestions.map((item: any) => {
                  const alreadyAdded = buildSelectedItems.some(p => p.item._id === item._id);
                  return (
                    <button
                      key={item._id}
                      type="button"
                      onClick={() => handleAddBuildItem(item)}
                      disabled={alreadyAdded}
                      className="w-full text-left py-2 px-3 text-xs flex items-center justify-between gap-2 hover:bg-[var(--gem-table-row-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="font-bold text-[var(--gem-text-primary)] truncate">{item.itemName}</span>
                      <span className="text-[var(--gem-text-secondary)] shrink-0">
                        {alreadyAdded ? "Added" : <FiPlus size={13} />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {buildSelectedItems.length > 0 && (
            <div>
              <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">
                Selected Items ({buildSelectedItems.length})
              </label>
              <div className="space-y-2">
                {buildSelectedItems.map(({ item, qty }) => (
                  <div key={item._id} className="flex items-center gap-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl p-2.5">
                    <span className="flex-1 text-xs font-bold text-[var(--gem-text-primary)] truncate">{item.itemName}</span>
                    <input
                      type="number"
                      min={1}
                      value={qty}
                      onChange={(e) => handleBuildQtyChange(item._id, Math.max(1, Number(e.target.value)))}
                      className="w-20 p-2 bg-[var(--gem-card)] border border-[var(--gem-border)] rounded-lg text-xs text-center font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveBuildItem(item._id)}
                      className="text-[var(--gem-text-secondary)] hover:text-red-600 p-1"
                    >
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-[var(--gem-border)] bg-[var(--gem-table-header)] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 bg-[var(--gem-card)] border border-[var(--gem-border)] text-[var(--gem-text-primary)] rounded-xl font-bold uppercase text-xs tracking-wider hover:bg-[var(--gem-table-row-hover)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold uppercase text-xs tracking-wider transition-all shadow-md"
          >
            Create Sheet ({buildSelectedItems.length} items)
          </button>
        </div>
      </div>
    </div>
  );
}
