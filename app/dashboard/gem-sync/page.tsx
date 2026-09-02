"use client";
import * as XLSX from "xlsx";
import XLSXStyle from "xlsx-js-style";
import Link from "next/link";
import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  FiUploadCloud,
  FiDownload,
  FiRefreshCw,
  FiPlus,
  FiSearch,
  FiEdit,
  FiClock,
  FiCheckCircle,
  FiAlertTriangle,
  FiExternalLink,
  FiArrowLeft,
  FiTrash2,
  FiDatabase,
  FiList,
  FiLink,
  FiCopy,
  FiInfo,
  FiChevronDown,
  FiCheck,
  FiX,
  FiUser,
  FiSlash,
  FiArrowUp,
  FiArrowDown,
  FiArrowRight
} from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import AddItemModal from "@/components/AddItemModal";
import BuildSheetModal from "@/components/gemSync/BuildSheetModal";
import { triggerGemCatalogueUpdate } from "@/lib/triggerGemSubmit";

// Types definition
interface Buyer {
  id: string;
  name: string;
  createdAt: string;
}

interface SavedSheet {
  id: string;
  fileName: string;
  // The Sheet Library list payload no longer carries these two heavy fields —
  // they're fetched on demand via GET /api/gem-sync?sheetContent={id} (see
  // fetchSheetContent) once a sheet is actually opened. totalRows/completedRows
  // are the derived counts the list view uses instead.
  uploadedRows?: UploadedRow[];
  originalExcelData?: any[];
  totalRows?: number;
  completedRows?: number;
  selectedBuyerId: string;
  isCompleted?: boolean;
  lastEditedBy?: string;
  uploadedBy?: string;
  uploadedAt?: string;
  updatedAt: string;
}

interface FirmItemListing {
  id: string;
  firmCode: string;
  itemId: string;
  itemName: string;
  gemLink: string;
  rate: number;
  availGemStock?: number;
  minQty: number;
  status: "Synced" | "Pending";
  buyerId: string;
  date: string;
  // Only set on listings created via "Add to Master List" on the GeM
  // Catalogue page - GeM's own product id, needed by the Sync Checklist's
  // "Sync to GeM" button to find the right product on GeM's side.
  gemCatalogueId?: string;
}

interface RateHistory {
  id: string;
  listingId: string;
  itemName: string;
  buyerId: string;
  buyerName: string;
  oldRate: number;
  newRate: number;
  oldMinQty: number;
  newMinQty: number;
  reason: string;
  timestamp: string;
}

// "New Upload Link" checklist portion (Sync Checklist tab) - items pushed
// here via the Requirement Mapping Console's "Add New Link" button, for a
// firm that has no existing GeM listing for this item at all yet. Kept
// separate from FirmItemListing/gem_listings (the "Stock Update" checklist
// portion) since a brand-new item may not have a rate/inventory mapping yet.
interface NewLinkChecklistEntry {
  id: string;
  firmCode: string;
  itemName: string;
  spec?: string;
  remark?: string;
  requiredQty: number;
  unit?: string;
  rate?: number;
  mappedItemId?: string;
  // Carried straight over from the uploaded sheet's row (the GeM product
  // someone searched out of the marketplace for this item), along with the
  // two stock fields the Master List needs. "Push to Stock" below builds a
  // real FirmItemListing out of these once the listing has actually been
  // uploaded under this firm - the point at which the entry stops being a
  // to-do and becomes a live listing.
  gemLink?: string;
  minQty?: number;
  availGemStock?: number;
  pushedListingId?: string;
  buyerId: string;
  status: "Pending" | "Synced";
  date: string;
}

interface UploadedRow {
  index: number;
  originalName: string;
  qty: number;
  rate: number;
  mappedItemId: string;
  firmCode: string;
  gemLink: string;
  availGemStock: number;
  minQty: number;
  isCompleted?: boolean;
  completedBy?: string;
  completedAt?: string;
  // No GeM listing exists for this item at all (client wants it, but it can't
  // be found on GeM) - pulls the row out of Uncompleted into its own tab
  // instead of leaving it stuck there forever with nothing actionable.
  notAvailable?: boolean;
  notAvailableBy?: string;
  notAvailableAt?: string;
}

// Master Rate Sheet: one row per stock item, carrying up to 4 rate "types" so
// a rate only has to be typed once instead of re-typed on every sheet that
// item shows up on. Whichever type gets picked while a sheet is open fills
// every matched row's Rate column from here in one go.
type RateType = "A" | "B" | "C" | "D";
interface MasterRateEntry {
  itemId: string;
  rateA?: number;
  rateB?: number;
  rateC?: number;
  rateD?: number;
}

export default function GeMSyncPage() {
  // Database state (fetched from real API)
  const [companies, setCompanies] = useState<any[]>([]);
  const [stockItems, setStockItems] = useState<any[]>([]);
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
  const [sellers, setSellers] = useState<any[]>([]);

  // Local state (persisted in localStorage)
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [listings, setListings] = useState<FirmItemListing[]>([]);
  const [rateHistory, setRateHistory] = useState<RateHistory[]>([]);
  const [customItems, setCustomItems] = useState<any[]>([]);
  const [newLinkChecklist, setNewLinkChecklist] = useState<NewLinkChecklistEntry[]>([]);
  const [masterRates, setMasterRates] = useState<MasterRateEntry[]>([]);

  // Page active tabs/modes
  const [activeTab, setActiveTab] = useState<"upload" | "checklist" | "sheets" | "master">("master");
  // Sync Checklist has two portions: "Stock Update" (the original per-firm
  // Pending-listings view, unchanged) and "New Upload Link" (brand-new items
  // with no GeM listing yet, from the "Add New Link" row action below).
  const [checklistSubTab, setChecklistSubTab] = useState<"stock" | "newLink">("stock");
  const [showAllSyncedNewLink, setShowAllSyncedNewLink] = useState<boolean>(false);
  // New Upload Link rows' Revise dialog - same four fields the Stock Update
  // revision dialog edits, minus the negotiation reason (nothing to log a
  // rate history against until the entry becomes a real listing).
  const [newLinkRevisionEntry, setNewLinkRevisionEntry] = useState<NewLinkChecklistEntry | null>(null);
  const [newLinkRateValue, setNewLinkRateValue] = useState<string>("");
  const [newLinkMinQtyValue, setNewLinkMinQtyValue] = useState<string>("");
  const [newLinkStockValue, setNewLinkStockValue] = useState<string>("");
  const [newLinkGemLinkValue, setNewLinkGemLinkValue] = useState<string>("");
  const [showAllSynced, setShowAllSynced] = useState<boolean>(false);
  const [gemCredentials, setGemCredentials] = useState<{ firmCode: string; gemUserId: string; gemPassword: string; gemMailId: string }[]>([]);
  const [syncingListingId, setSyncingListingId] = useState<string | null>(null);

  // Excel Upload states
  const [sheets, setSheets] = useState<SavedSheet[]>([]);
  // Stripped (originalName + mappedItemId only) mapping history across every
  // past sheet — powers "Quick Fill from Master List" without needing every
  // sheet's full uploadedRows in memory (those now live in R2, fetched only
  // for the sheet actually being edited).
  const [rowMappings, setRowMappings] = useState<{ sheetId: string; mappings: { originalName: string; mappedItemId: string }[] }[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string>("");

  const [selectedBuyerId, setSelectedBuyerId] = useState<string>("");
  const [newBuyerName, setNewBuyerName] = useState<string>("");
  const [uploadedRows, setUploadedRows] = useState<UploadedRow[]>([]);
  const [originalExcelData, setOriginalExcelData] = useState<any[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [mappingStatusFilter, setMappingStatusFilter] = useState<"uncompleted" | "completed" | "not_available" | "all">("uncompleted");

  // "Build Sheet From Scratch" - lets a sheet be created by picking items
  // straight from the Inventory/Master List instead of uploading a client
  // Excel file. Feeds the same uploadedRows/originalExcelData state as
  // handleExcelUpload does, so the existing Requirement Mapping Console and
  // Download Filled Excel both work unmodified either way. Its own inputs
  // (name/search/selected items) live inside BuildSheetModal itself, not
  // here - this page re-renders on every state change, and that includes a
  // Requirement Mapping Console table that can run 200+ rows, so keeping
  // that state local to the modal keeps typing in it from re-rendering all of this.
  const [showBuildSheetModal, setShowBuildSheetModal] = useState(false);

  // Master Rate Sheet popup - see MasterRateEntry above.
  const [showMasterRateModal, setShowMasterRateModal] = useState(false);
  const [masterRateTab, setMasterRateTab] = useState<"current" | "all">("current");
  const [masterRateSearch, setMasterRateSearch] = useState("");
  const [masterRatesDraft, setMasterRatesDraft] = useState<MasterRateEntry[]>([]);
  const [allRateVisibleCount, setAllRateVisibleCount] = useState(50);
  // Rate type currently selected to bulk-apply onto the open sheet's Rate column.
  const [selectedRateType, setSelectedRateType] = useState<RateType>("A");

  // Search/Filters states
  const [buyerSearchQuery, setBuyerSearchQuery] = useState<string>("");
  const [masterItemSearch, setMasterItemSearch] = useState<string>("");
  const [masterFirmSearch, setMasterFirmSearch] = useState<string>("");
  const [masterUrlSearch, setMasterUrlSearch] = useState<string>("");
  const [librarySearchQuery, setLibrarySearchQuery] = useState<string>("");

  // Modal / Revision states
  const [isRevisionOpen, setIsRevisionOpen] = useState(false);
  const [selectedListingForRevision, setSelectedListingForRevision] = useState<FirmItemListing | null>(null);
  const [newRateValue, setNewRateValue] = useState<string>("");
  const [newMinQtyValue, setNewMinQtyValue] = useState<string>("");
  const [newGemLinkValue, setNewGemLinkValue] = useState<string>("");
  const [newAvailGemStockValue, setNewAvailGemStockValue] = useState<string>("");
  const [revisionReason, setRevisionReason] = useState<string>("negotiated revision");

  // Unmatched Resolution states
  const [unmatchedIndex, setUnmatchedIndex] = useState<number | null>(null);
  const [newUnmatchedItem, setNewUnmatchedItem] = useState({
    name: "",
    firmCode: "",
    gemLink: "",
    rate: "",
    minQty: "1"
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Set right after loading a sheet's content from R2 (initial mount-time
  // auto-load, or opening one from the Sheet Library) - tells the debounced
  // auto-save effect below to skip its very next run, since that run would
  // otherwise fire ~1s after load and write the exact same content straight
  // back to R2+Mongo unchanged.
  const skipNextAutoSaveRef = useRef(false);

  // Current logged-in user (used to record who is working on each sheet)
  const [currentUsername, setCurrentUsername] = useState<string>("");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("oms_user");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.username) setCurrentUsername(parsed.username);
      }
    } catch (err) {
      console.error("Failed to read logged-in user", err);
    }
  }, []);

  // Whether a sheet's heavy content (uploadedRows/originalExcelData) is
  // currently being fetched from R2 on demand (see fetchSheetContent below).
  const [loadingSheetContent, setLoadingSheetContent] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const [saveToLibraryStatus, setSaveToLibraryStatus] = useState("");

  // The Sheet Library list no longer carries uploadedRows/originalExcelData —
  // those live in R2 now, fetched only when a sheet is actually opened.
  const fetchSheetContent = async (sheetId: string): Promise<{ uploadedRows: UploadedRow[]; originalExcelData: any[] }> => {
    const res = await fetch(`/api/gem-sync?sheetContent=${encodeURIComponent(sheetId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Failed to load sheet content");
    return { uploadedRows: data.uploadedRows || [], originalExcelData: data.originalExcelData || [] };
  };

  // Load backend and MongoDB shared data
  useEffect(() => {
    // 1. Fetch Firms
    fetch("/api/companies")
      .then(res => res.json())
      .then(data => setCompanies(Array.isArray(data) ? data : []))
      .catch(err => console.error("Error fetching companies", err));

    // 2. Fetch Inventory Items
    fetch("/api/stock")
      .then(res => res.json())
      .then(data => setStockItems(Array.isArray(data) ? data : []))
      .catch(err => console.error("Error fetching stock", err));

    // 3. Fetch Sellers (Deliver / Buyer Directory)
    fetch("/api/sellers")
      .then(res => res.json())
      .then(data => setSellers(Array.isArray(data) ? data : []))
      .catch(err => console.error("Error fetching sellers", err));

    // 4. Fetch Shared GeM Sync State from MongoDB (rate history excluded — see below)
    fetch("/api/gem-sync")
      .then(res => res.json())
      .then(state => {
        if (state) {
          if (Array.isArray(state.buyers)) setBuyers(state.buyers);
          if (Array.isArray(state.listings)) setListings(state.listings);
          if (Array.isArray(state.customItems)) setCustomItems(state.customItems);
          if (Array.isArray(state.rowMappings)) setRowMappings(state.rowMappings);
          if (Array.isArray(state.newLinkChecklist)) setNewLinkChecklist(state.newLinkChecklist);
          if (Array.isArray(state.masterRates)) setMasterRates(state.masterRates);
          if (Array.isArray(state.sheets)) {
            setSheets(state.sheets);
            // Default load the latest active sheet
            if (state.sheets.length > 0) {
              const sorted = [...state.sheets].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
              const latest = sorted[0];
              // Same race as the Resume Mapping button below - must be set
              // BEFORE activeSheetId/fileName so the auto-save effect skips
              // its very first (stale, pre-fetch) run instead of saving [].
              skipNextAutoSaveRef.current = true;
              setActiveSheetId(latest.id);
              setFileName(latest.fileName);
              setSelectedBuyerId(latest.selectedBuyerId);
              setLoadingSheetContent(true);
              fetchSheetContent(latest.id)
                .then(({ uploadedRows, originalExcelData }) => {
                  skipNextAutoSaveRef.current = true;
                  setUploadedRows(uploadedRows);
                  setOriginalExcelData(originalExcelData);
                })
                .catch(err => console.error("Failed to load latest sheet content", err))
                .finally(() => setLoadingSheetContent(false));
            }
          }
        }
      })
      .catch(err => console.error("Error loading shared MongoDB state:", err));
  }, []);

  // Keyboard shortcut for "+ Add New Item" (Ctrl/Cmd+Shift+A) - same
  // addEventListener("keydown") pattern as the dashboard's Ctrl/Cmd+K
  // shortcut. Shift is included so it doesn't collide with any single-letter
  // shortcut browsers/extensions might bind to plain Ctrl+A.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setIsAddItemModalOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Rate history is only ever read on the Upload Sheet tab (the "last quoted
  // rate" hint) - a full scan of this collection has been observed taking
  // 40+ seconds on this cluster, so it's fetched lazily the first time that
  // tab is actually opened, not unconditionally on every page load. Once
  // fetched it's kept in state for the rest of the session (no re-fetch on
  // switching tabs back and forth).
  const rateHistoryFetchedRef = useRef(false);
  useEffect(() => {
    if (activeTab !== "upload" || rateHistoryFetchedRef.current) return;
    rateHistoryFetchedRef.current = true;
    fetch("/api/gem-sync?rateHistory=1")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data?.rateHistory)) setRateHistory(data.rateHistory);
      })
      .catch(err => console.error("Error loading rate history", err));
  }, [activeTab]);

  // GeM Login Setup credentials for the current OMS user - only needed for
  // the Sync Checklist tab's "Sync to GeM" button (per-firm gemUserId/
  // gemPassword/gemMailId, looked up by firmCode when that button is clicked).
  const gemCredentialsFetchedRef = useRef(false);
  useEffect(() => {
    if (activeTab !== "checklist" || gemCredentialsFetchedRef.current || !currentUsername) return;
    gemCredentialsFetchedRef.current = true;
    fetch(`/api/gem-credentials?username=${encodeURIComponent(currentUsername)}`)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setGemCredentials(data); })
      .catch(err => console.error("Error loading GeM credentials", err));
  }, [activeTab]);

  // Combined options list of buyers from Sellers API and GeM Buyers
  const allBuyerOptions = useMemo(() => {
    const list: { id: string; name: string }[] = [];

    // 1. Add from sellers directory (/api/sellers)
    sellers.forEach((s: any) => {
      const name = s.instituteName || s.buyerName;
      if (name && !list.some(l => l.name.toLowerCase() === name.toLowerCase())) {
        list.push({ id: s._id || name, name });
      }
    });

    // 2. Add from gem-sync buyers state
    buyers.forEach(b => {
      if (b.name && !list.some(l => l.name.toLowerCase() === b.name.toLowerCase())) {
        list.push({ id: b.id || b.name, name: b.name });
      }
    });

    return list;
  }, [sellers, buyers]);

  // Search filter state for the buyer selector popover
  const [openBuyerSelectSheetId, setOpenBuyerSelectSheetId] = useState<string | null>(null);
  const [buyerSearchFilter, setBuyerSearchFilter] = useState<string>("");
  // The popover is rendered through a portal (see below) at this fixed
  // viewport position, computed from the trigger button's own rect - the
  // table sits in an `overflow-x-auto` wrapper, which the CSS overflow spec
  // forces to also compute overflow-y as `auto` (setting only one axis to a
  // non-visible value makes the other axis auto too), so an absolutely
  // positioned dropdown for a row near the bottom of the table was getting
  // clipped there and its lower options stopped receiving clicks.
  const [buyerPopoverPos, setBuyerPopoverPos] = useState<{ top: number; left: number } | null>(null);

  const filteredBuyerOptions = useMemo(() => {
    if (!buyerSearchFilter.trim()) return allBuyerOptions;
    const q = buyerSearchFilter.toLowerCase().trim();
    return allBuyerOptions.filter(b => b.name.toLowerCase().includes(q));
  }, [allBuyerOptions, buyerSearchFilter]);

  // Handler to change and auto-save buyer associated with a sheet
  const handleChangeSheetBuyer = async (sheetId: string, newBuyerId: string) => {
    const updatedSheets = sheets.map(s =>
      s.id === sheetId ? { ...s, selectedBuyerId: newBuyerId, lastEditedBy: currentUsername || s.lastEditedBy, updatedAt: new Date().toISOString() } : s
    );
    setSheets(updatedSheets);

    if (activeSheetId === sheetId) {
      setSelectedBuyerId(newBuyerId);
    }

    const targetSheet = updatedSheets.find(s => s.id === sheetId);
    if (targetSheet) {
      try {
        // Metadata-only update — deliberately omits uploadedRows/originalExcelData
        // (the Sheet Library's copy of this sheet doesn't carry them anymore;
        // sending them here would overwrite the sheet's real content with nothing).
        await fetch("/api/gem-sync?action=save_sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: targetSheet.id,
            fileName: targetSheet.fileName,
            selectedBuyerId: newBuyerId,
            isCompleted: targetSheet.isCompleted,
            lastEditedBy: targetSheet.lastEditedBy,
            uploadedBy: currentUsername
          })
        });

        // Ensure newly selected buyer exists in local buyers list for historical tracking
        const matchedOpt = allBuyerOptions.find(b => b.id === newBuyerId);
        if (matchedOpt && !buyers.some(b => b.name.toLowerCase() === matchedOpt.name.toLowerCase())) {
          const newBuyerObj = { id: matchedOpt.id, name: matchedOpt.name, createdAt: new Date().toISOString() };
          saveBuyers([...buyers, newBuyerObj]);
        }
      } catch (err) {
        console.error("Failed to auto-save sheet buyer", err);
      }
    }
  };

  // Status filter for Sheet Library: current (incomplete), completed, or all
  const [sheetStatusFilter, setSheetStatusFilter] = useState<"current" | "completed" | "all">("current");

  // Handler to toggle completed status for a sheet and auto-save
  const handleToggleSheetCompleted = async (sheetId: string, currentCompleted: boolean) => {
    const newCompletedState = !currentCompleted;
    const updatedSheets = sheets.map(s =>
      s.id === sheetId ? { ...s, isCompleted: newCompletedState, lastEditedBy: currentUsername || s.lastEditedBy, updatedAt: new Date().toISOString() } : s
    );
    setSheets(updatedSheets);

    const targetSheet = updatedSheets.find(s => s.id === sheetId);
    if (targetSheet) {
      try {
        // Metadata-only update — see the note in handleChangeSheetBuyer above for why
        // uploadedRows/originalExcelData are deliberately omitted here.
        await fetch("/api/gem-sync?action=save_sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: targetSheet.id,
            fileName: targetSheet.fileName,
            selectedBuyerId: targetSheet.selectedBuyerId,
            isCompleted: newCompletedState,
            lastEditedBy: targetSheet.lastEditedBy,
            uploadedBy: currentUsername
          })
        });
      } catch (err) {
        console.error("Failed to auto-save sheet completion status", err);
      }
    }
  };

  // Debounced auto-save active sheet state to MongoDB
  useEffect(() => {
    if (!activeSheetId || !fileName) return;

    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }

    const delayDebounceFn = setTimeout(() => {
      const activeSheet = sheets.find(s => s.id === activeSheetId);
      fetch("/api/gem-sync?action=save_sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeSheetId,
          fileName,
          uploadedRows,
          originalExcelData,
          selectedBuyerId,
          isCompleted: activeSheet?.isCompleted,
          lastEditedBy: currentUsername || activeSheet?.lastEditedBy || "",
          uploadedBy: currentUsername
        })
      })
        .then(() => {
          // Update this sheet's lightweight metadata locally instead of
          // re-fetching every collection from scratch — the fresh counts are
          // already known from what was just saved.
          const totalRows = uploadedRows.length;
          const completedRows = uploadedRows.filter(r => r.isCompleted).length;
          setSheets(prev =>
            prev.map(s => (s.id === activeSheetId ? { ...s, totalRows, completedRows, updatedAt: new Date().toISOString() } : s))
          );

          // Keep this sheet's mapping-history in sync locally too, so "Quick
          // Fill from Master List" reflects rows mapped earlier in this same
          // session immediately, without waiting for a reload.
          const mappings = uploadedRows
            .filter(r => r.originalName && r.mappedItemId)
            .map(r => ({ originalName: r.originalName, mappedItemId: r.mappedItemId }));
          setRowMappings(prev => [...prev.filter(rm => rm.sheetId !== activeSheetId), { sheetId: activeSheetId, mappings }]);
        })
        .catch(err => console.error("Failed to sync sheet to MongoDB", err));
    }, 1000);

    return () => clearTimeout(delayDebounceFn);
  }, [activeSheetId, fileName, uploadedRows, originalExcelData, selectedBuyerId, currentUsername]);

  // Explicit, immediate (non-debounced) save straight after an upload - the
  // debounced auto-save above only fires 1s after the *last* state change,
  // which for a freshly-parsed sheet can race with (or just silently save 0
  // rows ahead of) the async Excel parsing finishing. This button gives a
  // deterministic save point with visible success/failure feedback, once the
  // parsed rows are already visible on screen for review.
  const handleSaveToLibrary = async () => {
    if (!activeSheetId || !fileName) return;
    setSavingToLibrary(true);
    setSaveToLibraryStatus("");
    try {
      const activeSheet = sheets.find(s => s.id === activeSheetId);
      const payload = JSON.stringify({
        id: activeSheetId,
        fileName,
        uploadedRows,
        originalExcelData,
        selectedBuyerId,
        isCompleted: activeSheet?.isCompleted,
        lastEditedBy: currentUsername || activeSheet?.lastEditedBy || "",
        uploadedBy: currentUsername,
      });
      // Vercel rejects any request body over ~4.5MB before this app's code
      // even runs, returning a plain (non-JSON) error page - catching that
      // here up front gives a diagnosable message instead of a bare "Save
      // failed". This is usually caused by an Excel file whose used-range
      // extends far past the real data (e.g. formatting once applied to a
      // whole row/column), which sheet_to_json then pads with blank cells -
      // handleExcelUpload already strips fully-blank rows/columns to avoid
      // this, but a genuinely huge sheet can still hit the limit.
      const sizeMB = new Blob([payload]).size / (1024 * 1024);
      if (sizeMB > 4) {
        throw new Error(`Sheet is ${sizeMB.toFixed(1)}MB, over the 4MB save limit - check the Excel file for stray formatting far beyond the real data range and re-save it, then re-upload.`);
      }
      const res = await fetch("/api/gem-sync?action=save_sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Save failed (HTTP ${res.status})`);
      }
      const totalRows = uploadedRows.length;
      const completedRows = uploadedRows.filter(r => r.isCompleted).length;
      setSheets(prev => {
        const exists = prev.some(s => s.id === activeSheetId);
        const updatedAt = new Date().toISOString();
        return exists
          ? prev.map(s => (s.id === activeSheetId ? { ...s, fileName, totalRows, completedRows, selectedBuyerId, updatedAt } : s))
          : [{ id: activeSheetId, fileName, totalRows, completedRows, selectedBuyerId, updatedAt, isCompleted: false }, ...prev];
      });
      setSaveToLibraryStatus(`Saved (${totalRows} rows)`);
    } catch (err: any) {
      setSaveToLibraryStatus(`Failed: ${err.message || "unknown error"}`);
    } finally {
      setSavingToLibrary(false);
      setTimeout(() => setSaveToLibraryStatus(""), 4000);
    }
  };

  // Sync state helpers (updates both LocalState, LocalStorage fallback, and MongoDB)
  const saveBuyers = (updatedBuyers: Buyer[]) => {
    setBuyers(updatedBuyers);
    localStorage.setItem("oms_buyers", JSON.stringify(updatedBuyers));
    fetch("/api/gem-sync?action=save_buyers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedBuyers)
    }).catch(err => console.error("Failed to sync buyers to MongoDB", err));
  };

  const saveListings = (updatedListings: FirmItemListing[]) => {
    // Deduplicate listings array by (itemId/itemName + firmCode + buyerId)
    const seen = new Map<string, FirmItemListing>();
    for (const lst of updatedListings) {
      if (!lst) continue;
      const itemKey = (lst.itemId || lst.itemName || "").toString().trim().toLowerCase();
      const firmKey = (lst.firmCode || "").toString().trim().toLowerCase();
      const buyerKey = (lst.buyerId || "").toString().trim().toLowerCase();
      const key = `${itemKey}::${firmKey}::${buyerKey}`;

      if (!seen.has(key)) {
        seen.set(key, lst);
      } else {
        const existing = seen.get(key)!;
        const hasMoreInfo = !existing.gemLink && lst.gemLink;
        const isNewer = new Date(lst.date || 0).getTime() > new Date(existing.date || 0).getTime();
        if (hasMoreInfo || isNewer) {
          seen.set(key, lst);
        }
      }
    }
    const deduplicated = Array.from(seen.values());
    setListings(deduplicated);
    localStorage.setItem("oms_firm_listings", JSON.stringify(deduplicated));
    fetch("/api/gem-sync?action=save_listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deduplicated)
    }).catch(err => console.error("Failed to sync listings to MongoDB", err));
  };

  const saveRateHistory = (updatedHistory: RateHistory[]) => {
    setRateHistory(updatedHistory);
    localStorage.setItem("oms_rate_history", JSON.stringify(updatedHistory));
    fetch("/api/gem-sync?action=save_history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedHistory)
    }).catch(err => console.error("Failed to sync history to MongoDB", err));
  };

  const saveCustomItems = (updatedItems: any[]) => {
    setCustomItems(updatedItems);
    localStorage.setItem("oms_custom_items", JSON.stringify(updatedItems));
    fetch("/api/gem-sync?action=save_custom_items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedItems)
    }).catch(err => console.error("Failed to sync custom items to MongoDB", err));
  };

  const saveNewLinkChecklist = (updated: NewLinkChecklistEntry[]) => {
    setNewLinkChecklist(updated);
    fetch("/api/gem-sync?action=save_new_link_checklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated)
    }).catch(err => console.error("Failed to sync new-link checklist to MongoDB", err));
  };

  const saveMasterRates = (updated: MasterRateEntry[]) => {
    setMasterRates(updated);
    fetch("/api/gem-sync?action=save_master_rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated)
    }).catch(err => console.error("Failed to sync master rates to MongoDB", err));
  };

  const openMasterRateModal = () => {
    setMasterRatesDraft(masterRates);
    setMasterRateTab("current");
    setMasterRateSearch("");
    setAllRateVisibleCount(50);
    setShowMasterRateModal(true);
  };

  const updateDraftRate = (itemId: string, type: RateType, rawValue: string) => {
    const value = rawValue === "" ? undefined : Number(rawValue);
    const key = (`rate${type}` as unknown) as keyof MasterRateEntry;
    setMasterRatesDraft(prev => {
      const idx = prev.findIndex(e => e.itemId === itemId);
      if (idx === -1) {
        return [...prev, { itemId, [key]: value } as MasterRateEntry];
      }
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [key]: value };
      return copy;
    });
  };

  const handleSaveMasterRates = () => {
    saveMasterRates(masterRatesDraft);
    alert("✓ Master Rate Sheet saved.");
  };

  // Whenever a sheet is open, picking a rate type fills every matched row's
  // Rate column from the Master Rate Sheet in one go - rows with no master
  // rate set for that type (or no inventory mapping yet) are left untouched.
  const applyMasterRateToSheet = (type: RateType) => {
    const key = (`rate${type}` as unknown) as keyof MasterRateEntry;
    let updatedCount = 0;
    let missingCount = 0;
    setUploadedRows(prev => prev.map(row => {
      if (!row.mappedItemId) return row;
      const entry = masterRates.find(m => m.itemId === row.mappedItemId);
      const value = entry?.[key] as number | undefined;
      if (value === undefined || value === null) {
        missingCount++;
        return row;
      }
      updatedCount++;
      return { ...row, rate: value };
    }));
    alert(
      `Rate Type ${type} applied: ${updatedCount} row(s) updated` +
      (missingCount > 0 ? `, ${missingCount} row(s) skipped (no Rate ${type} set for that item in Master Rate Sheet).` : ".")
    );
  };

  const RATE_TYPE_ORDER: RateType[] = ["A", "B", "C", "D"];

  // Reverse direction of applyMasterRateToSheet - pushes rates already typed
  // into this sheet BACK into the Master Rate Sheet. Per item: identical
  // rates across rows count as one; a single distinct rate goes into the
  // picked type; 2-4 distinct rates auto-sort ascending into A→D (only the
  // slots that have a value are touched - the rest are left exactly as they
  // are, never merged with the new values); more than 4 distinct rates keeps
  // only the highest 4 before sorting them into A→D.
  const pushSheetRatesToMaster = (singleRateType: RateType) => {
    const ratesByItem = new Map<string, Set<number>>();
    let skippedRows = 0;
    for (const row of uploadedRows) {
      if (!row.mappedItemId || !row.rate || row.rate <= 0) {
        skippedRows++;
        continue;
      }
      if (!ratesByItem.has(row.mappedItemId)) ratesByItem.set(row.mappedItemId, new Set());
      ratesByItem.get(row.mappedItemId)!.add(row.rate);
    }

    if (ratesByItem.size === 0) {
      alert("No mapped rows with a rate to push.");
      return;
    }

    let singleTypeCount = 0;
    let multiTypeCount = 0;
    let truncatedCount = 0;
    const updated = [...masterRates];
    const findOrCreateIndex = (itemId: string) => {
      const idx = updated.findIndex(e => e.itemId === itemId);
      if (idx !== -1) return idx;
      updated.push({ itemId });
      return updated.length - 1;
    };

    for (const [itemId, ratesSet] of ratesByItem) {
      let distinctRates = Array.from(ratesSet);
      const idx = findOrCreateIndex(itemId);
      if (distinctRates.length === 1) {
        updated[idx] = { ...updated[idx], [`rate${singleRateType}`]: distinctRates[0] };
        singleTypeCount++;
      } else {
        if (distinctRates.length > 4) {
          distinctRates = distinctRates.sort((a, b) => b - a).slice(0, 4); // keep highest 4
          truncatedCount++;
        }
        distinctRates.sort((a, b) => a - b); // ascending: lowest of the kept set -> Type A
        const patch: Partial<MasterRateEntry> = {};
        distinctRates.forEach((rate, i) => {
          (patch as any)[`rate${RATE_TYPE_ORDER[i]}`] = rate;
        });
        updated[idx] = { ...updated[idx], ...patch };
        multiTypeCount++;
      }
    }

    saveMasterRates(updated);
    alert(
      `Pushed to Master Rate Sheet: ${singleTypeCount} item(s) with one rate -> Rate ${singleRateType}, ` +
      `${multiTypeCount} item(s) with multiple rates auto-sorted A->D` +
      (truncatedCount > 0 ? ` (${truncatedCount} item(s) had more than 4 distinct rates - kept the highest 4)` : "") +
      "." +
      (skippedRows > 0 ? ` ${skippedRows} row(s) skipped (no inventory mapping or no rate entered).` : "")
    );
  };

  // Combine fetched Stock + locally added Custom Items
  const allItemsList = useMemo(() => {
    return [...stockItems, ...customItems];
  }, [stockItems, customItems]);

  const currentSheetRateItems = useMemo(() => {
    const seen = new Set<string>();
    const result: { itemId: string; itemName: string; sku: string }[] = [];
    for (const row of uploadedRows) {
      if (!row.mappedItemId || seen.has(row.mappedItemId)) continue;
      seen.add(row.mappedItemId);
      const item = allItemsList.find((i: any) => i._id === row.mappedItemId);
      result.push({ itemId: row.mappedItemId, itemName: item?.itemName || row.originalName, sku: item?.sku || "" });
    }
    return result;
  }, [uploadedRows, allItemsList]);

  const allRateFilteredItems = useMemo(() => {
    const q = masterRateSearch.trim().toLowerCase();
    const base = allItemsList.map((i: any) => ({ itemId: i._id, itemName: i.itemName, sku: i.sku || "" }));
    if (!q) return base;
    return base.filter((i: any) => i.itemName.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
  }, [allItemsList, masterRateSearch]);

  // An item hidden in Inventory must never be OFFERED as a new pick (dropdown
  // options, typed-name matching, Build From Scratch), but the unfiltered lists
  // above are deliberately kept whole for everything else: mappings saved
  // before an item was hidden still have to resolve to its name (Master List,
  // Sync Checklist, the mapped-row label), and the custom-item SKU counter at
  // "S" + (1100 + stockItems.length + customItems.length) would start handing
  // out already-taken SKUs if hidden items stopped being counted.
  const selectableItemsList = useMemo(
    () => allItemsList.filter((item: any) => !item?.hidden),
    [allItemsList]
  );
  const selectableStockItems = useMemo(
    () => stockItems.filter((item: any) => !item?.hidden),
    [stockItems]
  );

  // O(1) lookups for the per-row render loop below - a 200+ row sheet was
  // re-scanning the full allItemsList/listings/rateHistory arrays (via
  // .find()/.filter()) inside checkDuplicateRateWarning and
  // getLastQuotedHint for EVERY row on EVERY render (even just typing in one
  // cell), which is what made opening/editing a large sheet feel slow -
  // confirmed live: allItemsList ~2600 items, listings ~825, so those two
  // functions alone were doing hundreds of thousands of comparisons per
  // render. These maps are only rebuilt when their source array actually
  // changes, not on every render.
  const itemsById = useMemo(() => {
    const map = new Map<string, any>();
    allItemsList.forEach(item => { if (item?._id) map.set(item._id, item); });
    return map;
  }, [allItemsList]);

  const listingsByItemId = useMemo(() => {
    const map = new Map<string, FirmItemListing[]>();
    listings.forEach(lst => {
      if (!lst.itemId) return;
      if (!map.has(lst.itemId)) map.set(lst.itemId, []);
      map.get(lst.itemId)!.push(lst);
    });
    return map;
  }, [listings]);

  const rateHistoryByBuyerAndItemName = useMemo(() => {
    const map = new Map<string, RateHistory[]>();
    rateHistory.forEach(hist => {
      const key = `${hist.buyerId}::${hist.itemName}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(hist);
    });
    return map;
  }, [rateHistory]);

  // Real GeM-sync status lookups for the Requirement Mapping Console rows -
  // isCompleted only means "an action was taken" (OK Link/Update Stock/New
  // Link), not that GeM's own catalogue has actually been confirmed updated.
  // The real status lives on the Sync Checklist entry this row's action
  // created (gem_listings for OK Link/Update Stock, gem_new_link_checklist
  // for New Link) - keyed the same way upsertMasterListing matches an
  // existing listing (buyer+item+firm, falling back to buyer+firm+gemLink).
  const listingByBuyerItemFirm = useMemo(() => {
    const map = new Map<string, FirmItemListing>();
    listings.forEach(lst => {
      if (lst.buyerId && lst.itemId && lst.firmCode) {
        map.set(`${lst.buyerId}::${lst.itemId}::${lst.firmCode}`, lst);
      }
    });
    return map;
  }, [listings]);

  const listingByBuyerFirmGemLink = useMemo(() => {
    const map = new Map<string, FirmItemListing>();
    listings.forEach(lst => {
      if (lst.buyerId && lst.firmCode && lst.gemLink) {
        map.set(`${lst.buyerId}::${lst.firmCode}::${lst.gemLink.trim()}`, lst);
      }
    });
    return map;
  }, [listings]);

  const newLinkEntryByBuyerFirmItem = useMemo(() => {
    const map = new Map<string, NewLinkChecklistEntry>();
    newLinkChecklist.forEach(e => {
      if (e.buyerId && e.firmCode && e.mappedItemId) {
        map.set(`${e.buyerId}::${e.firmCode}::${e.mappedItemId}`, e);
      }
    });
    return map;
  }, [newLinkChecklist]);

  const getRowGemSyncStatus = (row: UploadedRow): "synced" | "pending" | "none" => {
    if (!row.firmCode) return "none";
    if (row.mappedItemId) {
      const listing = listingByBuyerItemFirm.get(`${selectedBuyerId}::${row.mappedItemId}::${row.firmCode}`);
      if (listing) return listing.status === "Synced" ? "synced" : "pending";
    }
    if (row.gemLink) {
      const listing = listingByBuyerFirmGemLink.get(`${selectedBuyerId}::${row.firmCode}::${row.gemLink.trim()}`);
      if (listing) return listing.status === "Synced" ? "synced" : "pending";
    }
    if (row.mappedItemId) {
      const entry = newLinkEntryByBuyerFirmItem.get(`${selectedBuyerId}::${row.firmCode}::${row.mappedItemId}`);
      if (entry) return entry.status === "Synced" ? "synced" : "pending";
    }
    return "none";
  };

  // Fuzzy Match logic
  const findFuzzyMatch = (name: string) => {
    if (!name) return "";
    const cleanName = name.trim().toLowerCase();

    // 1. Exact match
    const exact = allItemsList.find(item => item?.itemName && item.itemName.trim().toLowerCase() === cleanName);
    if (exact) return exact._id;

    // 2. Substring match (contains)
    const substring = allItemsList.find(item => {
      if (!item?.itemName) return false;
      const dbName = item.itemName.trim().toLowerCase();
      return cleanName.includes(dbName) || dbName.includes(cleanName);
    });
    if (substring) return substring._id;

    return "";
  };

  // ---- History-based smart matching ----
  // Learns from every requirement row we've ever mapped across all past uploaded sheets,
  // so the same/similar item wording auto-matches to the item it was mapped to before.
  const normalizeMatchText = (s: string) => s.toString().trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");

  const tokenizeMatchText = (s: string) => normalizeMatchText(s).split(/[^a-z0-9]+/).filter(Boolean);

  // Similarity of two token sets: word overlap (Jaccard), heavily penalized if numeric
  // tokens (sizes like 40, 38, 6) don't agree — a "40 MM" item must not match a "38 MM" one.
  const scoreTokenSimilarity = (tokensA: string[], tokensB: string[]) => {
    if (tokensA.length === 0 || tokensB.length === 0) return { score: 0, overlap: 0 };
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    let overlap = 0;
    setA.forEach(t => { if (setB.has(t)) overlap++; });
    const union = new Set([...tokensA, ...tokensB]).size;
    const jaccard = overlap / union;

    const numsA = tokensA.filter(t => /\d/.test(t));
    const numsB = tokensB.filter(t => /\d/.test(t));
    let numericPenalty = 0;
    if (numsA.length > 0 || numsB.length > 0) {
      const numSetA = new Set(numsA);
      const numSetB = new Set(numsB);
      const numOverlap = numsA.filter(n => numSetB.has(n)).length;
      const numUnion = new Set([...numsA, ...numsB]).size;
      const numericMatch = numUnion > 0 ? numOverlap / numUnion : 1;
      numericPenalty = (1 - numericMatch) * 0.5;
    }

    return { score: Math.max(0, jaccard - numericPenalty), overlap };
  };

  // Build the historical match index from every past sheet's mapped rows (all 80+ sheets, not just the current one).
  // Sourced from the lightweight rowMappings collection (originalName + mappedItemId
  // only) rather than each sheet's full uploadedRows, which now live in R2 and are
  // only ever loaded for the one sheet actively being edited.
  const matchHistory = useMemo(() => {
    const exactMap = new Map<string, Map<string, number>>(); // normalized item text -> itemId -> times chosen
    const fuzzyEntries: { tokens: string[]; mappedItemId: string }[] = [];
    const seenPairs = new Set<string>();

    rowMappings.forEach(entry => {
      (entry.mappings || []).forEach(row => {
        if (!row?.originalName || !row?.mappedItemId) return;
        const norm = normalizeMatchText(row.originalName);
        if (!norm) return;

        if (!exactMap.has(norm)) exactMap.set(norm, new Map());
        const itemCounts = exactMap.get(norm)!;
        itemCounts.set(row.mappedItemId, (itemCounts.get(row.mappedItemId) || 0) + 1);

        const pairKey = `${norm}::${row.mappedItemId}`;
        if (!seenPairs.has(pairKey)) {
          seenPairs.add(pairKey);
          fuzzyEntries.push({ tokens: tokenizeMatchText(row.originalName), mappedItemId: row.mappedItemId });
        }
      });
    });

    return { exactMap, fuzzyEntries };
  }, [rowMappings]);

  // Smart match: exact historical match > closest fuzzy historical match > direct stock-item name match
  const findSmartMatch = (name: string): string => {
    if (!name) return "";
    const norm = normalizeMatchText(name);
    if (!norm) return "";

    // 1. Exact text seen before — use whichever item was chosen most often for it
    const exactCounts = matchHistory.exactMap.get(norm);
    if (exactCounts && exactCounts.size > 0) {
      let bestItemId = "";
      let bestCount = 0;
      exactCounts.forEach((count, itemId) => {
        if (count > bestCount) { bestCount = count; bestItemId = itemId; }
      });
      if (bestItemId) return bestItemId;
    }

    // 2. Closest similarly-worded historical match (needs decent word overlap, not just one shared word)
    const queryTokens = tokenizeMatchText(name);
    let bestScore = 0;
    let bestOverlap = 0;
    let bestHistItemId = "";
    matchHistory.fuzzyEntries.forEach(entry => {
      const { score, overlap } = scoreTokenSimilarity(queryTokens, entry.tokens);
      if (score > bestScore) { bestScore = score; bestOverlap = overlap; bestHistItemId = entry.mappedItemId; }
    });
    if (bestHistItemId && bestScore >= 0.6 && bestOverlap >= 2) return bestHistItemId;

    // 3. Never seen before — fall back to direct stock item name match
    return findFuzzyMatch(name);
  };

  // Excel parsing
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setActiveSheetId("sheet_" + Date.now());
    // Cleared synchronously, in the same tick as the new sheet id above -
    // parsing this file happens inside FileReader's async onload below, and
    // the debounced auto-save effect (keyed off activeSheetId/uploadedRows)
    // can otherwise fire on the *previous* sheet's still-in-state rows
    // before parsing finishes, silently saving the old sheet's content under
    // the new sheet's id (exactly what caused every upload to end up with
    // identical content - confirmed live 24-Aug-2026).
    setUploadedRows([]);
    setOriginalExcelData([]);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawData: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        // Excel's own idea of a sheet's "used range" can extend far past the
        // real data (e.g. someone once applied formatting/borders to a whole
        // row or column) - sheet_to_json then pads every row with dozens of
        // blank-string columns that were never real content, which can bloat
        // this file's saved size well past the server's request-size limit
        // for no reason. Drop any column that's blank in every row, and any
        // row that's blank in every remaining column, before this becomes
        // state or gets uploaded.
        const meaningfulKeys = new Set<string>();
        rawData.forEach(row => {
          Object.keys(row).forEach(k => {
            if (String(row[k]).trim() !== "") meaningfulKeys.add(k);
          });
        });
        const data: any[] = rawData
          .map(row => {
            const trimmedRow: any = {};
            meaningfulKeys.forEach(k => { trimmedRow[k] = row[k]; });
            return trimmedRow;
          })
          .filter(row => Object.values(row).some(v => String(v).trim() !== ""));

        setOriginalExcelData(data);

        // Buyer is left unassigned here - the file name must never be used
        // as/to auto-create an Institute. User picks the real Buyer/Institute
        // manually from the Associated Buyer dropdown (sourced from the
        // Sellers/Institute directory).
        setSelectedBuyerId("");
        setBuyerSearchQuery("");

        // Try to parse rows and match headers
        const parsedRows: UploadedRow[] = data.map((row: any, index) => {
          // Find item name case-insensitively
          const originalName = row["Item Name"] || row["item name"] || row["Item"] || row["item"] || row["Name"] || row["name"] || row["Particulars"] || row["particulars"] || Object.values(row)[0] || "";
          // Find quantity case-insensitively
          const qty = Number(row["Item count"] || row["Quantity"] || row["quantity"] || row["Qty"] || row["qty"] || row["Qty Required"] || row["Req Qty"] || 0);
          // Find rate/price case-insensitively
          const rate = Number(row["Rate"] || row["rate"] || row["Price"] || row["price"] || row["Quote Rate"] || 0);

          const mappedItemId = findSmartMatch(String(originalName));

          let firmCode = "";
          let gemLink = "";
          let availGemStock = 0;
          let minQty = 1;
          let finalRate = rate;

          if (mappedItemId) {
            const matchedListing = listings.find(lst => lst.itemId === mappedItemId);
            if (matchedListing) {
              firmCode = matchedListing.firmCode;
              gemLink = matchedListing.gemLink || "";
              minQty = matchedListing.minQty || 1;
              if (!finalRate) {
                finalRate = matchedListing.rate;
              }

              availGemStock = matchedListing.availGemStock || 0;
            }
          }

          return {
            index,
            originalName: String(originalName),
            qty,
            rate: finalRate,
            mappedItemId,
            firmCode,
            gemLink,
            availGemStock,
            minQty
          };
        });

        setUploadedRows(parsedRows);
      } catch (err) {
        console.error("Error parsing excel file:", err);
        alert("Failed to parse the Excel file. Please check the console for details.");
      }
    };
    reader.readAsBinaryString(file);
  };

  // Shared with handleExcelUpload's per-row mapping: given a stock item's id
  // (already known exactly here, since the user picked it directly - no
  // fuzzy name matching needed), pull firm/rate/stock/min-qty from the
  // matching listing the same way an uploaded row would.
  const buildAutoMapFields = (mappedItemId: string, rateOverride?: number) => {
    let firmCode = "";
    let gemLink = "";
    let availGemStock = 0;
    let minQty = 1;
    let finalRate = rateOverride || 0;

    if (mappedItemId) {
      const matchedListing = listings.find(lst => lst.itemId === mappedItemId);
      if (matchedListing) {
        firmCode = matchedListing.firmCode;
        gemLink = matchedListing.gemLink || "";
        minQty = matchedListing.minQty || 1;
        if (!finalRate) finalRate = matchedListing.rate;
        availGemStock = matchedListing.availGemStock || 0;
      }
    }
    return { firmCode, gemLink, availGemStock, minQty, rate: finalRate };
  };

  const handleCreateSheetFromScratch = (sheetName: string, selectedItems: { item: any; qty: number }[]) => {
    setFileName(sheetName);
    setActiveSheetId("sheet_" + Date.now());

    // Same auto-buyer-creation behavior as an Excel upload's filename.
    let buyerId = "";
    const existingBuyer = buyers.find(b => b.name.toLowerCase() === sheetName.toLowerCase());
    if (existingBuyer) {
      buyerId = existingBuyer.id;
    } else {
      const newBuyer: Buyer = { id: "buyer_" + Date.now(), name: sheetName, createdAt: new Date().toISOString() };
      saveBuyers([...buyers, newBuyer]);
      buyerId = newBuyer.id;
    }
    setSelectedBuyerId(buyerId);
    setBuyerSearchQuery(sheetName);

    // Synthetic "as if uploaded" rows - keeps Download Filled Excel (which
    // reads originalExcelData) working exactly the same as for a real upload.
    setOriginalExcelData(selectedItems.map(({ item, qty }) => ({
      "Item Name": item.itemName,
      "Quantity": qty
    })));

    setUploadedRows(selectedItems.map(({ item, qty }, index) => {
      const mapped = buildAutoMapFields(item._id);
      return {
        index,
        originalName: item.itemName,
        qty,
        rate: mapped.rate,
        mappedItemId: item._id,
        firmCode: mapped.firmCode,
        gemLink: mapped.gemLink,
        availGemStock: mapped.availGemStock,
        minQty: mapped.minQty
      };
    }));

    setShowBuildSheetModal(false);
  };

  const handleClearSheet = () => {
    setActiveSheetId("");
    setUploadedRows([]);
    setFileName("");
    setOriginalExcelData([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteSheet = (sheetId: string) => {
    if (!confirm("Are you sure you want to delete this sheet from the library?")) return;

    fetch("/api/gem-sync?action=delete_sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sheetId })
    })
      .then(() => {
        setSheets(prev => prev.filter(s => s.id !== sheetId));
        setRowMappings(prev => prev.filter(rm => rm.sheetId !== sheetId));
        if (activeSheetId === sheetId) {
          handleClearSheet();
        }
        alert("✓ Sheet deleted successfully from shared database.");
      })
      .catch(err => console.error("Error deleting sheet:", err));
  };

  // Add Buyer helper
  const handleAddBuyer = () => {
    if (!newBuyerName.trim()) return;
    const newBuyer: Buyer = {
      id: "buyer_" + Date.now(),
      name: newBuyerName.trim(),
      createdAt: new Date().toISOString()
    };
    saveBuyers([...buyers, newBuyer]);
    setSelectedBuyerId(newBuyer.id);
    setNewBuyerName("");
  };

  // Filtered Buyers list for Autocomplete
  const filteredBuyers = useMemo(() => {
    if (!buyerSearchQuery.trim()) return buyers;
    return buyers.filter(b => b.name.toLowerCase().includes(buyerSearchQuery.toLowerCase()));
  }, [buyers, buyerSearchQuery]);

  // Manual Cleanup Duplicates action handler
  const handleCleanupDuplicates = async () => {
    try {
      const res = await fetch("/api/gem-sync?action=cleanup_duplicates", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        if (Array.isArray(data.listings)) {
          setListings(data.listings);
        }
        alert(`✓ Cleaned up MongoDB! Removed ${data.removedCount || 0} duplicate listings.`);
      }
    } catch (err) {
      console.error("Failed to cleanup duplicates:", err);
      alert("Failed to cleanup duplicates. Check console for details.");
    }
  };

  // Filtered Listings for Master List (Sorted by item name to group duplicates consecutively)
  const filteredMasterListings = useMemo(() => {
    // Ensure array is deduplicated by (itemId/itemName + firmCode + buyerId)
    const seen = new Map<string, FirmItemListing>();
    for (const lst of listings) {
      if (!lst) continue;
      const itemKey = (lst.itemId || lst.itemName || "").toString().trim().toLowerCase();
      const firmKey = (lst.firmCode || "").toString().trim().toLowerCase();
      const buyerKey = (lst.buyerId || "").toString().trim().toLowerCase();
      const key = `${itemKey}::${firmKey}::${buyerKey}`;

      if (!seen.has(key)) {
        seen.set(key, lst);
      } else {
        const existing = seen.get(key)!;
        const hasMoreInfo = !existing.gemLink && lst.gemLink;
        const isNewer = new Date(lst.date || 0).getTime() > new Date(existing.date || 0).getTime();
        if (hasMoreInfo || isNewer) {
          seen.set(key, lst);
        }
      }
    }
    let list = Array.from(seen.values());
    
    const itemQuery = masterItemSearch.trim().toLowerCase();
    const firmQuery = masterFirmSearch.trim().toLowerCase();
    const urlQuery = masterUrlSearch.trim().toLowerCase();

    if (itemQuery || firmQuery || urlQuery) {
      list = list.filter(lst => {
        const buyerName = buyers.find(b => b.id === lst.buyerId)?.name || "";
        const inventoryItem = allItemsList.find(i => i._id === lst.itemId);
        const firmName = companies.find(c => c.firmCode === lst.firmCode)?.firmName || "";
        
        const matchesItem = !itemQuery || 
          lst.itemName.toLowerCase().includes(itemQuery) || 
          (inventoryItem?.sku && inventoryItem.sku.toLowerCase().includes(itemQuery)) ||
          buyerName.toLowerCase().includes(itemQuery);
          
        const matchesFirm = !firmQuery || 
          lst.firmCode.toLowerCase().includes(firmQuery) || 
          firmName.toLowerCase().includes(firmQuery);
          
        const matchesUrl = !urlQuery || 
          (lst.gemLink && lst.gemLink.toLowerCase().includes(urlQuery));
          
        return matchesItem && matchesFirm && matchesUrl;
      });
    }
    return [...list].sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [listings, masterItemSearch, masterFirmSearch, masterUrlSearch, buyers, allItemsList, companies]);

  // Renders only this many Master List rows at a time.
  const MASTER_PAGE_SIZE = 20;
  const [visibleMasterCount, setVisibleMasterCount] = useState(MASTER_PAGE_SIZE);
  useEffect(() => {
    setVisibleMasterCount(MASTER_PAGE_SIZE);
  }, [masterItemSearch, masterFirmSearch, masterUrlSearch]);
  const visibleMasterListings = useMemo(
    () => filteredMasterListings.slice(0, visibleMasterCount),
    [filteredMasterListings, visibleMasterCount]
  );

  // Pre-calculate rowSpan indexes for visually merging identical items -
  // computed off the currently-visible (paginated) slice only, so a group
  // never appears to merge with rows sitting on a page that isn't rendered.
  const masterRowSpans = useMemo(() => {
    const spans: number[] = [];
    let i = 0;
    while (i < visibleMasterListings.length) {
      let span = 1;
      while (
        i + span < visibleMasterListings.length &&
        visibleMasterListings[i].itemName === visibleMasterListings[i + span].itemName
      ) {
        span++;
      }
      spans[i] = span;
      for (let j = 1; j < span; j++) {
        spans[i + j] = 0;
      }
      i += span;
    }
    return spans;
  }, [visibleMasterListings]);

  // Filtered Sheets for Sheet Library (Search query + Current/Completed filter)
  const filteredSheets = useMemo(() => {
    return sheets.filter(sheet => {
      const q = librarySearchQuery.toLowerCase().trim();
      const matchedOpt = allBuyerOptions.find(b => b.id === sheet.selectedBuyerId || b.name === sheet.selectedBuyerId);
      const buyerName = matchedOpt?.name || sheet.selectedBuyerId || "";

      const matchesQuery = !q ||
        sheet.fileName.toLowerCase().includes(q) ||
        buyerName.toLowerCase().includes(q);

      const matchesStatus =
        sheetStatusFilter === "all" ? true :
        sheetStatusFilter === "completed" ? !!sheet.isCompleted :
        !sheet.isCompleted;

      return matchesQuery && matchesStatus;
    });
  }, [sheets, librarySearchQuery, sheetStatusFilter, allBuyerOptions]);

  // Check Duplicate Rate Warnings - looks up only this item's own listings
  // (via listingsByItemId) instead of scanning the entire Master List.
  const checkDuplicateRateWarning = (itemId: string, currentRate: number, currentFirmCode: string) => {
    if (!itemId || !currentRate) return null;

    const otherListingWithDiffRate = (listingsByItemId.get(itemId) || []).find(lst => lst.rate !== currentRate);

    if (otherListingWithDiffRate) {
      return {
        rate: otherListingWithDiffRate.rate,
        firmCode: otherListingWithDiffRate.firmCode,
        message: `Warning: This item is listed at ₹${otherListingWithDiffRate.rate} in ${otherListingWithDiffRate.firmCode}`
      };
    }
    return null;
  };

  const formatDate = (dateInput: Date | string) => {
    if (!dateInput) return "—";
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "—";
    const day = String(d.getDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[d.getMonth()].toLowerCase();
    const year = String(d.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  };

  // Lookup last quote hint for returning buyer - both lookups now go through
  // the pre-built maps (itemsById, rateHistoryByBuyerAndItemName,
  // listingsByItemId) instead of scanning rateHistory/listings/allItemsList
  // in full for every row on every render.
  const getLastQuotedHint = (itemId: string, buyerId: string) => {
    if (!itemId || !buyerId) return null;

    const itemName = itemsById.get(itemId)?.itemName;
    const matches = (rateHistoryByBuyerAndItemName.get(`${buyerId}::${itemName}`) || [])
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (matches.length > 0) {
      return {
        rate: matches[0].newRate,
        minQty: matches[0].newMinQty,
        date: formatDate(matches[0].timestamp)
      };
    }

    // Fallback to listings created by this buyer
    const listingMatches = (listingsByItemId.get(itemId) || [])
      .filter(lst => lst.buyerId === buyerId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (listingMatches.length > 0) {
      return {
        rate: listingMatches[0].rate,
        minQty: listingMatches[0].minQty,
        date: formatDate(listingMatches[0].date)
      };
    }

    return null;
  };

  // Resolve unmatched item inline
  const saveUnmatchedItem = (rowIndex: number) => {
    if (!newUnmatchedItem.name.trim()) {
      alert("Please enter a valid Item Name.");
      return;
    }
    if (!newUnmatchedItem.firmCode) {
      alert("Please select a Firm.");
      return;
    }

    if (newUnmatchedItem.gemLink && newUnmatchedItem.gemLink.trim() !== "") {
      const trimmedLink = newUnmatchedItem.gemLink.trim();
      // Scoped to this same buyer - the same real GeM product page is
      // legitimately reused across different buyers' own Master List entries
      // (each buyer gets its own listing row), so that alone isn't a duplicate.
      const duplicateLink = listings.find(lst =>
        lst.firmCode === newUnmatchedItem.firmCode &&
        lst.buyerId === selectedBuyerId &&
        lst.gemLink &&
        lst.gemLink.trim() === trimmedLink
      );

      if (duplicateLink) {
        alert(`❌ Duplicate GeM Link! The link is already registered for this firm under item: "${duplicateLink.itemName}".`);
        return;
      }
    }

    const rateVal = parseFloat(newUnmatchedItem.rate);
    const minQtyVal = parseInt(newUnmatchedItem.minQty) || 1;

    if (isNaN(rateVal) || rateVal <= 0) {
      alert("Please enter a valid rate.");
      return;
    }

    // 1. Create dynamic/custom Item
    const nextSkuNum = 1100 + stockItems.length + customItems.length;
    const newCustomItem = {
      _id: "custom_" + Date.now(),
      sku: "S" + nextSkuNum,
      itemName: newUnmatchedItem.name.trim(),
      category: "General",
      unit: "pcs",
      currentStock: 0,
      location: "Console Upload"
    };

    const updatedCustomItems = [...customItems, newCustomItem];
    saveCustomItems(updatedCustomItems);

    // 2. Create Listing Row immediately
    const buyerObj = buyers.find(b => b.id === selectedBuyerId);
    const newListing: FirmItemListing = {
      id: "listing_" + Date.now(),
      firmCode: newUnmatchedItem.firmCode,
      itemId: newCustomItem._id,
      itemName: newCustomItem.itemName,
      gemLink: newUnmatchedItem.gemLink.trim(),
      rate: rateVal,
      availGemStock: 0,
      minQty: minQtyVal,
      status: "Pending",
      buyerId: selectedBuyerId,
      date: new Date().toISOString()
    };

    saveListings([...listings, newListing]);

    // 3. Write initial entry to RateHistory
    const newHistory: RateHistory = {
      id: "hist_" + Date.now(),
      listingId: newListing.id,
      itemName: newCustomItem.itemName,
      buyerId: selectedBuyerId,
      buyerName: buyerObj?.name || "Unknown Buyer",
      oldRate: 0,
      newRate: rateVal,
      oldMinQty: 0,
      newMinQty: minQtyVal,
      reason: "Initial quote (organically added from upload)",
      timestamp: new Date().toISOString()
    };

    saveRateHistory([...rateHistory, newHistory]);

    // 4. Update the UploadedRow mapping in state
    setUploadedRows(prev => prev.map(row => {
      if (row.index === rowIndex) {
        return {
          ...row,
          mappedItemId: newCustomItem._id,
          firmCode: newUnmatchedItem.firmCode,
          gemLink: newUnmatchedItem.gemLink.trim(),
          minQty: minQtyVal,
          rate: rateVal,
          availGemStock: 0
        };
      }
      return row;
    }));

    // Reset resolution states
    setUnmatchedIndex(null);
    setNewUnmatchedItem({
      name: "",
      firmCode: "",
      gemLink: "",
      rate: "",
      minQty: "1"
    });
  };

  // Create-or-update this row's Master List (Stock Update checklist) entry -
  // shared by both "OK Link" and "Update Stock" below. Unlike the old single
  // "Link Row" button, this never toggles a matching entry off - with three
  // explicit buttons there's no ambiguity about intent, so a re-click should
  // never silently unlink. Returns false (and alerts) if required fields are
  // missing, so callers know not to also mark the row completed.
  const upsertMasterListing = (row: UploadedRow): boolean => {
    if (!row.mappedItemId) {
      alert("Please select or create an Item mapping first.");
      return false;
    }
    if (!row.firmCode) {
      alert("Please select a Firm.");
      return false;
    }
    if (!row.rate || row.rate <= 0) {
      alert("Please enter a valid rate/quote amount.");
      return false;
    }

    const matchedItemObj = allItemsList.find(i => i._id === row.mappedItemId);
    const buyerObj = buyers.find(b => b.id === selectedBuyerId);

    // The real identity of a Master List row is "this buyer's copy of this
    // exact GeM product" - normally that's {buyerId, itemId, firmCode}, but
    // this row's locally-picked stock item isn't always the same item the
    // listing was ORIGINALLY created under (e.g. re-imported/re-typed sheets
    // can map the same real product to a differently-named stock entry).
    // The GeM link itself is a stronger, unambiguous identity for the same
    // buyer+firm - if it's already registered, this row IS that listing, so
    // "Update Stock"/"OK Link" should update it in place instead of either
    // creating a confusing second row or refusing to save at all.
    const trimmedLink = row.gemLink ? row.gemLink.trim() : "";
    const existing =
      listings.find(lst =>
        lst.buyerId === selectedBuyerId &&
        lst.itemId === row.mappedItemId &&
        lst.firmCode === row.firmCode &&
        row.mappedItemId &&
        row.firmCode
      ) ||
      (trimmedLink
        ? listings.find(lst =>
            lst.buyerId === selectedBuyerId &&
            lst.firmCode === row.firmCode &&
            lst.gemLink &&
            lst.gemLink.trim() === trimmedLink
          )
        : undefined);

    if (existing) {
      const updatedListings = listings.map(lst =>
        lst.id === existing.id
          ? { ...lst, rate: row.rate, minQty: row.minQty, gemLink: row.gemLink || "", availGemStock: row.availGemStock || 0, status: "Pending" as const }
          : lst
      );
      saveListings(updatedListings);
      return true;
    }

    const newListing: FirmItemListing = {
      id: "listing_" + Date.now() + "_" + row.index,
      firmCode: row.firmCode,
      itemId: row.mappedItemId,
      itemName: matchedItemObj?.itemName || row.originalName,
      gemLink: row.gemLink || "",
      rate: row.rate,
      availGemStock: row.availGemStock || 0,
      minQty: row.minQty || 1,
      status: "Pending",
      buyerId: selectedBuyerId,
      date: new Date().toISOString()
    };

    saveListings([...listings, newListing]);

    const newHistory: RateHistory = {
      id: "hist_" + Date.now() + "_" + row.index,
      listingId: newListing.id,
      itemName: matchedItemObj?.itemName || row.originalName,
      buyerId: selectedBuyerId,
      buyerName: buyerObj?.name || "Unknown Buyer",
      oldRate: 0,
      newRate: row.rate,
      oldMinQty: 0,
      newMinQty: row.minQty || 1,
      reason: "Initial Upload Quote",
      timestamp: new Date().toISOString()
    };

    saveRateHistory([...rateHistory, newHistory]);
    return true;
  };

  const setRowCompleted = (rowIndex: number, completed: boolean) => {
    setUploadedRows(prev => prev.map(r => {
      if (r.index !== rowIndex) return r;
      return {
        ...r,
        isCompleted: completed,
        completedBy: completed ? (currentUsername || "Unknown") : undefined,
        completedAt: completed ? new Date().toISOString() : undefined,
      };
    }));
  };

  // "GeM Link Not Available" - this item genuinely has no listing on GeM to
  // link to, so it can never be actioned via OK Link/Update Stock/New Link.
  // Pulls it out of Uncompleted into its own Not Available tab (still shows
  // in All) instead of leaving it stuck in Uncompleted forever. Mutually
  // exclusive with isCompleted - marking one clears the other.
  const toggleRowNotAvailable = (rowIndex: number) => {
    setUploadedRows(prev => prev.map(r => {
      if (r.index !== rowIndex) return r;
      const nowNotAvailable = !r.notAvailable;
      return {
        ...r,
        notAvailable: nowNotAvailable,
        notAvailableBy: nowNotAvailable ? (currentUsername || "Unknown") : undefined,
        notAvailableAt: nowNotAvailable ? new Date().toISOString() : undefined,
        isCompleted: nowNotAvailable ? false : r.isCompleted,
        completedBy: nowNotAvailable ? undefined : r.completedBy,
        completedAt: nowNotAvailable ? undefined : r.completedAt,
        // Marking it Not Available means there's genuinely nothing to link to,
        // so Firm/Rate/Stock/Min Qty/GeM Link would all be stale/meaningless
        // leftovers - clear them back to the same blank state a fresh row starts at.
        ...(nowNotAvailable
          ? { firmCode: "", rate: 0, availGemStock: 0, minQty: 1, gemLink: "" }
          : {}),
      };
    }));
  };

  // Append-only record of every row action for the Summary dashboard's GeM
  // Sync report - fire-and-forget, never blocks the actual action on it.
  const logGemAction = (type: "ok_link" | "update_stock" | "new_link", row: UploadedRow, itemName: string) => {
    fetch("/api/gem-sync?action=log_gem_action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        itemName,
        firmCode: row.firmCode,
        requiredQty: row.qty,
        rate: row.rate,
        by: currentUsername,
        sheetFileName: fileName,
      }),
    }).catch(err => console.error("Failed to log GeM action", err));
  };

  // "OK LINK" - the mapping/rate/firm already showing in the row is correct
  // as-is, nothing more to decide. Links it into the Stock Update checklist
  // and marks the row done in one click (previously two separate clicks).
  const handleOkLink = (row: UploadedRow) => {
    if (!upsertMasterListing(row)) return;
    setRowCompleted(row.index, true);
    logGemAction("ok_link", row, allItemsList.find(i => i._id === row.mappedItemId)?.itemName || row.originalName);
  };

  // "UPDATE STOCK" - only enabled once the row's Rate/Stock/Min Qty (edited
  // directly in their columns) differ from what's already stored on this
  // item's existing Master List entry - pushes that revision through.
  const handleUpdateStock = (row: UploadedRow) => {
    if (!upsertMasterListing(row)) return;
    setRowCompleted(row.index, true);
    logGemAction("update_stock", row, allItemsList.find(i => i._id === row.mappedItemId)?.itemName || row.originalName);
  };

  // "ADD NEW LINK" - this firm has no GeM listing for this item at all yet,
  // so there's nothing to link into the Master List. Pushes a checklist
  // entry instead, tracking what needs to be freshly listed on GeM.
  const handleAddNewLink = (row: UploadedRow) => {
    if (!row.firmCode) {
      alert("Please select a Firm first.");
      return;
    }
    const matchedItemObj = row.mappedItemId ? allItemsList.find(i => i._id === row.mappedItemId) : null;
    const origRow = originalExcelData[row.index] || {};
    const spec = origRow["Specification"] || origRow["specification"] || origRow["Spec"] || origRow["spec"] || "";
    const remark = origRow["Remark"] || origRow["remark"] || "";
    const unit = origRow["Unit"] || origRow["unit"] || "";

    const newEntry: NewLinkChecklistEntry = {
      id: "newlink_" + Date.now() + "_" + row.index,
      firmCode: row.firmCode,
      itemName: matchedItemObj?.itemName || row.originalName,
      spec: spec || undefined,
      remark: remark || undefined,
      requiredQty: row.qty,
      unit: unit || undefined,
      rate: row.rate || undefined,
      mappedItemId: row.mappedItemId || undefined,
      // The GeM product this row was already mapped to on the sheet - for a
      // new upload that link is the marketplace listing to create our own
      // offer against, so it comes across as-is instead of being re-typed.
      gemLink: row.gemLink ? row.gemLink.trim() : undefined,
      minQty: row.minQty || 1,
      availGemStock: row.availGemStock || 0,
      buyerId: selectedBuyerId,
      status: "Pending",
      date: new Date().toISOString()
    };

    saveNewLinkChecklist([...newLinkChecklist, newEntry]);
    setRowCompleted(row.index, true);
    logGemAction("new_link", row, newEntry.itemName);
    alert("✓ Added to New Upload Link checklist.");
  };

  const toggleNewLinkStatus = (id: string) => {
    saveNewLinkChecklist(newLinkChecklist.map(e => e.id === id ? { ...e, status: (e.status === "Synced" ? "Pending" : "Synced") as "Synced" | "Pending" } : e));
  };

  const handleDeleteNewLinkEntry = (id: string) => {
    if (!confirm("Delete this entry from the New Upload Link checklist?")) return;
    saveNewLinkChecklist(newLinkChecklist.filter(e => e.id !== id));
  };

  // Same Revise dialog Stock Update rows get, against a checklist entry
  // instead of a listing - the numbers arrive from the sheet, this is where
  // they get corrected before the entry graduates into the Master List.
  const handleOpenNewLinkRevision = (entry: NewLinkChecklistEntry) => {
    setNewLinkRevisionEntry(entry);
    setNewLinkRateValue(entry.rate ? String(entry.rate) : "");
    setNewLinkMinQtyValue(String(entry.minQty || 1));
    setNewLinkStockValue(String(entry.availGemStock || 0));
    setNewLinkGemLinkValue(entry.gemLink || "");
  };

  const handleSaveNewLinkRevision = () => {
    if (!newLinkRevisionEntry) return;

    const rateVal = parseFloat(newLinkRateValue);
    if (isNaN(rateVal) || rateVal <= 0) {
      alert("Please enter a valid rate.");
      return;
    }
    const minQtyVal = parseInt(newLinkMinQtyValue) || 1;
    const stockVal = parseInt(newLinkStockValue) || 0;
    const linkVal = newLinkGemLinkValue.trim();

    // Same duplicate rule handleSaveRevision applies to the Master List: one
    // product page per buyer+firm, across both checklists.
    if (linkVal) {
      const dupListing = listings.find(lst =>
        lst.firmCode === newLinkRevisionEntry.firmCode &&
        lst.buyerId === newLinkRevisionEntry.buyerId &&
        lst.gemLink &&
        lst.gemLink.trim() === linkVal
      );
      if (dupListing) {
        alert(`❌ Duplicate GeM Link! Ye link is firm ki Stock Update checklist me already hai - item: "${dupListing.itemName}".`);
        return;
      }
      const dupEntry = newLinkChecklist.find(e =>
        e.id !== newLinkRevisionEntry.id &&
        e.firmCode === newLinkRevisionEntry.firmCode &&
        e.buyerId === newLinkRevisionEntry.buyerId &&
        e.gemLink &&
        e.gemLink.trim() === linkVal
      );
      if (dupEntry) {
        alert(`❌ Duplicate GeM Link! Ye link isi checklist me already hai - item: "${dupEntry.itemName}".`);
        return;
      }
    }

    saveNewLinkChecklist(newLinkChecklist.map(e =>
      e.id === newLinkRevisionEntry.id
        ? { ...e, rate: rateVal, minQty: minQtyVal, availGemStock: stockVal, gemLink: linkVal }
        : e
    ));
    setNewLinkRevisionEntry(null);
  };

  // "PUSH TO STOCK" - the new listing now genuinely exists on GeM (its URL is
  // saved on this row), so the entry graduates out of this to-do checklist
  // into the real Master List / Stock Update checklist, landing there exactly
  // as it would have if it had been linked from the Requirement Mapping
  // Console in the first place.
  const handlePushNewLinkToStock = (entry: NewLinkChecklistEntry) => {
    const link = (entry.gemLink || "").trim();
    if (!link) {
      alert("Is row par GeM Product URL hai hi nahi - 'Revise Rate' se link daalo, ya sheet me GeM Link bharke dobara 'Add New Link' karo.");
      return;
    }
    if (!entry.mappedItemId) {
      alert("Ye entry kisi inventory item se mapped nahi hai - Requirement Mapping Console me item map karke dobara 'Add New Link' karo.");
      return;
    }
    const rateVal = Number(entry.rate) || 0;
    if (rateVal <= 0) {
      alert("Rate blank hai - pehle 'Revise' se rate bharo, phir push karo.");
      return;
    }

    const dupListing = listings.find(lst =>
      lst.firmCode === entry.firmCode &&
      lst.buyerId === entry.buyerId &&
      lst.gemLink &&
      lst.gemLink.trim() === link
    );
    if (dupListing) {
      alert(`Ye link is firm ki Stock Update checklist me already hai - item: "${dupListing.itemName}".`);
      return;
    }

    const buyerObj = buyers.find(b => b.id === entry.buyerId);
    const newListing: FirmItemListing = {
      id: "listing_" + Date.now() + "_newlink",
      firmCode: entry.firmCode,
      itemId: entry.mappedItemId,
      itemName: entry.itemName,
      gemLink: link,
      rate: rateVal,
      availGemStock: entry.availGemStock || 0,
      minQty: entry.minQty || 1,
      status: "Pending",
      buyerId: entry.buyerId,
      date: new Date().toISOString()
    };
    saveListings([...listings, newListing]);

    const newHistory: RateHistory = {
      id: "hist_" + Date.now(),
      listingId: newListing.id,
      itemName: newListing.itemName,
      buyerId: entry.buyerId,
      buyerName: buyerObj?.name || "Unknown Buyer",
      oldRate: 0,
      newRate: rateVal,
      oldMinQty: 0,
      newMinQty: newListing.minQty,
      reason: "New GeM listing created (New Upload Link)",
      timestamp: new Date().toISOString()
    };
    saveRateHistory([...rateHistory, newHistory]);

    saveNewLinkChecklist(newLinkChecklist.map(e =>
      e.id === entry.id
        ? { ...e, status: "Synced" as const, pushedListingId: newListing.id }
        : e
    ));

    alert("✓ Stock Update checklist me add ho gaya - Revise Rate / Sync to GeM ab wahan se chalega.");
  };

  // Excel Download logic
  const handleDownloadFilledExcel = () => {
    if (uploadedRows.length === 0) {
      alert("No data available to download. Please upload a sheet first.");
      return;
    }

    const filledData = originalExcelData.map((row, index) => {
      const mappedRow = uploadedRows.find(r => r.index === index);
      const matchedListing = listings.find(lst =>
        lst.buyerId === selectedBuyerId &&
        lst.itemId === mappedRow?.mappedItemId
      );

      const firmCode = matchedListing?.firmCode || mappedRow?.firmCode || "";
      const company = companies.find(c => c.firmCode?.toUpperCase() === firmCode.toUpperCase());
      const sellerRegisterAddress = company?.sellerRegisterAddress || "";
      const mappedFirmName = company?.firmName || firmCode;

      return {
        ...row,
        "Quoted Rate (₹)": matchedListing?.rate || mappedRow?.rate || "",
        "Seller Register Address": sellerRegisterAddress,
        "Mapped Firm": mappedFirmName,
        "GeM Link": matchedListing?.gemLink || mappedRow?.gemLink || ""
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(filledData);

    // Apply styles to Mapped Firm column for linked items
    if (filledData.length > 0) {
      const keys = Object.keys(filledData[0] || {});
      const mappedFirmColIndex = keys.indexOf("Mapped Firm");
      if (mappedFirmColIndex !== -1) {
        const colLetter = XLSX.utils.encode_col(mappedFirmColIndex);
        
        filledData.forEach((row, index) => {
          const mappedFirmVal = row["Mapped Firm"];
          const hasFirm = !!mappedFirmVal && String(mappedFirmVal).trim() !== "";
          
          if (hasFirm) {
            const cellRef = `${colLetter}${index + 2}`; // Excel rows are 1-based, header is row 1
            if (worksheet[cellRef]) {
              worksheet[cellRef].s = {
                fill: {
                  patternType: "solid",
                  fgColor: { rgb: "C6EFCE" } // Soft Excel light green background
                },
                font: {
                  color: { rgb: "006100" }, // Dark green text
                  bold: true
                }
              };
            }
          }
        });
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Quoted Requirements");
    XLSXStyle.writeFile(workbook, `Filled_${fileName || "Requirement"}.xlsx`);
  };

  // Rate Revision logic
  const handleOpenRevision = (listing: FirmItemListing) => {
    setSelectedListingForRevision(listing);
    setNewRateValue(String(listing.rate));
    setNewMinQtyValue(String(listing.minQty));
    setNewGemLinkValue(listing.gemLink || "");
    setNewAvailGemStockValue(String(listing.availGemStock || 0));
    setRevisionReason("negotiated revision");
    setIsRevisionOpen(true);
  };

  const handleSaveRevision = () => {
    if (!selectedListingForRevision) return;

    const rateVal = parseFloat(newRateValue);
    const minQtyVal = parseInt(newMinQtyValue) || 1;
    const availStockVal = parseInt(newAvailGemStockValue) || 0;

    if (isNaN(rateVal) || rateVal <= 0) {
      alert("Please enter a valid rate.");
      return;
    }

    const buyerObj = buyers.find(b => b.id === selectedListingForRevision.buyerId);

    if (newGemLinkValue && newGemLinkValue.trim() !== "") {
      const trimmedLink = newGemLinkValue.trim();
      // Scoped to this same buyer - the same real GeM product page is
      // legitimately reused across different buyers' own Master List entries
      // (each buyer gets its own listing row), so that alone isn't a duplicate.
      const duplicateLink = listings.find(lst =>
        lst.firmCode === selectedListingForRevision.firmCode &&
        lst.buyerId === selectedListingForRevision.buyerId &&
        lst.gemLink &&
        lst.gemLink.trim() === trimmedLink &&
        lst.id !== selectedListingForRevision.id
      );

      if (duplicateLink) {
        alert(`❌ Duplicate GeM Link! The link is already registered for this firm under item: "${duplicateLink.itemName}".`);
        return;
      }
    }

    // Update listings
    const updatedListings = listings.map(lst => {
      if (lst.id === selectedListingForRevision.id) {
        return {
          ...lst,
          rate: rateVal,
          minQty: minQtyVal,
          gemLink: newGemLinkValue.trim(),
          availGemStock: availStockVal,
          status: "Pending" as const // Flag checklist as pending again
        };
      }
      return lst;
    });

    saveListings(updatedListings);

    // Log to RateHistory
    const newHistory: RateHistory = {
      id: "hist_" + Date.now(),
      listingId: selectedListingForRevision.id,
      itemName: selectedListingForRevision.itemName,
      buyerId: selectedListingForRevision.buyerId,
      buyerName: buyerObj?.name || "Unknown Buyer",
      oldRate: selectedListingForRevision.rate,
      newRate: rateVal,
      oldMinQty: selectedListingForRevision.minQty,
      newMinQty: minQtyVal,
      reason: revisionReason.trim() || "negotiated revision",
      timestamp: new Date().toISOString()
    };

    saveRateHistory([...rateHistory, newHistory]);

    setIsRevisionOpen(false);
    setSelectedListingForRevision(null);
    alert("✓ Rate revision updated and history logged!");
  };

  // Toggle synced checkmark in per-firm sync checklist
  const toggleSyncStatus = (listingId: string) => {
    const updatedListings = listings.map(lst => {
      if (lst.id === listingId) {
        return {
          ...lst,
          status: (lst.status === "Synced" ? "Pending" : "Synced") as "Synced" | "Pending"
        };
      }
      return lst;
    });
    saveListings(updatedListings);
  };

  // Sync Checklist's "Sync" button needs GeM's own Product ID to find the
  // right listing on GeM's side. Normally that's gemCatalogueId (set only via
  // "Add to Master List" exact-match). As a fallback for listings that never
  // went through that flow but do have a gemLink someone pasted in by hand
  // (e.g. .../p-5116877-80326758773-cat.html), the same Product ID is parsed
  // straight out of that URL - not a guess, just reading the id a human
  // already confirmed belongs to this exact item.
  const extractProductIdFromGemLink = (gemLink: string): string => {
    const match = gemLink.match(/\/p-([^/]+?)-cat\.html/i);
    return match ? match[1] : "";
  };

  const handleSyncToGem = async (lst: FirmItemListing) => {
    const productId = lst.gemCatalogueId || (lst.gemLink ? extractProductIdFromGemLink(lst.gemLink) : "");
    if (!productId) {
      alert("Ye listing GeM Catalogue se 'Add to Master List' ke through link nahi hui aur gemLink me se bhi Product ID nahi mila - is button se sync nahi ho sakta. Manually GeM par update karo.");
      return;
    }
    const cred = gemCredentials.find(c => c.firmCode === lst.firmCode);
    if (!cred || !cred.gemUserId || !cred.gemPassword) {
      alert(`"${lst.firmCode}" firm ke GeM login credentials "GeM Login Setup" me save nahi hai - pehle wahan save karo.`);
      return;
    }

    setSyncingListingId(lst.id);
    try {
      await triggerGemCatalogueUpdate({
        gemUserId: cred.gemUserId,
        gemPassword: cred.gemPassword,
        gemMailId: cred.gemMailId,
        firmCode: lst.firmCode,
        productId,
        newRate: lst.rate,
        newStock: lst.availGemStock,
        newMinQty: lst.minQty,
        listingId: lst.id,
      });
      alert("✓ GeM tab khul gaya, automation shuru ho gayi. Captcha bharna hoga - baaki khud ho jayega. Poora hone par yeh row apne aap Synced ho jayegi.");
    } catch (err: any) {
      alert("Extension trigger nahi hua: " + err.message);
    } finally {
      setSyncingListingId(null);
    }
  };

  const handleDeleteListing = (listingId: string) => {
    if (!confirm("Are you sure you want to delete this listing from the sync checklist?")) return;
    const updatedListings = listings.filter(lst => lst.id !== listingId);
    saveListings(updatedListings);
  };

  const uncompletedRowsCount = useMemo(() => uploadedRows.filter(r => !r.isCompleted && !r.notAvailable).length, [uploadedRows]);
  const completedRowsCount = useMemo(() => uploadedRows.filter(r => r.isCompleted).length, [uploadedRows]);
  const notAvailableRowsCount = useMemo(() => uploadedRows.filter(r => r.notAvailable).length, [uploadedRows]);

  // Firm-wise total value report for the currently loaded sheet - Qty x Rate
  // summed per firm across the WHOLE sheet (not just the current Uncompleted/
  // Completed filter view), so this always reflects the full upload.
  const firmWiseTotals = useMemo(() => {
    const totals = new Map<string, number>();
    uploadedRows.forEach(row => {
      const key = row.firmCode || "Unassigned";
      const value = (Number(row.qty) || 0) * (Number(row.rate) || 0);
      totals.set(key, (totals.get(key) || 0) + value);
    });
    return Array.from(totals.entries())
      .map(([firmCode, total]) => ({
        firmCode,
        firmName: companies.find(c => c.firmCode === firmCode)?.firmName || "",
        total
      }))
      .sort((a, b) => b.total - a.total);
  }, [uploadedRows, companies]);

  const sheetGrandTotal = useMemo(() => firmWiseTotals.reduce((sum, f) => sum + f.total, 0), [firmWiseTotals]);

  const toggleRowCompleted = (rowIndex: number) => {
    setUploadedRows(prev => prev.map(r => {
      if (r.index !== rowIndex) return r;
      const nowCompleted = !r.isCompleted;
      return {
        ...r,
        isCompleted: nowCompleted,
        completedBy: nowCompleted ? (currentUsername || "Unknown") : undefined,
        completedAt: nowCompleted ? new Date().toISOString() : undefined,
      };
    }));
  };

  const filteredUploadedRows = useMemo(() => {
    if (mappingStatusFilter === "all") return uploadedRows;
    if (mappingStatusFilter === "not_available") return uploadedRows.filter(row => !!row.notAvailable);
    if (mappingStatusFilter === "completed") return uploadedRows.filter(row => !!row.isCompleted);
    return uploadedRows.filter(row => !row.isCompleted && !row.notAvailable);
  }, [uploadedRows, mappingStatusFilter]);

  // Renders only this many rows at a time - a 200+ row sheet rendering all
  // at once (each with its own inventory-search datalist, Quick Fill chips,
  // etc.) is what made the Requirement Mapping Console slow to begin with.
  const ROWS_PAGE_SIZE = 20;
  const [visibleRowCount, setVisibleRowCount] = useState(ROWS_PAGE_SIZE);
  useEffect(() => {
    setVisibleRowCount(ROWS_PAGE_SIZE);
  }, [mappingStatusFilter, activeSheetId]);

  // GeM Link column sort toggle: "blankFirst" groups every row with no GeM
  // Link at the top in one go (so missing links are easy to spot/fill),
  // "filledFirst" flips it to group the ones that already have a link at the
  // top instead - Array.sort is stable, so rows within each group keep their
  // original relative order.
  const [gemLinkSortMode, setGemLinkSortMode] = useState<"none" | "blankFirst" | "filledFirst">("none");
  const toggleGemLinkSort = () => {
    setGemLinkSortMode(prev => (prev === "blankFirst" ? "filledFirst" : "blankFirst"));
  };
  const sortedUploadedRows = useMemo(() => {
    if (gemLinkSortMode === "none") return filteredUploadedRows;
    const isBlank = (r: UploadedRow) => !r.gemLink || !r.gemLink.trim();
    return [...filteredUploadedRows].sort((a, b) => {
      const aBlank = isBlank(a);
      const bBlank = isBlank(b);
      if (aBlank === bBlank) return 0;
      if (gemLinkSortMode === "blankFirst") return aBlank ? -1 : 1;
      return aBlank ? 1 : -1;
    });
  }, [filteredUploadedRows, gemLinkSortMode]);

  const visibleUploadedRows = useMemo(
    () => sortedUploadedRows.slice(0, visibleRowCount),
    [sortedUploadedRows, visibleRowCount]
  );

  return (
    <BlockGuard permission="gemLinks">
      <div className="p-3 md:p-5 bg-[#f3f6f9] min-h-screen text-[var(--gem-text-primary)] font-sans">
        <div className="w-full mx-auto">

          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
            <div className="flex items-center gap-3">
              <Link href="/dashboard" className="flex items-center justify-center w-8 h-8 rounded-lg bg-white border border-slate-200 shadow-sm hover:text-blue-600 transition-all text-slate-500 active:scale-95">
                <FiArrowLeft size={15} />
              </Link>
              <div>
                <h1 className="text-lg font-black uppercase tracking-tight text-slate-800">GeM Sync Console</h1>
                <p className="text-blue-600 text-[9px] font-black tracking-widest uppercase">Revised Rates & Client Sync Log</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openMasterRateModal}
                className="flex items-center gap-1.5 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-xl font-black uppercase text-[11px] hover:bg-slate-50 hover:scale-105 active:scale-95 transition-all shadow-sm"
              >
                <FiEdit size={12} /> Master Rate Sheet
              </button>
              <button
                onClick={() => setIsAddItemModalOpen(true)}
                title="Add New Item (Ctrl/Cmd+Shift+A)"
                className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-xl font-black uppercase text-[11px] hover:bg-blue-700 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-blue-100"
              >
                <FiPlus size={12} /> Add New Item
              </button>
            </div>
          </div>

          {/* Action Tabs - Styled exactly like the horizontal tab bar on the Orders page */}
          <div className="flex overflow-x-auto gap-1 no-scrollbar border-b border-slate-200 w-full mb-4">
            <button
              onClick={() => setActiveTab("sheets")}
              className={`px-3.5 py-1.5 rounded-t-lg text-[11px] font-black tracking-wide transition-all whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === "sheets"
                  ? "bg-slate-900 text-white shadow-md"
                  : "bg-slate-50 text-slate-500 hover:bg-slate-200"
              }`}
            >
              <FiDatabase /> Sheet Library
              <div className="relative group flex items-center ml-1">
                <FiInfo size={12} className="text-slate-400 hover:text-slate-700 transition-colors cursor-help" />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 w-44 bg-[var(--gem-card)] border border-[var(--gem-border)] p-2 rounded-lg shadow-2xl text-[9px] font-black text-[var(--gem-text-primary)] normal-case leading-normal text-center select-none pointer-events-none">
                  View, resume, or delete previously saved Excel worksheets.
                  <div className="w-1.5 h-1.5 absolute top-full left-1/2 -translate-x-1/2 -mt-1 rotate-45 bg-[var(--gem-card)] border-r border-b border-[var(--gem-border)]"></div>
                </div>
              </div>
            </button>
            <button
              onClick={() => setActiveTab("upload")}
              className={`px-3.5 py-1.5 rounded-t-lg text-[11px] font-black tracking-wide transition-all whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === "upload"
                  ? "bg-slate-900 text-white shadow-md"
                  : "bg-slate-50 text-slate-500 hover:bg-slate-200"
              }`}
            >
              <FiUploadCloud /> Upload Sheet
              <div className="relative group flex items-center ml-1">
                <FiInfo size={12} className="text-slate-400 hover:text-slate-700 transition-colors cursor-help" />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 w-44 bg-[var(--gem-card)] border border-[var(--gem-border)] p-2 rounded-lg shadow-2xl text-[9px] font-black text-[var(--gem-text-primary)] normal-case leading-normal text-center select-none pointer-events-none">
                  Upload client Excel sheets to map requirements to live stock.
                  <div className="w-1.5 h-1.5 absolute top-full left-1/2 -translate-x-1/2 -mt-1 rotate-45 bg-[var(--gem-card)] border-r border-b border-[var(--gem-border)]"></div>
                </div>
              </div>
            </button>
            <button
              onClick={() => setActiveTab("checklist")}
              className={`px-3.5 py-1.5 rounded-t-lg text-[11px] font-black tracking-wide transition-all whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === "checklist"
                  ? "bg-slate-900 text-white shadow-md"
                  : "bg-slate-50 text-slate-500 hover:bg-slate-200"
              }`}
            >
              <FiCheckCircle /> Sync Checklist
              <div className="relative group flex items-center ml-1">
                <FiInfo size={12} className="text-slate-400 hover:text-slate-700 transition-colors cursor-help" />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 w-44 bg-[var(--gem-card)] border border-[var(--gem-border)] p-2 rounded-lg shadow-2xl text-[9px] font-black text-[var(--gem-text-primary)] normal-case leading-normal text-center select-none pointer-events-none">
                  Track item sync statuses and perform rate revisions for firms.
                  <div className="w-1.5 h-1.5 absolute top-full left-1/2 -translate-x-1/2 -mt-1 rotate-45 bg-[var(--gem-card)] border-r border-b border-[var(--gem-border)]"></div>
                </div>
              </div>
            </button>
            <button
              onClick={() => setActiveTab("master")}
              className={`px-3.5 py-1.5 rounded-t-lg text-[11px] font-black tracking-wide transition-all whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === "master"
                  ? "bg-slate-900 text-white shadow-md"
                  : "bg-slate-50 text-slate-500 hover:bg-slate-200"
              }`}
            >
              <FiList /> Master List
              <div className="relative group flex items-center ml-1">
                <FiInfo size={12} className="text-slate-400 hover:text-slate-700 transition-colors cursor-help" />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 w-44 bg-[var(--gem-card)] border border-[var(--gem-border)] p-2 rounded-lg shadow-2xl text-[9px] font-black text-[var(--gem-text-primary)] normal-case leading-normal text-center select-none pointer-events-none">
                  Consolidated directory of all matched and mapped items.
                  <div className="w-1.5 h-1.5 absolute top-full left-1/2 -translate-x-1/2 -mt-1 rotate-45 bg-[var(--gem-card)] border-r border-b border-[var(--gem-border)]"></div>
                </div>
              </div>
            </button>
            <Link
              href="/dashboard/gem-sync/catalogue"
              className="px-3.5 py-1.5 rounded-t-lg text-[11px] font-black tracking-wide transition-all whitespace-nowrap flex items-center gap-1.5 bg-slate-50 text-slate-500 hover:bg-slate-200"
            >
              <FiLink /> GeM Catalogue
              <div className="relative group flex items-center ml-1">
                <FiInfo size={12} className="text-slate-400 hover:text-slate-700 transition-colors cursor-help" />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 w-52 bg-[var(--gem-card)] border border-[var(--gem-border)] p-2 rounded-lg shadow-2xl text-[9px] font-black text-[var(--gem-text-primary)] normal-case leading-normal text-center select-none pointer-events-none">
                  Opens on its own page now — it was the slowest thing to load here, and most visits never needed it.
                  <div className="w-1.5 h-1.5 absolute top-full left-1/2 -translate-x-1/2 -mt-1 rotate-45 bg-[var(--gem-card)] border-r border-b border-[var(--gem-border)]"></div>
                </div>
              </div>
            </Link>
          </div>

          {/* =================== TAB 1: UPLOAD & MAP SHEET =================== */}
          {activeTab === "upload" && (
            <div className="space-y-3">

              {/* Excel Upload Card (Full width) */}
              <div className="bg-[var(--gem-card)] p-3.5 rounded-xl border border-[var(--gem-border)] shadow-xl flex flex-col justify-between gap-2.5 gem-sync-card">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
                  <div>
                    <h3 className="text-[11px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest flex items-center gap-1.5 mb-1">
                      <FiUploadCloud className="text-blue-500" size={13} /> Upload Excel File
                    </h3>
                    <p className="text-[var(--gem-text-secondary)] text-[10px]">
                      Client's Excel with <b>item name</b>, <b>specification</b>, <b>quantity</b>, <b>unit</b>, <b>remark</b> columns.
                    </p>
                  </div>

                  {uploadedRows.length > 0 && (
                    <div className="flex bg-[var(--gem-table-header)] p-0.5 rounded-lg border border-[var(--gem-border)] shrink-0">
                      <button
                        type="button"
                        onClick={() => setMappingStatusFilter("uncompleted")}
                        className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                          mappingStatusFilter === "uncompleted"
                            ? "bg-blue-600 text-white shadow-md"
                            : "text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)]"
                        }`}
                      >
                        Uncompleted ({uncompletedRowsCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setMappingStatusFilter("completed")}
                        className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                          mappingStatusFilter === "completed"
                            ? "bg-emerald-600 text-white shadow-md"
                            : "text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)]"
                        }`}
                      >
                        Completed ({completedRowsCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setMappingStatusFilter("not_available")}
                        className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                          mappingStatusFilter === "not_available"
                            ? "bg-rose-600 text-white shadow-md"
                            : "text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)]"
                        }`}
                      >
                        Not Available ({notAvailableRowsCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setMappingStatusFilter("all")}
                        className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                          mappingStatusFilter === "all"
                            ? "bg-[var(--gem-table-header)] text-[var(--gem-text-primary)] shadow-md"
                            : "text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)]"
                        }`}
                      >
                        All ({uploadedRows.length})
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-2 items-center">
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleExcelUpload}
                    className="hidden"
                    ref={fileInputRef}
                  />

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full sm:w-auto flex items-center justify-center gap-1.5 py-2 px-3.5 rounded-lg font-black text-[10px] uppercase tracking-wider transition-all border bg-[var(--gem-table-header)] text-[var(--gem-text-primary)] border-[var(--gem-border)] hover:bg-[var(--gem-table-row-hover)] cursor-pointer"
                  >
                    <FiUploadCloud size={13} /> {fileName ? "Change Sheet" : "Choose Excel Sheet"}
                  </button>

                  <button
                    onClick={() => setShowBuildSheetModal(true)}
                    className="w-full sm:w-auto flex items-center justify-center gap-1.5 py-2 px-3.5 rounded-lg font-black text-[10px] uppercase tracking-wider transition-all border bg-[var(--gem-table-header)] text-[var(--gem-text-primary)] border-[var(--gem-border)] hover:bg-[var(--gem-table-row-hover)] cursor-pointer"
                  >
                    <FiPlus size={13} /> Build From Scratch
                  </button>

                  {fileName && uploadedRows.length > 0 && (
                    <div className="flex items-center gap-1 py-1 px-1.5 rounded-lg border border-[var(--gem-border)] bg-[var(--gem-table-header)]">
                      <select
                        value={selectedRateType}
                        onChange={(e) => setSelectedRateType(e.target.value as RateType)}
                        className="bg-transparent text-[10px] font-black uppercase text-[var(--gem-text-primary)] focus:outline-none py-1 px-1"
                      >
                        <option value="A">Rate A</option>
                        <option value="B">Rate B</option>
                        <option value="C">Rate C</option>
                        <option value="D">Rate D</option>
                      </select>
                      <button
                        onClick={() => {
                          if (confirm(`Apply Rate ${selectedRateType} to every matched row in this sheet? This overwrites the Rate column wherever a Rate ${selectedRateType} is set in the Master Rate Sheet.`)) {
                            applyMasterRateToSheet(selectedRateType);
                          }
                        }}
                        title="Fill this sheet's Rate column from the Master Rate Sheet, using the selected rate type"
                        className="flex items-center gap-1 py-1 px-2.5 rounded-md font-black text-[10px] uppercase tracking-wider bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                      >
                        Apply Rate
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Push this sheet's rates into the Master Rate Sheet? An item with one rate in this sheet goes into Rate ${selectedRateType}; an item with multiple different rates auto-sorts them ascending into Rate A-D instead.`)) {
                            pushSheetRatesToMaster(selectedRateType);
                          }
                        }}
                        title="Push rates typed in this sheet back into the Master Rate Sheet"
                        className="flex items-center gap-1 py-1 px-2.5 rounded-md font-black text-[10px] uppercase tracking-wider bg-teal-600 text-white hover:bg-teal-700 transition-colors"
                      >
                        Push to Master
                      </button>
                    </div>
                  )}

                  {fileName && (
                    <button
                      onClick={handleClearSheet}
                      className="w-full sm:w-auto flex items-center justify-center gap-1.5 py-2 px-3.5 rounded-lg font-black text-[10px] uppercase tracking-wider transition-all border bg-red-50 text-red-600 border-red-200 hover:bg-red-100 cursor-pointer"
                    >
                      Clear Sheet
                    </button>
                  )}

                  {fileName && uploadedRows.length > 0 && (
                    <button
                      onClick={handleSaveToLibrary}
                      disabled={savingToLibrary}
                      title="Save this upload to the Sheet Library right now, instead of waiting on auto-save"
                      className="w-full sm:w-auto flex items-center justify-center gap-1.5 py-2 px-3.5 rounded-lg font-black text-[10px] uppercase tracking-wider transition-all border bg-blue-600 text-white border-blue-600 hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                    >
                      <FiUploadCloud size={13} /> {savingToLibrary ? "Saving..." : "Save to Library"}
                    </button>
                  )}

                  {fileName && (
                    <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 py-1 px-2.5 rounded-lg border border-emerald-200 truncate max-w-xs">
                      ✓ {fileName} ({uploadedRows.length} rows)
                    </span>
                  )}

                  {saveToLibraryStatus && (
                    <span
                      className={`text-[10px] font-bold py-1 px-2.5 rounded-lg border truncate max-w-xs ${
                        saveToLibraryStatus.startsWith("Failed")
                          ? "text-red-700 bg-red-50 border-red-200"
                          : "text-emerald-700 bg-emerald-50 border-emerald-200"
                      }`}
                    >
                      {saveToLibraryStatus}
                    </span>
                  )}
                </div>
              </div>

              {/* Firm-wise total value report for this sheet */}
              {uploadedRows.length > 0 && (
                <div className="bg-[var(--gem-card)] p-2 rounded-xl border border-[var(--gem-border)] shadow-xl flex flex-wrap items-center gap-1.5 gem-sync-card">
                  {firmWiseTotals.map(f => (
                    <span
                      key={f.firmCode}
                      title={f.firmName ? `${f.firmCode} - ${f.firmName}` : f.firmCode}
                      className={`text-[10px] font-bold py-1 px-2.5 rounded-lg border ${
                        f.firmCode === "Unassigned"
                          ? "text-amber-700 bg-amber-50 border-amber-200"
                          : "text-[var(--gem-text-primary)] bg-[var(--gem-table-header)] border-[var(--gem-border)]"
                      }`}
                    >
                      {f.firmCode}: ₹{f.total.toLocaleString("en-IN")}
                    </span>
                  ))}
                  <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 py-1 px-2.5 rounded-lg border border-emerald-200 ml-auto">
                    Grand Total: ₹{sheetGrandTotal.toLocaleString("en-IN")}
                  </span>
                </div>
              )}

              {/* Uploaded rows matching table */}
              {uploadedRows.length > 0 && (
                <div className="bg-[var(--gem-card)] rounded-xl border border-[var(--gem-border)] shadow-xl overflow-hidden gem-sync-card">

                  {/* Table title bar */}
                  <div className="p-3 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)] flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                    <div>
                      <h3 className="font-black text-[11px] uppercase tracking-wider text-[var(--gem-text-primary)]">Requirement Mapping Console</h3>
                      <p className="text-[10px] text-[var(--gem-text-secondary)]">Map each row to inventory and pick which Firm handles it.</p>
                    </div>

                    {mappingStatusFilter === "all" && (
                      <button
                        onClick={handleDownloadFilledExcel}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-wider py-1.5 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 shadow-lg"
                      >
                        <FiDownload size={12} /> Download Filled Excel
                      </button>
                    )}
                  </div>

                  {/* Excel Sheet Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] font-black uppercase tracking-wider border-b border-[var(--gem-border)] text-[11px]">
                          <th className="py-2 px-2.5 text-center w-8 min-w-[32px]">#</th>
                          <th className="py-2 px-2.5 w-[210px] min-w-[210px]">Requirement</th>
                          <th className="py-2 px-2.5 text-center w-16 min-w-[64px]">Qty</th>
                          <th className="py-2 px-2.5 w-[280px] min-w-[280px]">Inventory Mapping</th>
                          <th className="py-2 px-2.5 w-[130px] min-w-[130px]">Firm</th>
                          <th className="py-2 px-2.5 w-[85px] min-w-[85px]">Rate (₹)</th>
                          <th className="py-2 px-2.5 w-[80px] min-w-[80px]">Stock</th>
                          <th className="py-2 px-2.5 w-[70px] min-w-[70px]">Min Qty</th>
                          <th className="py-2 px-2.5 w-[150px] min-w-[150px]">
                            <div className="flex items-center gap-1.5">
                              <span>GeM Link</span>
                              <button
                                type="button"
                                onClick={toggleGemLinkSort}
                                title={
                                  gemLinkSortMode === "filledFirst"
                                    ? "Showing filled links first - click to bring blank links to the top"
                                    : "Bring blank GeM Links to the top - click again to show filled links first"
                                }
                                className={`p-1 rounded normal-case transition-colors ${
                                  gemLinkSortMode !== "none"
                                    ? "bg-blue-600 text-white"
                                    : "text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)] hover:bg-[var(--gem-table-row-hover)]"
                                }`}
                              >
                                {gemLinkSortMode === "filledFirst" ? <FiArrowDown size={11} /> : <FiArrowUp size={11} />}
                              </button>
                            </div>
                          </th>
                          <th className="py-2 px-2.5 text-center w-[165px] min-w-[165px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--gem-border)]/60">
                        {filteredUploadedRows.length === 0 && (
                          <tr>
                            <td colSpan={10} className="py-10 text-center text-[var(--gem-text-secondary)] text-xs">
                              {mappingStatusFilter === "completed"
                                ? "No rows linked yet."
                                : mappingStatusFilter === "not_available"
                                ? "No rows marked Not Available."
                                : "🎉 All rows are linked — nothing uncompleted left."}
                            </td>
                          </tr>
                        )}
                        {visibleUploadedRows.map((row) => {
                          const isMatched = !!row.mappedItemId;
                          const mappedItem = itemsById.get(row.mappedItemId);

                          // Extract optional original row fields
                          const origRow = originalExcelData[row.index] || {};
                          const specification = origRow["Specification"] || origRow["specification"] || origRow["Spec"] || origRow["spec"] || "";
                          const unit = origRow["Unit"] || origRow["unit"] || "";
                          const remark = origRow["Remark"] || origRow["remark"] || "";

                          // Duplicate rate warning check
                          const duplicateWarning = checkDuplicateRateWarning(row.mappedItemId, row.rate, row.firmCode);

                          // Returning buyer history hint
                          const lastQuoted = getLastQuotedHint(row.mappedItemId, selectedBuyerId);

                          return (
                            <tr key={row.index} className="hover:bg-[var(--gem-table-row-hover)] transition-colors">

                              <td className="py-2 px-2.5 text-center text-[var(--gem-text-secondary)] font-mono text-xs min-w-[32px]">{row.index + 1}</td>

                              <td className="py-2 px-2.5 w-[210px] min-w-[210px] leading-tight">
                                <span className="font-bold text-[var(--gem-text-primary)] block text-xs">{row.originalName}</span>
                                {specification && <span className="text-[10px] text-[var(--gem-text-secondary)] block"><b>Spec:</b> {specification}</span>}
                                {remark && <span className="text-[10px] text-[var(--gem-text-secondary)] block"><b>Remark:</b> {remark}</span>}
                                {row.rate > 0 && <span className="text-[10px] text-[var(--gem-text-secondary)] block">Orig. Rate: ₹{row.rate}</span>}
                              </td>

                              <td className="py-2 px-2.5 text-center font-mono font-bold text-[var(--gem-text-primary)] text-xs w-16 min-w-[64px]">
                                <div>{row.qty || "—"}</div>
                                {unit && <div className="text-[10px] text-[var(--gem-text-secondary)] font-sans">{unit}</div>}
                              </td>

                              <td className="py-2 px-2.5 w-[280px] min-w-[280px]">
                                <div className="space-y-1.5">
                                  {!isMatched && (
                                    <span className="text-[10px] font-black tracking-wider uppercase text-amber-500 bg-amber-500/10 py-0.5 px-2 rounded-md border border-amber-500/20 inline-flex items-center gap-1">
                                      <FiAlertTriangle size={11} /> New / Unmatched
                                    </span>
                                  )}

                                  <div className="flex gap-1.5">
                                    <input
                                      key={row.mappedItemId}
                                      type="text"
                                      list={`stock-options-${row.index}`}
                                      placeholder="Search or select stock..."
                                      className="bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-xs font-bold text-[var(--gem-text-primary)] rounded-lg py-2 px-2.5 focus:outline-none focus:border-blue-500 flex-1"
                                      defaultValue={mappedItem ? `${mappedItem.sku} - ${mappedItem.itemName}` : ""}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        if (!val) {
                                          setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, mappedItemId: "" } : r));
                                          return;
                                        }
                                        const match = selectableItemsList.find(item =>
                                          `${item.sku} - ${item.itemName}` === val ||
                                          item.itemName === val
                                        );
                                        if (match) {
                                          // Auto-fill from this item's Master List listing - prefer
                                          // one matching the Firm (and Buyer) already chosen on this
                                          // row, since an item is often listed under several firms at
                                          // different rates; falling back to itemId-only otherwise
                                          // picked whichever listing happened to be first regardless
                                          // of firm, silently overwriting an already-chosen Firm with
                                          // the wrong one's numbers.
                                          const itemListings = listingsByItemId.get(match._id) || [];
                                          const matchedListing =
                                            itemListings.find(lst => lst.firmCode === row.firmCode && lst.buyerId === selectedBuyerId) ||
                                            itemListings.find(lst => lst.firmCode === row.firmCode) ||
                                            itemListings[0];
                                          if (matchedListing) {
                                            setUploadedRows(prev => prev.map(r => r.index === row.index ? {
                                              ...r,
                                              mappedItemId: match._id,
                                              firmCode: matchedListing.firmCode,
                                              rate: matchedListing.rate,
                                              availGemStock: matchedListing.availGemStock || 0,
                                              minQty: matchedListing.minQty || 1,
                                              gemLink: matchedListing.gemLink || ""
                                            } : r));
                                          } else {
                                            setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, mappedItemId: match._id } : r));
                                          }
                                        }
                                      }}
                                    />
                                    <datalist id={`stock-options-${row.index}`}>
                                      {selectableItemsList.map((item, idx) => (
                                        <option key={item._id || idx} value={`${item.sku} - ${item.itemName}`} />
                                      ))}
                                    </datalist>

                                    {!isMatched && (
                                      <button
                                        onClick={() => {
                                          setUnmatchedIndex(row.index);
                                          setNewUnmatchedItem({
                                            name: row.originalName,
                                            firmCode: "",
                                            gemLink: "",
                                            rate: String(row.rate || ""),
                                            minQty: "1"
                                          });
                                        }}
                                        className="bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 font-black p-1.5 rounded-lg transition-colors flex items-center justify-center shrink-0"
                                        title="Create item organically"
                                      >
                                        <FiPlus size={12} />
                                      </button>
                                    )}
                                  </div>

                                  {/* Quick Fill Options from Master List - compact single-line chip row */}
                                  {isMatched && (
                                    (() => {
                                      const previousListings = listings.filter(l => l.itemId === row.mappedItemId);
                                      if (previousListings.length > 0) {
                                        return (
                                          <div className="flex items-center gap-1 flex-wrap">
                                            <span className="text-[9px] font-black text-amber-700 uppercase tracking-wider shrink-0">Quick Fill:</span>
                                            {previousListings.map(prev => (
                                              <button
                                                key={prev.id}
                                                type="button"
                                                onClick={() => {
                                                  setUploadedRows(prevRows => prevRows.map(r => r.index === row.index ? {
                                                    ...r,
                                                    firmCode: prev.firmCode,
                                                    rate: prev.rate,
                                                    availGemStock: prev.availGemStock || 0,
                                                    minQty: prev.minQty || 1,
                                                    gemLink: prev.gemLink || ""
                                                  } : r));
                                                }}
                                                className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 hover:border-blue-300 text-[9px] py-0.5 px-1.5 rounded font-bold transition-all"
                                              >
                                                {prev.firmCode}: ₹{prev.rate}
                                              </button>
                                            ))}
                                          </div>
                                        );
                                      }
                                      return null;
                                    })()
                                  )}

                                  {/* Last Quoted Hint */}
                                  {isMatched && lastQuoted && (
                                    <span className="text-[10px] text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200 display inline-block">
                                      Last Quote: ₹{lastQuoted.rate} (Min {lastQuoted.minQty}) on {lastQuoted.date}
                                    </span>
                                  )}
                                </div>

                                {/* Inline resolution Form */}
                                {unmatchedIndex === row.index && (
                                  <div className="mt-2 p-2.5 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl space-y-2">
                                    <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Organically Add New Item</h4>

                                    <div className="space-y-2">
                                      <input
                                        type="text"
                                        placeholder="Confirm Item Name..."
                                        value={newUnmatchedItem.name}
                                        onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, name: e.target.value }))}
                                        className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-lg p-2 text-xs text-[var(--gem-text-primary)]"
                                      />

                                      <select
                                        value={newUnmatchedItem.firmCode}
                                        onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, firmCode: e.target.value }))}
                                        className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-lg p-2 text-xs text-[var(--gem-text-primary)]"
                                      >
                                        <option value="">Select Firm...</option>
                                        {companies.map((c, idx) => (
                                          <option key={c._id || idx} value={c.firmCode}>{c.firmCode} - {c.firmName}</option>
                                        ))}
                                      </select>

                                      <input
                                        type="text"
                                        placeholder="Paste GeM Listing URL..."
                                        value={newUnmatchedItem.gemLink}
                                        onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, gemLink: e.target.value }))}
                                        className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-lg p-2 text-xs text-[var(--gem-text-primary)]"
                                      />

                                      <div className="grid grid-cols-2 gap-2">
                                        <input
                                          type="number"
                                          placeholder="Quote Rate (₹)"
                                          value={newUnmatchedItem.rate}
                                          onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, rate: e.target.value }))}
                                          className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-lg p-2 text-xs text-[var(--gem-text-primary)] font-mono"
                                        />
                                        <input
                                          type="number"
                                          placeholder="Min Qty"
                                          value={newUnmatchedItem.minQty}
                                          onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, minQty: e.target.value }))}
                                          className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-lg p-2 text-xs text-[var(--gem-text-primary)] font-mono"
                                        />
                                      </div>
                                    </div>

                                    <div className="flex gap-2 justify-end">
                                      <button
                                        onClick={() => setUnmatchedIndex(null)}
                                        className="px-3 py-1.5 rounded-lg border border-[var(--gem-border)] hover:bg-[var(--gem-table-row-hover)] text-[10px] uppercase font-bold"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => saveUnmatchedItem(row.index)}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-[10px] uppercase font-black"
                                      >
                                        Create & Map
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </td>

                              <td className="py-2 px-2.5 w-[130px] min-w-[130px]">
                                <select
                                  value={row.firmCode}
                                  onChange={(e) => setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, firmCode: e.target.value } : r))}
                                  className="bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-xs font-bold text-[var(--gem-text-primary)] rounded-lg py-2 px-2 focus:outline-none focus:border-blue-500 w-full"
                                >
                                  <option value="">Select Firm...</option>
                                  {companies.map((c, idx) => (
                                    <option key={c._id || idx} value={c.firmCode}>{c.firmCode} - {c.firmName}</option>
                                  ))}
                                </select>
                              </td>

                              <td className="py-2 px-2.5 font-mono w-[85px] min-w-[85px]">
                                <div className="space-y-0.5">
                                  <input
                                    type="number"
                                    value={row.rate || ""}
                                    onChange={(e) => setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, rate: parseFloat(e.target.value) || 0 } : r))}
                                    className="bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-xs font-bold text-[var(--gem-text-primary)] rounded-lg py-2 px-2 w-full focus:outline-none focus:border-blue-500"
                                    placeholder="0.00"
                                  />

                                  {/* Duplicate rate warning */}
                                  {duplicateWarning && (
                                    <span
                                      className="text-[9px] text-amber-500 bg-amber-500/10 px-1 py-0.5 rounded border border-amber-500/10 block font-sans cursor-help"
                                      title={duplicateWarning.message}
                                    >
                                      ⚠️ {duplicateWarning.firmCode}: ₹{duplicateWarning.rate}
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="py-2 px-2.5 font-mono w-[80px] min-w-[80px]">
                                <input
                                  type="number"
                                  value={row.availGemStock || ""}
                                  onChange={(e) => setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, availGemStock: parseInt(e.target.value) || 0 } : r))}
                                  className="bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-xs font-bold text-[var(--gem-text-primary)] rounded-lg py-2 px-2 w-full focus:outline-none focus:border-blue-500"
                                  placeholder="0"
                                />
                              </td>

                              <td className="py-2 px-2.5 font-mono w-[70px] min-w-[70px]">
                                <input
                                  type="number"
                                  value={row.minQty}
                                  onChange={(e) => setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, minQty: parseInt(e.target.value) || 1 } : r))}
                                  className="bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-xs font-bold text-[var(--gem-text-primary)] rounded-lg py-2 px-2 w-full focus:outline-none focus:border-blue-500"
                                  placeholder="1"
                                />
                              </td>

                              <td className="py-2 px-2.5 w-[150px] min-w-[150px]">
                                <input
                                  type="text"
                                  value={row.gemLink}
                                  onChange={(e) => setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, gemLink: e.target.value } : r))}
                                  className="bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-xs text-[var(--gem-text-primary)] rounded-lg py-2 px-2 w-full focus:outline-none focus:border-blue-500"
                                  placeholder="GeM Link..."
                                />
                              </td>

                              <td className="py-2 px-1.5 w-[165px] min-w-[165px]">
                                <div className="flex items-center justify-center gap-2 flex-wrap">
                                  {row.gemLink && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigator.clipboard.writeText(row.gemLink);
                                        alert("✓ Link copied to clipboard!");
                                      }}
                                      className="w-7 h-7 flex items-center justify-center rounded bg-sky-50 hover:bg-sky-100 text-sky-600 border border-sky-200 hover:border-sky-300 transition-colors"
                                      title="Copy GeM Link"
                                    >
                                      <FiCopy size={11} />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleOkLink(row)}
                                    title="OK Link - mapping is correct, link & mark done"
                                    className="w-7 h-7 flex items-center justify-center rounded bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                                  >
                                    <FiCheck size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateStock(row)}
                                    title="Update Stock - push the current Rate/Stock/Min Qty for this item"
                                    className="w-7 h-7 flex items-center justify-center rounded bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                                  >
                                    <FiEdit size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAddNewLink(row)}
                                    title="New Link - this item has no GeM listing for this firm yet"
                                    className="w-7 h-7 flex items-center justify-center rounded bg-[var(--gem-table-header)] hover:bg-[var(--gem-table-row-hover)] text-blue-600 border border-blue-300 transition-colors"
                                  >
                                    <FiPlus size={12} />
                                  </button>
                                  {row.notAvailable ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleRowNotAvailable(row.index)}
                                      title="Marked GeM Link Not Available - click to undo"
                                      className="w-7 h-7 flex items-center justify-center rounded bg-rose-100 text-rose-700 border border-rose-300 transition-colors"
                                    >
                                      <FiSlash size={12} />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => toggleRowNotAvailable(row.index)}
                                      title="GeM Link Not Available - this item can't be found on GeM"
                                      className="w-7 h-7 flex items-center justify-center rounded bg-[var(--gem-table-header)] hover:bg-rose-50 text-rose-600 border border-rose-300 transition-colors"
                                    >
                                      <FiSlash size={12} />
                                    </button>
                                  )}
                                  {row.isCompleted && (
                                    <button
                                      type="button"
                                      onClick={() => toggleRowCompleted(row.index)}
                                      title="Marked Completed - click to undo"
                                      className="w-7 h-7 flex items-center justify-center rounded bg-emerald-100 text-emerald-700 border border-emerald-300 transition-colors"
                                    >
                                      <FiCheck size={12} />
                                    </button>
                                  )}
                                  {getRowGemSyncStatus(row) === "synced" && (
                                    <span
                                      title="Confirmed synced to GeM's own catalogue (Sync Checklist entry is marked Synced)"
                                      className="w-7 h-7 flex items-center justify-center rounded bg-violet-100 text-violet-700 border border-violet-300"
                                    >
                                      <FiLink size={12} />
                                    </span>
                                  )}
                                </div>
                              </td>

                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {filteredUploadedRows.length > 0 && (
                    <div className="p-4 border-t border-[var(--gem-border)] flex flex-col items-center gap-2">
                      <p className="text-[10px] text-[var(--gem-text-secondary)] font-semibold">
                        Showing {visibleUploadedRows.length} of {filteredUploadedRows.length} rows
                      </p>
                      {visibleRowCount < filteredUploadedRows.length && (
                        <button
                          type="button"
                          onClick={() => setVisibleRowCount(prev => prev + ROWS_PAGE_SIZE)}
                          className="text-xs font-black uppercase tracking-wider py-2 px-5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                        >
                          Load More Items
                        </button>
                      )}
                    </div>
                  )}

                </div>
              )}
            </div>
          )}

          {/* =================== TAB 2: PER-FIRM SYNC CHECKLIST =================== */}
          {activeTab === "checklist" && (
            <div className="space-y-6">
              {/* Two portions: Stock Update (the original Pending-listings
                  view, unchanged) and New Upload Link (brand-new items with
                  no GeM listing yet, from the "Add New Link" row action). */}
              <div className="flex gap-2">
                <button
                  onClick={() => setChecklistSubTab("stock")}
                  className={`text-xs font-black uppercase tracking-wider py-2 px-4 rounded-xl border transition-all ${
                    checklistSubTab === "stock"
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-[var(--gem-card)] text-[var(--gem-text-secondary)] border-[var(--gem-border)] hover:text-[var(--gem-text-primary)]"
                  }`}
                >
                  Stock Update
                </button>
                <button
                  onClick={() => setChecklistSubTab("newLink")}
                  className={`text-xs font-black uppercase tracking-wider py-2 px-4 rounded-xl border transition-all ${
                    checklistSubTab === "newLink"
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-[var(--gem-card)] text-[var(--gem-text-secondary)] border-[var(--gem-border)] hover:text-[var(--gem-text-primary)]"
                  }`}
                >
                  New Upload Link
                </button>
              </div>

              {checklistSubTab === "stock" && (() => {
                const firmsToShow = companies.filter(firm => {
                  const allFirmListings = listings.filter(l => l.firmCode === firm.firmCode);
                  if (showAllSynced) {
                    return allFirmListings.length > 0;
                  } else {
                    return allFirmListings.some(l => l.status === "Pending");
                  }
                });

                if (firmsToShow.length === 0) {
                  return (
                    <div className="p-12 text-center text-[var(--gem-text-secondary)] bg-[var(--gem-card)] rounded-2xl border border-[var(--gem-border)] shadow-xl gem-sync-card">
                      <FiCheckCircle size={32} className="mx-auto text-emerald-500 mb-2" />
                      <p className="text-xs font-bold text-[var(--gem-text-primary)]">✓ All items are fully synced across all firms!</p>
                    </div>
                  );
                }

                return firmsToShow.map(firm => {
                  const allFirmListings = listings.filter(l => l.firmCode === firm.firmCode);
                  const displayListings = showAllSynced 
                    ? allFirmListings 
                    : allFirmListings.filter(l => l.status === "Pending");
                  const syncedCount = allFirmListings.filter(l => l.status === "Synced").length;

                  return (
                    <div key={firm._id} className="bg-[var(--gem-card)] rounded-2xl border border-[var(--gem-border)] shadow-xl overflow-hidden gem-sync-card">

                      {/* Header */}
                      <div className="p-6 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)] flex justify-between items-center">
                        <div>
                          <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider">
                            {firm.firmCode} — {firm.firmName}
                          </h3>
                          <p className="text-xs text-[var(--gem-text-secondary)] mt-1">Checklist of items ready to be synced to GeM Marketplace portal.</p>
                        </div>

                        <div className="text-right flex items-center gap-3">
                          <button
                            onClick={() => setShowAllSynced(!showAllSynced)}
                            className="text-[10px] font-black uppercase tracking-wider bg-[var(--gem-table-header)] hover:bg-[var(--gem-table-row-hover)] text-[var(--gem-text-primary)] border border-[var(--gem-border)] hover:border-[var(--gem-border)] py-1.5 px-3.5 rounded-lg transition-all cursor-pointer"
                          >
                            {showAllSynced ? "Hide Synced" : "Show All"}
                          </button>
                          <span className="text-xs font-mono font-bold bg-blue-50 text-blue-700 py-1.5 px-3 rounded-lg border border-blue-200">
                            {syncedCount} / {allFirmListings.length} Synced
                          </span>
                        </div>
                      </div>

                      {/* Table list */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] font-bold uppercase tracking-wider border-b border-[var(--gem-border)]">
                              <th className="py-3 px-4 text-center w-12">Sync</th>
                              <th className="py-3 px-4">Item Name</th>
                              <th className="py-3 px-4">GeM Product URL</th>
                              <th className="py-3 px-4 text-center w-36">Rate</th>
                              <th className="py-3 px-4 text-center w-32">Avail gem stock</th>
                              <th className="py-3 px-4 text-center w-28">Min Qty</th>
                              <th className="py-3 px-4 text-center w-40">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--gem-border)]/40">
                            {displayListings.map(lst => (
                              <tr key={lst.id} className="hover:bg-[var(--gem-table-row-hover)] transition-colors">
                                <td className="py-3.5 px-4 text-center">
                                  <input
                                    type="checkbox"
                                    checked={lst.status === "Synced"}
                                    onChange={() => toggleSyncStatus(lst.id)}
                                    className="w-4.5 h-4.5 rounded bg-[var(--gem-table-header)] border-[var(--gem-border)] text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                                  />
                                </td>

                                <td className="py-3.5 px-4">
                                  <span className="font-bold text-[var(--gem-text-primary)]">{lst.itemName}</span>
                                </td>

                                <td className="py-3.5 px-4">
                                  {lst.gemLink ? (
                                    <div className="flex items-center gap-2">
                                      <a
                                        href={lst.gemLink}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-blue-600 hover:underline flex items-center gap-1"
                                      >
                                        GeM Listing <FiExternalLink size={12} />
                                      </a>
                                      <button
                                        onClick={() => {
                                          navigator.clipboard.writeText(lst.gemLink);
                                          alert("✓ Link copied to clipboard!");
                                        }}
                                        className="p-1 rounded bg-[var(--gem-table-header)] hover:bg-[var(--gem-table-row-hover)] text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)] border border-[var(--gem-border)] transition-colors cursor-pointer"
                                        title="Copy Link"
                                      >
                                        <FiCopy size={11} />
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-[var(--gem-text-secondary)] italic">No link provided</span>
                                  )}
                                </td>

                                <td className="py-3.5 px-4 text-center font-mono font-bold text-[var(--gem-text-primary)]">
                                  ₹{lst.rate}
                                </td>

                                <td className="py-3.5 px-4 text-center font-mono text-[var(--gem-text-primary)]">
                                  {lst.availGemStock || 0}
                                </td>

                                <td className="py-3.5 px-4 text-center font-mono text-[var(--gem-text-primary)]">
                                  {lst.minQty}
                                </td>

                                <td className="py-3.5 px-4 text-center">
                                  <div className="flex gap-2 justify-center">
                                    <button
                                      onClick={() => handleOpenRevision(lst)}
                                      className="bg-[var(--gem-table-header)] hover:bg-[var(--gem-table-row-hover)] text-amber-500 border border-[var(--gem-border)] hover:border-amber-500/30 text-[10px] font-black tracking-wider uppercase py-1.5 px-3.5 rounded-lg transition-all flex items-center justify-center gap-1.5"
                                    >
                                      <FiEdit size={12} /> Revise Rate
                                    </button>
                                    <button
                                      onClick={() => handleSyncToGem(lst)}
                                      disabled={syncingListingId === lst.id}
                                      title="GeM par login karke Rate/Stock/Min Qty automatically update karega (extension ke through)"
                                      className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 hover:border-emerald-300 text-[10px] font-black tracking-wider uppercase py-1.5 px-3.5 rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                                    >
                                      <FiRefreshCw size={12} className={syncingListingId === lst.id ? "animate-spin" : ""} />
                                      {syncingListingId === lst.id ? "Syncing..." : "Sync to GeM"}
                                    </button>
                                    <button
                                      onClick={() => handleDeleteListing(lst.id)}
                                      className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 hover:border-red-300 text-[10px] font-black tracking-wider uppercase py-1.5 px-3 rounded-lg transition-all flex items-center justify-center"
                                      title="Delete Listing"
                                    >
                                      <FiTrash2 size={12} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                    </div>
                  );
                });
              })()}

              {checklistSubTab === "newLink" && (() => {
                const firmsToShow = companies.filter(firm => {
                  const allFirmEntries = newLinkChecklist.filter(e => e.firmCode === firm.firmCode);
                  return showAllSyncedNewLink ? allFirmEntries.length > 0 : allFirmEntries.some(e => e.status === "Pending");
                });

                if (firmsToShow.length === 0) {
                  return (
                    <div className="p-12 text-center text-[var(--gem-text-secondary)] bg-[var(--gem-card)] rounded-2xl border border-[var(--gem-border)] shadow-xl gem-sync-card">
                      <FiCheckCircle size={32} className="mx-auto text-emerald-500 mb-2" />
                      <p className="text-xs font-bold text-[var(--gem-text-primary)]">✓ No new listings pending creation on GeM!</p>
                    </div>
                  );
                }

                return firmsToShow.map(firm => {
                  const allFirmEntries = newLinkChecklist.filter(e => e.firmCode === firm.firmCode);
                  const displayEntries = showAllSyncedNewLink ? allFirmEntries : allFirmEntries.filter(e => e.status === "Pending");
                  const syncedCount = allFirmEntries.filter(e => e.status === "Synced").length;

                  return (
                    <div key={firm._id} className="bg-[var(--gem-card)] rounded-2xl border border-[var(--gem-border)] shadow-xl overflow-hidden gem-sync-card">
                      <div className="p-6 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)] flex justify-between items-center">
                        <div>
                          <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider">
                            {firm.firmCode} — {firm.firmName}
                          </h3>
                          <p className="text-xs text-[var(--gem-text-secondary)] mt-1">Items needing a brand-new GeM catalogue listing created for this firm.</p>
                        </div>
                        <div className="text-right flex items-center gap-3">
                          <button
                            onClick={() => setShowAllSyncedNewLink(!showAllSyncedNewLink)}
                            className="text-[10px] font-black uppercase tracking-wider bg-[var(--gem-table-header)] hover:bg-[var(--gem-table-row-hover)] text-[var(--gem-text-primary)] border border-[var(--gem-border)] py-1.5 px-3.5 rounded-lg transition-all cursor-pointer"
                          >
                            {showAllSyncedNewLink ? "Hide Synced" : "Show All"}
                          </button>
                          <span className="text-xs font-mono font-bold bg-blue-50 text-blue-700 py-1.5 px-3 rounded-lg border border-blue-200">
                            {syncedCount} / {allFirmEntries.length} Synced
                          </span>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] font-bold uppercase tracking-wider border-b border-[var(--gem-border)]">
                              <th className="py-3 px-4 text-center w-12">Sync</th>
                              <th className="py-3 px-4">Item Name</th>
                              <th className="py-3 px-4">GeM Product URL</th>
                              <th className="py-3 px-4 text-center w-36">Rate</th>
                              <th className="py-3 px-4 text-center w-32">Avail gem stock</th>
                              <th className="py-3 px-4 text-center w-28">Min Qty</th>
                              <th className="py-3 px-4 text-center w-56">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--gem-border)]/40">
                            {displayEntries.map(entry => {
                              const linkedItem = entry.mappedItemId ? allItemsList.find(i => i._id === entry.mappedItemId) : null;
                              return (
                                <tr key={entry.id} className="hover:bg-[var(--gem-table-row-hover)] transition-colors">
                                  <td className="py-3.5 px-4 text-center">
                                    <input
                                      type="checkbox"
                                      checked={entry.status === "Synced"}
                                      onChange={() => toggleNewLinkStatus(entry.id)}
                                      className="w-4.5 h-4.5 rounded bg-[var(--gem-table-header)] border-[var(--gem-border)] text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                                    />
                                  </td>
                                  <td className="py-3.5 px-4">
                                    <span className="font-bold text-[var(--gem-text-primary)]">{entry.itemName}</span>
                                    {/* Sheet context a Stock Update row simply doesn't have - the spec,
                                        remark and asked-for qty whoever creates this listing on GeM has
                                        to work from. Rides under the name so the column set stays
                                        identical to the Stock Update table. */}
                                    <span className="block text-[10px] text-[var(--gem-text-secondary)] mt-0.5 leading-relaxed">
                                      {entry.spec && <span className="mr-2"><b>Spec:</b> {entry.spec}</span>}
                                      {entry.remark && <span className="mr-2"><b>Remark:</b> {entry.remark}</span>}
                                      <span className="mr-2"><b>Req:</b> {entry.requiredQty}{entry.unit ? ` ${entry.unit}` : ""}</span>
                                      {linkedItem && <span>{linkedItem.sku}</span>}
                                    </span>
                                  </td>

                                  <td className="py-3.5 px-4">
                                    {entry.gemLink ? (
                                      <div className="flex items-center gap-2">
                                        <a
                                          href={entry.gemLink}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-blue-600 hover:underline flex items-center gap-1"
                                        >
                                          GeM Listing <FiExternalLink size={12} />
                                        </a>
                                        <button
                                          onClick={() => {
                                            navigator.clipboard.writeText(entry.gemLink || "");
                                            alert("✓ Link copied to clipboard!");
                                          }}
                                          className="p-1 rounded bg-[var(--gem-table-header)] hover:bg-[var(--gem-table-row-hover)] text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)] border border-[var(--gem-border)] transition-colors cursor-pointer"
                                          title="Copy Link"
                                        >
                                          <FiCopy size={11} />
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-[var(--gem-text-secondary)] italic">No link provided</span>
                                    )}
                                  </td>

                                  <td className="py-3.5 px-4 text-center font-mono font-bold text-[var(--gem-text-primary)]">
                                    {entry.rate ? `₹${entry.rate}` : "—"}
                                  </td>

                                  <td className="py-3.5 px-4 text-center font-mono text-[var(--gem-text-primary)]">
                                    {entry.availGemStock || 0}
                                  </td>

                                  <td className="py-3.5 px-4 text-center font-mono text-[var(--gem-text-primary)]">
                                    {entry.minQty || 1}
                                  </td>

                                  <td className="py-3.5 px-4 text-center">
                                    <div className="flex gap-2 justify-center">
                                      <button
                                        onClick={() => handleOpenNewLinkRevision(entry)}
                                        className="bg-[var(--gem-table-header)] hover:bg-[var(--gem-table-row-hover)] text-amber-500 border border-[var(--gem-border)] hover:border-amber-500/30 text-[10px] font-black tracking-wider uppercase py-1.5 px-3.5 rounded-lg transition-all flex items-center justify-center gap-1.5"
                                      >
                                        <FiEdit size={12} /> Revise Rate
                                      </button>
                                      <button
                                        onClick={() => handlePushNewLinkToStock(entry)}
                                        disabled={!entry.gemLink}
                                        title={entry.gemLink ? "Listing GeM par upload ho gayi - is item ko Stock Update checklist (Master List) me bhej do" : "Is row par GeM Product URL nahi hai"}
                                        className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 hover:border-emerald-300 text-[10px] font-black tracking-wider uppercase py-1.5 px-3.5 rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                                      >
                                        <FiArrowRight size={12} /> Push to Stock
                                      </button>
                                      <button
                                        onClick={() => handleDeleteNewLinkEntry(entry.id)}
                                        className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 hover:border-red-300 text-[10px] font-black tracking-wider uppercase py-1.5 px-3 rounded-lg transition-all inline-flex items-center justify-center"
                                        title="Delete Entry"
                                      >
                                        <FiTrash2 size={12} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {/* =================== TAB 4: SHEET LIBRARY =================== */}
          {activeTab === "sheets" && (
            <div className="bg-[var(--gem-card)] rounded-2xl border border-[var(--gem-border)] shadow-xl overflow-hidden">
              <div className="p-6 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)]/40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider flex items-center gap-2">
                    <FiDatabase className="text-blue-500" /> Uploaded Sheets Library
                  </h3>
                  <p className="text-xs text-[var(--gem-text-secondary)] mt-1">Select and open any previously uploaded requirement sheet, or delete outdated ones.</p>
                </div>

                {/* Filter Tabs & Search Bar inside Sheet Library */}
                <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                  {/* Status Filter Tabs */}
                  <div className="flex bg-[var(--gem-table-header)] p-1 rounded-xl border border-[var(--gem-border)]">
                    <button
                      type="button"
                      onClick={() => setSheetStatusFilter("current")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                        sheetStatusFilter === "current"
                          ? "bg-blue-600 text-white shadow-md"
                          : "text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)]"
                      }`}
                    >
                      Current ({sheets.filter(s => !s.isCompleted).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSheetStatusFilter("completed")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                        sheetStatusFilter === "completed"
                          ? "bg-emerald-600 text-white shadow-md"
                          : "text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)]"
                      }`}
                    >
                      Completed ({sheets.filter(s => !!s.isCompleted).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSheetStatusFilter("all")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                        sheetStatusFilter === "all"
                          ? "bg-[var(--gem-table-header)] text-[var(--gem-text-primary)] shadow-md"
                          : "text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)]"
                      }`}
                    >
                      All ({sheets.length})
                    </button>
                  </div>

                  {/* Search bar inside Sheet Library */}
                  <div className="relative w-full sm:w-64">
                    <FiSearch className="absolute left-3.5 top-3 text-[var(--gem-text-secondary)] text-sm" />
                    <input 
                      type="text"
                      placeholder="Search sheets library..."
                      className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-9 pr-4 text-xs text-[var(--gem-text-primary)] focus:outline-none focus:border-blue-500 font-semibold"
                      value={librarySearchQuery}
                      onChange={(e) => setLibrarySearchQuery(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {filteredSheets.length === 0 ? (
                <div className="p-12 text-center text-[var(--gem-text-secondary)] space-y-2">
                  <FiDatabase size={32} className="mx-auto text-slate-600" />
                  <p className="text-xs">No {sheetStatusFilter !== "all" ? sheetStatusFilter : ""} sheets match your criteria.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] font-bold uppercase tracking-wider border-b border-[var(--gem-border)]">
                        <th className="py-3.5 px-6">File Name</th>
                        <th className="py-3.5 px-6">Associated Buyer</th>
                        <th className="py-3.5 px-6 text-center w-40">Progress</th>
                        <th className="py-3.5 px-6 text-center w-36">Total Items</th>
                        <th className="py-3.5 px-6 text-center w-48">Last Saved</th>
                        <th className="py-3.5 px-6 text-center w-64">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--gem-border)]/40">
                      {filteredSheets.map(sheet => {
                        const matchedOpt = allBuyerOptions.find(b => b.id === sheet.selectedBuyerId || b.name === sheet.selectedBuyerId);
                        const displayBuyerName = matchedOpt?.name || sheet.selectedBuyerId || "Select Associated Buyer...";
                        const isSelected = !!matchedOpt || !!sheet.selectedBuyerId;
                        const isPopoverOpen = openBuyerSelectSheetId === sheet.id;
                        const totalRowsCount = sheet.totalRows ?? sheet.uploadedRows?.length ?? 0;
                        const completedRowsCountForSheet = sheet.completedRows ?? sheet.uploadedRows?.filter(r => r.isCompleted).length ?? 0;
                        const progressPct = totalRowsCount > 0 ? Math.round((completedRowsCountForSheet / totalRowsCount) * 100) : 0;

                        return (
                          <tr key={sheet.id} className="hover:bg-[var(--gem-table-row-hover)] transition-colors">
                            <td className="py-4 px-6 font-bold text-[var(--gem-text-primary)]">
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => handleToggleSheetCompleted(sheet.id, !!sheet.isCompleted)}
                                  title={sheet.isCompleted ? "Mark as Current / Incomplete" : "Mark as Completed"}
                                  className={`p-1 rounded-lg transition-all border cursor-pointer ${
                                    sheet.isCompleted
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                      : "bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] border-[var(--gem-border)] hover:text-[var(--gem-text-primary)] hover:border-[var(--gem-border)]"
                                  }`}
                                >
                                  <FiCheckCircle size={17} className={sheet.isCompleted ? "text-emerald-600" : "text-slate-400"} />
                                </button>

                                <span className={sheet.isCompleted ? "line-through text-[var(--gem-text-secondary)]" : "text-[var(--gem-text-primary)]"}>
                                  {sheet.fileName}
                                </span>

                                {sheet.isCompleted && (
                                  <span className="text-[9px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                    Completed
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-4 px-6 relative">
                              <button
                                type="button"
                                onClick={(e) => {
                                  if (isPopoverOpen) {
                                    setOpenBuyerSelectSheetId(null);
                                  } else {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    // Search box + result list (max-h-60) + padding - roughly
                                    // this tall. When the trigger row is near the bottom of the
                                    // viewport (e.g. the last row of a long sheet list), opening
                                    // downward as usual pushes the whole popover off-screen -
                                    // the search box stays visible but every matching result is
                                    // rendered below the visible window. Flip upward instead
                                    // whenever there isn't enough room below.
                                    const estimatedPopoverHeight = 340;
                                    const spaceBelow = window.innerHeight - rect.bottom;
                                    const top = spaceBelow < estimatedPopoverHeight
                                      ? Math.max(8, rect.top - estimatedPopoverHeight - 6)
                                      : rect.bottom + 6;
                                    setBuyerPopoverPos({ top, left: rect.left });
                                    setOpenBuyerSelectSheetId(sheet.id);
                                    setBuyerSearchFilter("");
                                  }
                                }}
                                className={`w-full max-w-[260px] text-left font-bold text-xs py-2 px-3.5 rounded-xl border transition-all flex items-center justify-between gap-2 shadow-sm ${
                                  isSelected
                                    ? "bg-[var(--gem-table-header)]/90 text-blue-600 border-[var(--gem-border)] hover:border-blue-400"
                                    : "bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] border-[var(--gem-border)] hover:border-[var(--gem-border)]"
                                }`}
                              >
                                <span className="truncate">{displayBuyerName}</span>
                                <FiChevronDown size={14} className={`shrink-0 transition-transform ${isPopoverOpen ? "rotate-180 text-blue-600" : "text-slate-400"}`} />
                              </button>

                              {/* Searchable Buyer Popover Dropdown - portaled to <body> and
                                  fixed-positioned so it can never be clipped by the table's
                                  scroll container, no matter which row it opens from */}
                              {isPopoverOpen && buyerPopoverPos && createPortal(
                                <>
                                  {/* Backdrop to close on click outside */}
                                  <div
                                    className="fixed inset-0 z-[90]"
                                    onClick={() => setOpenBuyerSelectSheetId(null)}
                                  />

                                  <div
                                    className="fixed z-[100] w-80 bg-[var(--gem-card)] border border-[var(--gem-border)] rounded-2xl shadow-2xl p-3 space-y-2.5 animate-in fade-in"
                                    style={{ top: buyerPopoverPos.top, left: buyerPopoverPos.left }}
                                  >
                                    <div className="relative">
                                      <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gem-text-secondary)] text-xs" />
                                      <input
                                        type="text"
                                        autoFocus
                                        placeholder="Search buyer name..."
                                        value={buyerSearchFilter}
                                        onChange={(e) => setBuyerSearchFilter(e.target.value)}
                                        className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-8 pr-8 text-xs text-[var(--gem-text-primary)] outline-none focus:border-blue-500 font-semibold"
                                      />
                                      {buyerSearchFilter && (
                                        <button
                                          type="button"
                                          onClick={() => setBuyerSearchFilter("")}
                                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)] p-0.5"
                                        >
                                          <FiX size={12} />
                                        </button>
                                      )}
                                    </div>

                                    <div className="max-h-60 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                                      {filteredBuyerOptions.length === 0 ? (
                                        <div className="p-4 text-center text-xs text-[var(--gem-text-secondary)] italic">
                                          No buyer matching "{buyerSearchFilter}"
                                        </div>
                                      ) : (
                                        filteredBuyerOptions.map(b => {
                                          const isItemActive = b.id === sheet.selectedBuyerId || b.name === displayBuyerName;
                                          return (
                                            <button
                                              key={b.id}
                                              type="button"
                                              onClick={() => {
                                                handleChangeSheetBuyer(sheet.id, b.id);
                                                setOpenBuyerSelectSheetId(null);
                                              }}
                                              className={`w-full text-left py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-2 ${
                                                isItemActive
                                                  ? "bg-blue-50 text-blue-700 border border-blue-300"
                                                  : "text-[var(--gem-text-primary)] hover:bg-[var(--gem-table-row-hover)] hover:text-[var(--gem-text-primary)]"
                                              }`}
                                            >
                                              <span className="truncate">{b.name}</span>
                                              {isItemActive && (
                                                <FiCheck size={14} className="text-blue-600 shrink-0" />
                                              )}
                                            </button>
                                          );
                                        })
                                      )}
                                    </div>
                                  </div>
                                </>,
                                document.body
                              )}
                            </td>
                            <td className="py-4 px-6">
                              <div className="flex flex-col items-center gap-1.5 w-32 mx-auto">
                                <div className="w-full h-1.5 rounded-full bg-[var(--gem-table-header)] overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      progressPct === 100
                                        ? "bg-emerald-500"
                                        : progressPct > 0
                                        ? "bg-blue-500"
                                        : "bg-slate-300"
                                    }`}
                                    style={{ width: `${progressPct}%` }}
                                  />
                                </div>
                                <span
                                  className={`text-[10px] font-black tabular-nums ${
                                    progressPct === 100
                                      ? "text-emerald-600"
                                      : progressPct > 0
                                      ? "text-blue-600"
                                      : "text-[var(--gem-text-secondary)]"
                                  }`}
                                >
                                  {completedRowsCountForSheet}/{totalRowsCount} ({progressPct}%)
                                </span>
                              </div>
                            </td>
                            <td className="py-4 px-6 text-center font-mono font-bold text-[var(--gem-text-primary)]">{sheet.totalRows ?? sheet.uploadedRows?.length ?? 0}</td>
                            <td className="py-4 px-6 text-center font-mono text-[var(--gem-text-secondary)]">
                              {sheet.updatedAt ? formatDate(sheet.updatedAt) : "—"}
                            </td>
                            <td className="py-4 px-6 text-center">
                              <div className="flex gap-2 justify-center">
                                <button
                                  disabled={loadingSheetContent}
                                  onClick={() => {
                                    // Set BEFORE the activeSheetId/fileName switch below, not
                                    // after fetchSheetContent resolves - the debounced auto-save
                                    // effect (keyed off activeSheetId/fileName/uploadedRows) fires
                                    // the instant those two change, while uploadedRows is still
                                    // whatever the PREVIOUSLY active sheet left behind (often [],
                                    // e.g. right after mount's auto-loaded sheet). Left unguarded,
                                    // that stale/empty uploadedRows can get auto-saved under this
                                    // sheet's id before its real content ever loads, permanently
                                    // zeroing out an otherwise-fine sheet - confirmed live
                                    // 28-Aug-2026 (this exact race is what stuck several Sheet
                                    // Library rows at "0 total items").
                                    skipNextAutoSaveRef.current = true;
                                    setActiveSheetId(sheet.id);
                                    setFileName(sheet.fileName);
                                    setSelectedBuyerId(sheet.selectedBuyerId);
                                    setActiveTab("upload"); // Switch to mapping view
                                    setLoadingSheetContent(true);
                                    fetchSheetContent(sheet.id)
                                      .then(({ uploadedRows, originalExcelData }) => {
                                        // Skip once more for the effect run this real content
                                        // triggers too - opening a sheet should never itself
                                        // produce a save, only actual edits should.
                                        skipNextAutoSaveRef.current = true;
                                        setUploadedRows(uploadedRows);
                                        setOriginalExcelData(originalExcelData);
                                      })
                                      .catch(err => {
                                        console.error("Failed to load sheet content", err);
                                        alert("Failed to load this sheet's content — check R2 connection and try again.");
                                      })
                                      .finally(() => setLoadingSheetContent(false));
                                  }}
                                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold text-[10px] tracking-wider uppercase py-2 px-3.5 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                                >
                                  {loadingSheetContent && activeSheetId === sheet.id ? "Loading..." : "Resume Mapping"}
                                </button>
                                <button
                                  onClick={() => handleDeleteSheet(sheet.id)}
                                  className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 hover:border-red-300 text-[10px] font-black tracking-wider uppercase py-2 px-3 rounded-lg transition-all flex items-center justify-center"
                                  title="Delete Sheet"
                                >
                                  <FiTrash2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* =================== TAB 5: MASTER LIST =================== */}
          {activeTab === "master" && (
            <div className="bg-[var(--gem-card)] rounded-2xl border border-[var(--gem-border)] shadow-xl overflow-hidden gem-sync-card">
              <div className="p-6 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 w-full sm:w-auto mb-3 sm:mb-0">
                  <div>
                    <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider flex items-center gap-2">
                      <FiList className="text-blue-500" /> Master Mapped Listings
                    </h3>
                    <p className="text-xs text-[var(--gem-text-secondary)] mt-1">Consolidated record of all items mapped and linked to firms across all uploaded sheets.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCleanupDuplicates}
                    className="bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 hover:border-amber-300 py-2 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer shrink-0 shadow-sm"
                    title="Clean up existing duplicate listings in MongoDB"
                  >
                    <FiTrash2 size={13} /> Clean Duplicates
                  </button>
                </div>
                
                {/* Separate Search Inputs */}
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  <div className="relative w-full sm:w-48">
                    <FiSearch className="absolute left-3.5 top-3 text-[var(--gem-text-secondary)] text-xs" />
                    <input 
                      type="text"
                      placeholder="Search Item / SKU..."
                      className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-9 pr-4 text-xs text-[var(--gem-text-primary)] focus:outline-none focus:border-blue-500"
                      value={masterItemSearch}
                      onChange={(e) => setMasterItemSearch(e.target.value)}
                    />
                  </div>
                  <div className="relative w-full sm:w-40">
                    <FiSearch className="absolute left-3.5 top-3 text-[var(--gem-text-secondary)] text-xs" />
                    <input 
                      type="text"
                      placeholder="Search Firm..."
                      className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-9 pr-4 text-xs text-[var(--gem-text-primary)] focus:outline-none focus:border-blue-500"
                      value={masterFirmSearch}
                      onChange={(e) => setMasterFirmSearch(e.target.value)}
                    />
                  </div>
                  <div className="relative w-full sm:w-48">
                    <FiSearch className="absolute left-3.5 top-3 text-[var(--gem-text-secondary)] text-xs" />
                    <input 
                      type="text"
                      placeholder="Search GeM URL..."
                      className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-9 pr-4 text-xs text-[var(--gem-text-primary)] focus:outline-none focus:border-blue-500"
                      value={masterUrlSearch}
                      onChange={(e) => setMasterUrlSearch(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {filteredMasterListings.length === 0 ? (
                <div className="p-12 text-center text-[var(--gem-text-secondary)] space-y-2">
                  <FiList size={32} className="mx-auto text-slate-600" />
                  <p className="text-xs">No mapped listings found in the master list.</p>
                </div>
              ) : (
                <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] font-bold uppercase tracking-wider border-b border-[var(--gem-border)]">
                        <th className="py-3.5 px-6">SKU / Item Name</th>
                        <th className="py-3.5 px-6">Firm</th>
                        <th className="py-3.5 px-6 text-center w-32">Rate</th>
                        <th className="py-3.5 px-6 text-center w-36">Avail gem stock</th>
                        <th className="py-3.5 px-6 text-center w-28">Min Qty</th>
                        <th className="py-3.5 px-6">Linked Buyer</th>
                        <th className="py-3.5 px-6">GeM URL</th>
                        <th className="py-3.5 px-6 text-center w-28">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--gem-border)]/40">
                      {visibleMasterListings.map((lst, idx) => {
                        const buyerName = buyers.find(b => b.id === lst.buyerId)?.name || "Unassigned";
                        const inventoryItem = allItemsList.find(i => i._id === lst.itemId);
                        const rowSpan = masterRowSpans[idx];
                        
                        return (
                          <tr key={lst.id} className="hover:bg-[var(--gem-table-row-hover)] transition-colors">
                            {rowSpan > 0 && (
                              <td className="py-4 px-6 border-r border-[var(--gem-border)]/40 bg-[var(--gem-table-header)]/10 align-middle" rowSpan={rowSpan}>
                                <span className="text-[10px] font-mono text-[var(--gem-text-secondary)] block mb-0.5">{inventoryItem?.sku || "CUSTOM"}</span>
                                <span className="font-bold text-[var(--gem-text-primary)] block">{lst.itemName}</span>
                              </td>
                            )}
                            <td className="py-4 px-6">
                              <span className="bg-[var(--gem-table-header)] py-1 px-2.5 rounded-lg border border-[var(--gem-border)] text-[11px] font-bold text-[var(--gem-text-primary)]">
                                {lst.firmCode}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-center font-mono font-bold text-[var(--gem-text-primary)]">₹{lst.rate}</td>
                            <td className="py-4 px-6 text-center font-mono text-[var(--gem-text-primary)]">{lst.availGemStock || 0}</td>
                            <td className="py-4 px-6 text-center font-mono text-[var(--gem-text-primary)]">{lst.minQty}</td>
                            <td className="py-4 px-6 text-[var(--gem-text-secondary)]">{buyerName}</td>
                            <td className="py-4 px-6">
                              {lst.gemLink ? (
                                <div className="flex items-center gap-2">
                                  <a 
                                    href={lst.gemLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-600 hover:underline flex items-center gap-1"
                                  >
                                    GeM Listing <FiExternalLink size={12} />
                                  </a>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(lst.gemLink);
                                      alert("✓ Link copied to clipboard!");
                                    }}
                                    className="p-1 rounded bg-[var(--gem-table-header)] hover:bg-[var(--gem-table-row-hover)] text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)] border border-[var(--gem-border)] transition-colors cursor-pointer"
                                    title="Copy Link"
                                  >
                                    <FiCopy size={11} />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[var(--gem-text-secondary)] italic">No link</span>
                              )}
                            </td>
                            <td className="py-4 px-6 text-center">
                              <button
                                onClick={() => handleDeleteListing(lst.id)}
                                className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 hover:border-red-300 text-[10px] font-black tracking-wider uppercase py-1.5 px-3 rounded-lg transition-all flex items-center justify-center mx-auto"
                                title="Unlink / Delete Listing"
                              >
                                <FiTrash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {filteredMasterListings.length > 0 && (
                  <div className="p-4 border-t border-[var(--gem-border)] flex flex-col items-center gap-2">
                    <p className="text-[10px] text-[var(--gem-text-secondary)] font-semibold">
                      Showing {visibleMasterListings.length} of {filteredMasterListings.length} items
                    </p>
                    {visibleMasterCount < filteredMasterListings.length && (
                      <button
                        type="button"
                        onClick={() => setVisibleMasterCount(prev => prev + MASTER_PAGE_SIZE)}
                        className="text-xs font-black uppercase tracking-wider py-2 px-5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                      >
                        Load More Items
                      </button>
                    )}
                  </div>
                )}
                </>
              )}
            </div>
          )}

          {/* =================== BUILD SHEET FROM SCRATCH MODAL =================== */}
          {showBuildSheetModal && (
            <BuildSheetModal
              stockItems={selectableStockItems}
              onClose={() => setShowBuildSheetModal(false)}
              onCreate={handleCreateSheetFromScratch}
            />
          )}

          {/* =================== MASTER RATE SHEET MODAL =================== */}
          {showMasterRateModal && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowMasterRateModal(false)}
            >
              <div
                className="bg-[var(--gem-card)] border border-[var(--gem-border)] rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 gem-sync-card"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-4 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)] flex items-center justify-between shrink-0">
                  <div>
                    <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider">Master Rate Sheet</h3>
                    <p className="text-[10px] text-[var(--gem-text-secondary)] mt-0.5">
                      Set Rate A/B/C/D per item once - pick a type on any open sheet to fill its Rate column from here.
                    </p>
                  </div>
                  <button onClick={() => setShowMasterRateModal(false)} className="text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)]">
                    <FiX size={18} />
                  </button>
                </div>

                <div className="p-3 border-b border-[var(--gem-border)] flex flex-wrap items-center gap-2 shrink-0">
                  <div className="flex bg-[var(--gem-card)] p-0.5 rounded-lg border border-[var(--gem-border)]">
                    <button
                      type="button"
                      onClick={() => setMasterRateTab("current")}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${
                        masterRateTab === "current" ? "bg-blue-600 text-white shadow-md" : "text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)]"
                      }`}
                    >
                      Current Sheet Rate ({currentSheetRateItems.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMasterRateTab("all")}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${
                        masterRateTab === "all" ? "bg-blue-600 text-white shadow-md" : "text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)]"
                      }`}
                    >
                      All Rate ({allItemsList.length})
                    </button>
                  </div>
                  {masterRateTab === "all" && (
                    <input
                      type="text"
                      value={masterRateSearch}
                      onChange={(e) => { setMasterRateSearch(e.target.value); setAllRateVisibleCount(50); }}
                      placeholder="Search item / SKU..."
                      className="ml-auto bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-xs text-[var(--gem-text-primary)] rounded-lg py-1.5 px-3 w-56 focus:outline-none focus:border-blue-500"
                    />
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-3">
                  {(masterRateTab === "current" ? currentSheetRateItems : allRateFilteredItems.slice(0, allRateVisibleCount)).length === 0 ? (
                    <p className="text-xs text-[var(--gem-text-secondary)] text-center py-10">
                      {masterRateTab === "current" ? "No mapped items in the current sheet yet." : "No items found."}
                    </p>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="sticky top-0 bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] font-black uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="py-2 px-2.5">Item</th>
                          <th className="py-2 px-2.5">SKU</th>
                          <th className="py-2 px-2.5 text-center w-20">Rate A</th>
                          <th className="py-2 px-2.5 text-center w-20">Rate B</th>
                          <th className="py-2 px-2.5 text-center w-20">Rate C</th>
                          <th className="py-2 px-2.5 text-center w-20">Rate D</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--gem-border)]/60">
                        {(masterRateTab === "current" ? currentSheetRateItems : allRateFilteredItems.slice(0, allRateVisibleCount)).map((item) => {
                          const entry = masterRatesDraft.find((e) => e.itemId === item.itemId);
                          return (
                            <tr key={item.itemId}>
                              <td className="py-1.5 px-2.5 font-bold text-[var(--gem-text-primary)]">{item.itemName}</td>
                              <td className="py-1.5 px-2.5 text-[var(--gem-text-secondary)]">{item.sku}</td>
                              {(["A", "B", "C", "D"] as RateType[]).map((type) => (
                                <td key={type} className="py-1.5 px-2.5">
                                  <input
                                    type="number"
                                    value={entry?.[(`rate${type}` as unknown) as keyof MasterRateEntry] ?? ""}
                                    onChange={(e) => updateDraftRate(item.itemId, type, e.target.value)}
                                    className="w-20 bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-xs font-mono text-[var(--gem-text-primary)] rounded-lg py-1.5 px-2 text-center focus:outline-none focus:border-blue-500"
                                    placeholder="—"
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                  {masterRateTab === "all" && allRateVisibleCount < allRateFilteredItems.length && (
                    <div className="flex justify-center py-3">
                      <button
                        onClick={() => setAllRateVisibleCount((c) => c + 50)}
                        className="text-[10px] font-black uppercase tracking-wider py-2 px-4 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                      >
                        Load More Items
                      </button>
                    </div>
                  )}
                </div>

                <div className="p-3 border-t border-[var(--gem-border)] flex justify-end shrink-0">
                  <button
                    onClick={handleSaveMasterRates}
                    className="flex items-center gap-1.5 py-2 px-4 rounded-lg font-black text-[10px] uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  >
                    <FiUploadCloud size={13} /> Save Master Rates
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* =================== REVISION DIALOG MODAL =================== */}
          {isRevisionOpen && selectedListingForRevision && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-[var(--gem-card)] border border-[var(--gem-border)] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 gem-sync-card">

                {/* Header */}
                <div className="p-6 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)]">
                  <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider flex items-center gap-2">
                    <FiClock className="text-amber-500" /> Revise Rate (Buyer Negotiated)
                  </h3>
                  <p className="text-xs text-[var(--gem-text-secondary)] mt-1">Log negotiation revision details for: {selectedListingForRevision.itemName}</p>
                </div>

                {/* Form fields */}
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">New Rate (₹)</label>
                      <input
                        type="number"
                        className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)] font-mono"
                        value={newRateValue}
                        onChange={(e) => setNewRateValue(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">New Min Qty</label>
                      <input
                        type="number"
                        className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)] font-mono"
                        value={newMinQtyValue}
                        onChange={(e) => setNewMinQtyValue(e.target.value)}
                        placeholder="1"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">GeM Product URL</label>
                      <input
                        type="text"
                        className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)]"
                        value={newGemLinkValue}
                        onChange={(e) => setNewGemLinkValue(e.target.value)}
                        placeholder="Paste GeM Listing URL..."
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">Avail GeM Stock</label>
                      <input
                        type="number"
                        className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)] font-mono"
                        value={newAvailGemStockValue}
                        onChange={(e) => setNewAvailGemStockValue(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">Reason for Revision</label>
                    <textarea
                      rows={3}
                      className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)] focus:outline-none"
                      value={revisionReason}
                      onChange={(e) => setRevisionReason(e.target.value)}
                      placeholder="e.g. buyer requested lower price for bulk order..."
                    />
                  </div>
                </div>

                {/* Footer buttons */}
                <div className="p-6 border-t border-[var(--gem-border)] bg-[var(--gem-table-header)]/20 flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setIsRevisionOpen(false);
                      setSelectedListingForRevision(null);
                    }}
                    className="px-5 py-2.5 rounded-lg border border-[var(--gem-border)] hover:bg-[var(--gem-table-row-hover)] text-xs uppercase font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveRevision}
                    className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-lg text-xs uppercase font-black"
                  >
                    Confirm Revision
                  </button>
                </div>

              </div>
            </div>
          )}

          {/* ========= NEW UPLOAD LINK: RATE / STOCK REVISE MODAL =========
              Deliberately not the Revision dialog above - that one edits a
              FirmItemListing and logs a negotiation history entry. A New
              Upload Link row isn't a listing yet, so this just fills in the
              numbers "Push to Stock" will need. */}
          {newLinkRevisionEntry && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-[var(--gem-card)] border border-[var(--gem-border)] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 gem-sync-card">

                <div className="p-6 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)]">
                  <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider flex items-center gap-2">
                    <FiEdit className="text-amber-500" /> Revise Rate (New Upload Link)
                  </h3>
                  <p className="text-xs text-[var(--gem-text-secondary)] mt-1">
                    {newLinkRevisionEntry.firmCode} — {newLinkRevisionEntry.itemName}
                  </p>
                </div>

                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">Rate (₹)</label>
                      <input
                        type="number"
                        className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)] font-mono focus:outline-none focus:border-blue-500"
                        value={newLinkRateValue}
                        onChange={(e) => setNewLinkRateValue(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">Min Qty</label>
                      <input
                        type="number"
                        className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)] font-mono focus:outline-none focus:border-blue-500"
                        value={newLinkMinQtyValue}
                        onChange={(e) => setNewLinkMinQtyValue(e.target.value)}
                        placeholder="1"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">GeM Product URL</label>
                      <input
                        type="text"
                        className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)] focus:outline-none focus:border-blue-500"
                        value={newLinkGemLinkValue}
                        onChange={(e) => setNewLinkGemLinkValue(e.target.value)}
                        placeholder="Sheet se aaya link..."
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">Avail GeM Stock</label>
                      <input
                        type="number"
                        className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)] font-mono focus:outline-none focus:border-blue-500"
                        value={newLinkStockValue}
                        onChange={(e) => setNewLinkStockValue(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </div>

                  <p className="text-[11px] text-[var(--gem-text-secondary)] leading-relaxed">
                    Ye values <b>Push to Stock</b> par is item ki Master List / Stock Update entry me chali jayengi.
                  </p>
                </div>

                <div className="p-6 border-t border-[var(--gem-border)] bg-[var(--gem-table-header)]/20 flex justify-end gap-3">
                  <button
                    onClick={() => setNewLinkRevisionEntry(null)}
                    className="px-5 py-2.5 rounded-lg border border-[var(--gem-border)] hover:bg-[var(--gem-table-row-hover)] text-xs uppercase font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveNewLinkRevision}
                    className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-lg text-xs uppercase font-black"
                  >
                    Save Details
                  </button>
                </div>

              </div>
            </div>
          )}

        </div>
      </div>
      <AddItemModal
        isOpen={isAddItemModalOpen}
        onClose={() => {
          setIsAddItemModalOpen(false);
          fetch("/api/stock")
            .then((res) => res.json())
            .then((data) => setStockItems(Array.isArray(data) ? data : []))
            .catch((err) => console.error("Error refreshing stock", err));
        }}
      />
    </BlockGuard>
  );
}
