"use client";
import ItemForm from "./ItemForm"; // This imports your form code
import { FiX } from "react-icons/fi";

// This interface defines the props that the Page was looking for
interface AddItemModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AddItemModal({ isOpen, onClose }: AddItemModalProps) {
  // If isOpen is false, return nothing (popup is hidden)
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* 1. The Dark Background Overlay */}
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
        onClick={onClose} 
      />

      {/* 2. The Actual Popup Box */}
      <div className="relative bg-white rounded-[2.5rem] w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-[#0f172a] p-6 text-white flex justify-between items-center">
          <h2 className="font-black uppercase tracking-widest text-xs text-blue-400">Inventory Registration</h2>
          <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-lg transition-colors">
            <FiX size={20} />
          </button>
        </div>

        <div className="p-8 max-h-[85vh] overflow-y-auto">
          {/* 3. YOUR FORM CODE GOES HERE */}
          <ItemForm onSuccess={onClose} />
        </div>
      </div>
    </div>
  );
}