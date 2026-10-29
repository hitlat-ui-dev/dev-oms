"use client";
import { useEffect, useState } from "react";
import AddItemModal from "@/components/AddItemModal";

// Ctrl/Cmd+Shift+A opens "Add New Item" on every OMS page. Orders, Fetch GeM Orders and GeM Sync keep
// their own page-level handler (it hooks into that page's refresh); those handlers call preventDefault,
// so this bubbling listener sees `defaultPrevented` and stays out of the way - no double modal.
export default function GlobalAddItem() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "a")) return;
      if (e.defaultPrevented) return;
      try {
        const u = JSON.parse(localStorage.getItem("oms_user") || "null");
        const p = u?.permissions || {};
        if (!u || (!p.boss && !p.addNewItem)) return;
      } catch {
        return;
      }
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <AddItemModal isOpen={open} onClose={() => setOpen(false)} />;
}
