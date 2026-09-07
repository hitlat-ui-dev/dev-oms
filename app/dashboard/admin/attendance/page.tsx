"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import BlockGuard from "@/components/BlockGuard";
import {
  FiArrowLeft,
  FiUserCheck,
  FiSave,
  FiRefreshCw,
  FiPlus,
  FiDownloadCloud,
  FiSlash,
  FiRotateCcw,
  FiX,
  FiTrash2,
  FiTrendingUp,
  FiCreditCard,
} from "react-icons/fi";

interface Employee {
  _id: string;
  name: string;
  employeeCode?: string;
  mobile?: string;
  designation?: string;
  linkedUsername?: string;
  isActive: boolean;
  monthlySalary?: number;
  joiningDate?: string | null;
  salaryHistory?: SalaryChange[];
}

interface SalaryChange {
  date: string;
  oldSalary: number;
  newSalary: number;
  note?: string;
  changedBy?: string;
}

type LedgerType = "advance" | "advance_repay" | "loan" | "loan_repay";

interface LedgerEntry {
  _id: string;
  employeeId: string;
  date: string;
  type: LedgerType;
  amount: number;
  note?: string;
  createdBy?: string;
}

interface Balance {
  advanceGiven: number;
  advanceRepaid: number;
  advanceBalance: number;
  loanGiven: number;
  loanRepaid: number;
  loanBalance: number;
}

const ZERO_BALANCE: Balance = {
  advanceGiven: 0, advanceRepaid: 0, advanceBalance: 0,
  loanGiven: 0, loanRepaid: 0, loanBalance: 0,
};

// Direction is carried by the type, never by the sign of the amount - see the
// note at the top of models/EmployeeLedger.ts.
const LEDGER_TYPES: { key: LedgerType; label: string; sign: "+" | "-"; tone: string }[] = [
  { key: "advance", label: "Advance diya", sign: "+", tone: "text-amber-700" },
  { key: "advance_repay", label: "Advance kata", sign: "-", tone: "text-emerald-700" },
  { key: "loan", label: "Loan diya", sign: "+", tone: "text-rose-700" },
  { key: "loan_repay", label: "Loan kata", sign: "-", tone: "text-emerald-700" },
];

const ledgerMeta = (key: string) => LEDGER_TYPES.find((t) => t.key === key);

const inr = (n: number) => `\u20b9${(Number(n) || 0).toLocaleString("en-IN")}`;

const prettyDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "\u2014";

interface AttendanceRecord {
  employeeId: string;
  employeeName: string;
  date: string;
  status: AttendanceStatus;
  inTime?: string;
  outTime?: string;
  overtimeHours?: number;
  note?: string;
  markedBy?: string;
}

type AttendanceStatus = "present" | "absent" | "half_day" | "leave" | "holiday";

// One place defining every status - the daily buttons, the monthly grid
// letters and the totals row all read from here, so adding a status later
// means editing this array and nothing else.
const STATUSES: { key: AttendanceStatus; short: string; label: string; btn: string; cell: string }[] = [
  { key: "present", short: "P", label: "Present", btn: "bg-emerald-600 border-emerald-600 text-white", cell: "bg-emerald-100 text-emerald-800" },
  { key: "absent", short: "A", label: "Absent", btn: "bg-red-600 border-red-600 text-white", cell: "bg-red-100 text-red-800" },
  { key: "half_day", short: "H", label: "Half Day", btn: "bg-amber-500 border-amber-500 text-white", cell: "bg-amber-100 text-amber-800" },
  { key: "leave", short: "L", label: "Leave", btn: "bg-blue-600 border-blue-600 text-white", cell: "bg-blue-100 text-blue-800" },
  { key: "holiday", short: "Ho", label: "Holiday", btn: "bg-slate-500 border-slate-500 text-white", cell: "bg-slate-200 text-slate-700" },
];

const statusMeta = (key: string) => STATUSES.find((s) => s.key === key);

// Local calendar date, NOT toISOString(). toISOString() converts to UTC, so
// in IST anything before 05:30 would report yesterday's date - the exact
// off-by-one the "YYYY-MM-DD string" choice in models/Attendance.ts avoids.
function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this one
  const p = (n: number) => String(n).padStart(2, "0");
  return Array.from({ length: count }, (_, i) => `${month}-${p(i + 1)}`);
}

// What one row of the daily register holds while it is being edited.
interface DraftRow {
  status: AttendanceStatus;
  inTime: string;
  outTime: string;
  overtimeHours: string;
  note: string;
}

const BLANK_ROW: DraftRow = { status: "present", inTime: "", outTime: "", overtimeHours: "", note: "" };

export default function AttendancePage() {
  const router = useRouter();

  const [tab, setTab] = useState<"daily" | "monthly" | "employees">("daily");
  const [currentUsername, setCurrentUsername] = useState("");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  // ---- Daily register ----
  const [date, setDate] = useState(todayLocal());
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loadingDay, setLoadingDay] = useState(false);
  const [saving, setSaving] = useState(false);

  // ---- Monthly view ----
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[]>([]);
  const [loadingMonth, setLoadingMonth] = useState(false);

  // ---- Employees tab ----
  const [showInactive, setShowInactive] = useState(false);
  const [newEmp, setNewEmp] = useState({
    name: "", employeeCode: "", mobile: "", designation: "", monthlySalary: "", joiningDate: "",
  });
  const [savingEmp, setSavingEmp] = useState(false);

  // Advance/loan balances for the whole list, summed server-side from the
  // ledger entries (never stored on the employee).
  const [balances, setBalances] = useState<Record<string, Balance>>({});

  // ---- Employee detail (salary + ledger) ----
  const [detailEmp, setDetailEmp] = useState<Employee | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [detailBalance, setDetailBalance] = useState<Balance>(ZERO_BALANCE);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [incForm, setIncForm] = useState({ newSalary: "", effectiveDate: todayLocal(), note: "" });
  const [ledgerForm, setLedgerForm] = useState<{ type: LedgerType; date: string; amount: string; note: string }>({
    type: "advance", date: todayLocal(), amount: "", note: "",
  });
  const [savingDetail, setSavingDetail] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("oms_user");
      if (stored) setCurrentUsername(JSON.parse(stored)?.username || "");
    } catch {
      // ignore - markedBy just ends up blank
    }
  }, []);

  const loadEmployees = useCallback(() => {
    setLoadingEmployees(true);
    fetch(`/api/employees${showInactive ? "?all=1" : ""}`)
      .then((res) => res.json())
      .then((data) => setEmployees(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load employees", err))
      .finally(() => setLoadingEmployees(false));
  }, [showInactive]);

  const loadBalances = useCallback(() => {
    fetch("/api/employee-ledger")
      .then((res) => res.json())
      .then((data) => setBalances(data?.balances || {}))
      .catch((err) => console.error("Failed to load balances", err));
  }, []);

  useEffect(() => {
    loadEmployees();
    loadBalances();
  }, [loadEmployees, loadBalances]);

  // Roster for the daily register - always the active people only, even when
  // the Employees tab is showing deactivated ones.
  const roster = useMemo(() => employees.filter((e) => e.isActive), [employees]);

  // Loads whatever is already marked for this date and seeds the draft. Rows
  // with no record yet start at Present: in a small firm that is the answer
  // most days, so the admin only touches the exceptions. `savedIds` keeps the
  // distinction visible - a prefilled Present is not the same as a saved one.
  const loadDay = useCallback(() => {
    if (!date) return;
    setLoadingDay(true);
    fetch(`/api/attendance?date=${date}`)
      .then((res) => res.json())
      .then((data: AttendanceRecord[]) => {
        const records = Array.isArray(data) ? data : [];
        const byId = new Map(records.map((r) => [r.employeeId, r]));
        setSavedIds(new Set(records.map((r) => r.employeeId)));
        setDraft(
          Object.fromEntries(
            roster.map((emp) => {
              const rec = byId.get(emp._id);
              return [
                emp._id,
                rec
                  ? {
                      status: rec.status,
                      inTime: rec.inTime || "",
                      outTime: rec.outTime || "",
                      overtimeHours: rec.overtimeHours ? String(rec.overtimeHours) : "",
                      note: rec.note || "",
                    }
                  : { ...BLANK_ROW },
              ];
            })
          )
        );
      })
      .catch((err) => console.error("Failed to load attendance", err))
      .finally(() => setLoadingDay(false));
  }, [date, roster]);

  useEffect(() => {
    if (tab === "daily" && roster.length > 0) loadDay();
  }, [tab, roster, loadDay]);

  const loadMonth = useCallback(() => {
    if (!month) return;
    setLoadingMonth(true);
    fetch(`/api/attendance?month=${month}`)
      .then((res) => res.json())
      .then((data) => setMonthRecords(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load month", err))
      .finally(() => setLoadingMonth(false));
  }, [month]);

  useEffect(() => {
    if (tab === "monthly") loadMonth();
  }, [tab, loadMonth]);

  const setRow = (empId: string, patch: Partial<DraftRow>) => {
    setDraft((prev) => ({ ...prev, [empId]: { ...(prev[empId] || BLANK_ROW), ...patch } }));
  };

  const markAll = (status: AttendanceStatus) => {
    setDraft((prev) => {
      const next = { ...prev };
      roster.forEach((emp) => {
        next[emp._id] = { ...(next[emp._id] || BLANK_ROW), status };
      });
      return next;
    });
  };

  const handleSaveDay = async () => {
    if (roster.length === 0) {
      alert("Roster khali hai - pehle Employees tab me se employee add karo.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          markedBy: currentUsername,
          records: roster.map((emp) => {
            const row = draft[emp._id] || BLANK_ROW;
            return {
              employeeId: emp._id,
              employeeName: emp.name,
              status: row.status,
              inTime: row.inTime,
              outTime: row.outTime,
              overtimeHours: Number(row.overtimeHours) || 0,
              note: row.note,
            };
          }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed");
      setSavedIds(new Set(roster.map((e) => e._id)));
      alert(`✓ ${date} ki attendance save ho gayi (${data.saved} log).`);
    } catch (err: any) {
      alert("Save nahi hui: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddEmployee = async () => {
    const name = newEmp.name.trim();
    if (!name) {
      alert("Naam zaroori hai.");
      return;
    }
    setSavingEmp(true);
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newEmp),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      setNewEmp({ name: "", employeeCode: "", mobile: "", designation: "", monthlySalary: "", joiningDate: "" });
      loadEmployees();
    } catch (err: any) {
      alert("Employee add nahi hua: " + err.message);
    } finally {
      setSavingEmp(false);
    }
  };

  const handleImportUsers = async () => {
    if (!confirm("OMS ke jitne login users hain, unka employee record bana diya jaye?")) return;
    try {
      const res = await fetch("/api/employees?action=import_users", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      alert(data.imported > 0 ? `✓ ${data.imported} naye employee add hue.` : "Sab users pehle se employee list me hain.");
      loadEmployees();
    } catch (err: any) {
      alert("Import nahi hua: " + err.message);
    }
  };

  const openDetail = (emp: Employee) => {
    setDetailEmp(emp);
    setIncForm({ newSalary: String(emp.monthlySalary || ""), effectiveDate: todayLocal(), note: "" });
    setLedgerForm({ type: "advance", date: todayLocal(), amount: "", note: "" });
    setLoadingDetail(true);
    fetch(`/api/employee-ledger?employeeId=${emp._id}`)
      .then((res) => res.json())
      .then((data) => {
        setLedger(Array.isArray(data?.entries) ? data.entries : []);
        setDetailBalance(data?.balance || ZERO_BALANCE);
      })
      .catch((err) => console.error("Failed to load ledger", err))
      .finally(() => setLoadingDetail(false));
  };

  // Refreshes everything a detail-panel change can affect: the open panel, the
  // list badges, and the employee row itself (salary shows in both places).
  const refreshAfterDetailChange = (empId: string) => {
    loadEmployees();
    loadBalances();
    fetch(`/api/employee-ledger?employeeId=${empId}`)
      .then((res) => res.json())
      .then((data) => {
        setLedger(Array.isArray(data?.entries) ? data.entries : []);
        setDetailBalance(data?.balance || ZERO_BALANCE);
      })
      .catch(() => {});
  };

  const handleSaveIncrement = async () => {
    if (!detailEmp) return;
    const newSalary = Number(incForm.newSalary);
    if (!Number.isFinite(newSalary) || newSalary < 0) {
      alert("Salary ka valid number daalo.");
      return;
    }
    if (newSalary === (detailEmp.monthlySalary || 0)) {
      alert("Salary wahi hai jo pehle se hai - kuch badla nahi.");
      return;
    }
    setSavingDetail(true);
    try {
      const res = await fetch("/api/employees", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _id: detailEmp._id,
          monthlySalary: newSalary,
          effectiveDate: incForm.effectiveDate,
          incrementNote: incForm.note,
          changedBy: currentUsername,
        }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated?.error || "Failed");
      setDetailEmp(updated);
      setIncForm({ newSalary: String(updated.monthlySalary || ""), effectiveDate: todayLocal(), note: "" });
      loadEmployees();
    } catch (err: any) {
      alert("Salary update nahi hui: " + err.message);
    } finally {
      setSavingDetail(false);
    }
  };

  const handleAddLedger = async () => {
    if (!detailEmp) return;
    const amount = Number(ledgerForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Amount 0 se zyada hona chahiye.");
      return;
    }
    setSavingDetail(true);
    try {
      const res = await fetch("/api/employee-ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: detailEmp._id,
          employeeName: detailEmp.name,
          date: ledgerForm.date,
          type: ledgerForm.type,
          amount,
          note: ledgerForm.note,
          createdBy: currentUsername,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      setLedgerForm((p) => ({ ...p, amount: "", note: "" }));
      refreshAfterDetailChange(detailEmp._id);
    } catch (err: any) {
      alert("Entry add nahi hui: " + err.message);
    } finally {
      setSavingDetail(false);
    }
  };

  const handleDeleteLedger = async (entry: LedgerEntry) => {
    if (!detailEmp) return;
    if (!confirm(`${ledgerMeta(entry.type)?.label} ${inr(entry.amount)} (${entry.date}) delete karein?`)) return;
    try {
      const res = await fetch(`/api/employee-ledger?id=${entry._id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json())?.error || "Failed");
      refreshAfterDetailChange(detailEmp._id);
    } catch (err: any) {
      alert("Delete nahi hua: " + err.message);
    }
  };

  const handleToggleActive = async (emp: Employee) => {
    const turningOff = emp.isActive;
    if (turningOff && !confirm(`"${emp.name}" ko roster se hata dein? Purani attendance waise hi rahegi.`)) return;
    try {
      const res = await fetch("/api/employees", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _id: emp._id, isActive: !emp.isActive }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || "Failed");
      loadEmployees();
    } catch (err: any) {
      alert("Update nahi hua: " + err.message);
    }
  };

  // Monthly grid: { employeeId -> { date -> record } }, plus per-person totals.
  const monthGrid = useMemo(() => {
    const byEmp = new Map<string, Map<string, AttendanceRecord>>();
    monthRecords.forEach((r) => {
      if (!byEmp.has(r.employeeId)) byEmp.set(r.employeeId, new Map());
      byEmp.get(r.employeeId)!.set(r.date, r);
    });
    return byEmp;
  }, [monthRecords]);

  const monthDays = useMemo(() => daysInMonth(month), [month]);

  // Everyone who either is on the roster now, or has a record this month -
  // so a person deactivated mid-month still shows in that month's register.
  const monthPeople = useMemo(() => {
    const seen = new Map<string, string>();
    roster.forEach((e) => seen.set(e._id, e.name));
    monthRecords.forEach((r) => {
      if (!seen.has(r.employeeId)) seen.set(r.employeeId, r.employeeName);
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [roster, monthRecords]);

  const markedCount = useMemo(() => roster.filter((e) => savedIds.has(e._id)).length, [roster, savedIds]);

  return (
    <BlockGuard
      permission="boss"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50">
          <p className="text-red-500 font-bold uppercase">You have no access for this page.</p>
        </div>
      }
    >
      <div className="p-4 md:p-8 bg-[#f3f6f9] min-h-screen">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">

          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-slate-500 font-bold text-xs uppercase tracking-widest w-fit"
          >
            <FiArrowLeft /> Back
          </button>

          <div className="flex items-center gap-4">
            <div className="bg-[#0a2540] text-white p-4 rounded-2xl">
              <FiUserCheck size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-[#0a2540]">Attendance</h1>
              <p className="text-[#ff9933] text-[10px] font-black tracking-widest uppercase">Daily Register &amp; Monthly Summary</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 flex-wrap">
            {([
              ["daily", "Daily Register"],
              ["monthly", "Monthly View"],
              ["employees", "Employees"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`text-[11px] font-black uppercase tracking-wider py-2 px-4 rounded-xl border transition-all ${
                  tab === key
                    ? "bg-[#0a2540] text-white border-[#0a2540]"
                    : "bg-white text-slate-500 border-slate-200 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ================= DAILY REGISTER ================= */}
          {tab === "daily" && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">Daily Register</h3>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {markedCount === roster.length && roster.length > 0
                      ? `Is din ki attendance save ho chuki hai (${roster.length} log).`
                      : `${markedCount} / ${roster.length} save hue. Baaki rows Present par pre-filled hain — badalke Save dabao.`}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="date"
                    value={date}
                    max={todayLocal()}
                    onChange={(e) => setDate(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-[11px] font-black text-slate-700 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={loadDay}
                    title="Is date ka saved data dobara load karo"
                    className="bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl p-2 transition-colors"
                  >
                    <FiRefreshCw size={13} className={loadingDay ? "animate-spin" : ""} />
                  </button>
                  <button
                    onClick={() => markAll("present")}
                    className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl py-2 px-3 text-[10px] font-black uppercase tracking-wider transition-colors"
                  >
                    Mark all Present
                  </button>
                  <button
                    onClick={() => markAll("holiday")}
                    className="bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl py-2 px-3 text-[10px] font-black uppercase tracking-wider transition-colors"
                  >
                    Holiday
                  </button>
                  <button
                    onClick={handleSaveDay}
                    disabled={saving || roster.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl py-2 px-4 text-[10px] font-black uppercase tracking-wider transition-colors flex items-center gap-1.5"
                  >
                    <FiSave size={12} /> {saving ? "Saving..." : "Save Day"}
                  </button>
                </div>
              </div>

              {roster.length === 0 ? (
                <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-12">
                  Koi active employee nahi — Employees tab me jao
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse min-w-[860px]">
                    <thead className="bg-slate-50 text-slate-400 font-black uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="py-2.5 px-5">Employee</th>
                        <th className="py-2.5 px-2.5 w-[300px]">Status</th>
                        <th className="py-2.5 px-2.5 text-center w-24">In</th>
                        <th className="py-2.5 px-2.5 text-center w-24">Out</th>
                        <th className="py-2.5 px-2.5 text-center w-24">OT (hrs)</th>
                        <th className="py-2.5 px-5">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {roster.map((emp) => {
                        const row = draft[emp._id] || BLANK_ROW;
                        return (
                          <tr key={emp._id} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-5">
                              <p className="font-black text-slate-800">{emp.name}</p>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                {emp.designation || (emp.linkedUsername ? "OMS user" : "—")}
                                {!savedIds.has(emp._id) && <span className="text-amber-600 ml-2">unsaved</span>}
                              </p>
                            </td>

                            <td className="py-2.5 px-2.5">
                              <div className="flex gap-1 flex-wrap">
                                {STATUSES.map((s) => (
                                  <button
                                    key={s.key}
                                    onClick={() => setRow(emp._id, { status: s.key })}
                                    title={s.label}
                                    className={`w-9 h-7 rounded-lg border text-[11px] font-black transition-all ${
                                      row.status === s.key
                                        ? s.btn
                                        : "bg-white border-slate-200 text-slate-400 hover:border-slate-300"
                                    }`}
                                  >
                                    {s.short}
                                  </button>
                                ))}
                              </div>
                            </td>

                            <td className="py-2.5 px-2.5">
                              <input
                                type="time"
                                value={row.inTime}
                                onChange={(e) => setRow(emp._id, { inTime: e.target.value })}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 text-[11px] font-mono focus:outline-none focus:border-blue-500"
                              />
                            </td>
                            <td className="py-2.5 px-2.5">
                              <input
                                type="time"
                                value={row.outTime}
                                onChange={(e) => setRow(emp._id, { outTime: e.target.value })}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 text-[11px] font-mono focus:outline-none focus:border-blue-500"
                              />
                            </td>
                            <td className="py-2.5 px-2.5">
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={row.overtimeHours}
                                onChange={(e) => setRow(emp._id, { overtimeHours: e.target.value })}
                                placeholder="0"
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 text-[11px] font-mono text-center focus:outline-none focus:border-blue-500"
                              />
                            </td>
                            <td className="py-2.5 px-5">
                              <input
                                type="text"
                                value={row.note}
                                onChange={(e) => setRow(emp._id, { note: e.target.value })}
                                placeholder="—"
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 text-[11px] focus:outline-none focus:border-blue-500"
                              />
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

          {/* ================= MONTHLY VIEW ================= */}
          {tab === "monthly" && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">Monthly Register</h3>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Blank cell = us din attendance mark hi nahi hui.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-[11px] font-black text-slate-700 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={loadMonth}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl p-2 transition-colors"
                  >
                    <FiRefreshCw size={13} className={loadingMonth ? "animate-spin" : ""} />
                  </button>
                </div>
              </div>

              {/* Legend */}
              <div className="px-5 py-2 border-b border-slate-100 flex gap-2 flex-wrap">
                {STATUSES.map((s) => (
                  <span key={s.key} className={`text-[9px] font-black uppercase tracking-wider rounded px-1.5 py-0.5 ${s.cell}`}>
                    {s.short} = {s.label}
                  </span>
                ))}
              </div>

              {monthPeople.length === 0 ? (
                <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-12">
                  Is mahine ka koi record nahi
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="text-left text-xs border-collapse">
                    <thead className="bg-slate-50 text-slate-400 font-black uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="py-2 px-4 sticky left-0 bg-slate-50 z-10 min-w-[150px]">Employee</th>
                        {monthDays.map((d) => (
                          <th key={d} className="py-2 px-1 text-center w-7">{d.slice(-2)}</th>
                        ))}
                        {STATUSES.map((s) => (
                          <th key={s.key} className="py-2 px-2 text-center">{s.short}</th>
                        ))}
                        <th className="py-2 px-3 text-center">OT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {monthPeople.map((person) => {
                        const cells = monthGrid.get(person.id);
                        const counts: Record<string, number> = {};
                        let otTotal = 0;
                        cells?.forEach((rec) => {
                          counts[rec.status] = (counts[rec.status] || 0) + 1;
                          otTotal += Number(rec.overtimeHours) || 0;
                        });

                        return (
                          <tr key={person.id} className="hover:bg-slate-50/60">
                            <td className="py-2 px-4 font-black text-slate-800 sticky left-0 bg-white z-10">{person.name}</td>
                            {monthDays.map((d) => {
                              const rec = cells?.get(d);
                              const meta = rec ? statusMeta(rec.status) : null;
                              return (
                                <td key={d} className="py-1 px-1 text-center">
                                  <span
                                    title={rec ? `${d} — ${meta?.label}${rec.note ? ` (${rec.note})` : ""}` : `${d} — not marked`}
                                    className={`inline-block w-6 leading-5 rounded text-[9px] font-black ${
                                      meta ? meta.cell : "bg-slate-50 text-slate-300"
                                    }`}
                                  >
                                    {meta ? meta.short : "·"}
                                  </span>
                                </td>
                              );
                            })}
                            {STATUSES.map((s) => (
                              <td key={s.key} className="py-2 px-2 text-center font-mono font-bold text-slate-600">
                                {counts[s.key] || 0}
                              </td>
                            ))}
                            <td className="py-2 px-3 text-center font-mono font-black text-blue-700">{otTotal || 0}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ================= EMPLOYEES ================= */}
          {tab === "employees" && (
            <div className="flex flex-col gap-4">

              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 mb-1">Add Employee</h3>
                <p className="text-[10px] text-slate-400 mb-4">
                  Jinke OMS login hain unhe haath se likhne ki zaroorat nahi — Import OMS Users dabao.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {([
                    ["name", "Name *"],
                    ["employeeCode", "Code"],
                    ["mobile", "Mobile"],
                    ["designation", "Designation"],
                  ] as const).map(([field, label]) => (
                    <input
                      key={field}
                      type="text"
                      value={newEmp[field]}
                      onChange={(e) => setNewEmp((p) => ({ ...p, [field]: e.target.value }))}
                      placeholder={label}
                      className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs focus:outline-none focus:border-blue-500"
                    />
                  ))}
                  <input
                    type="number"
                    min="0"
                    value={newEmp.monthlySalary}
                    onChange={(e) => setNewEmp((p) => ({ ...p, monthlySalary: e.target.value }))}
                    placeholder="Monthly Salary"
                    className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs font-mono focus:outline-none focus:border-blue-500"
                  />
                  <input
                    type="date"
                    value={newEmp.joiningDate}
                    onChange={(e) => setNewEmp((p) => ({ ...p, joiningDate: e.target.value }))}
                    title="Joining date"
                    className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button
                    onClick={handleAddEmployee}
                    disabled={savingEmp}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl py-2 px-4 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5"
                  >
                    <FiPlus size={12} /> {savingEmp ? "Adding..." : "Add"}
                  </button>
                  <button
                    onClick={handleImportUsers}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl py-2 px-4 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5"
                  >
                    <FiDownloadCloud size={12} /> Import OMS Users
                  </button>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-3">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">
                    Employee List ({employees.length})
                  </h3>
                  <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-slate-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showInactive}
                      onChange={(e) => setShowInactive(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-300"
                    />
                    Show removed
                  </label>
                </div>

                {loadingEmployees ? (
                  <div className="flex justify-center py-10">
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-blue-500" />
                  </div>
                ) : employees.length === 0 ? (
                  <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-10">
                    Abhi koi employee nahi
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {employees.map((emp) => {
                      const bal = balances[emp._id] || ZERO_BALANCE;
                      return (
                        <div key={emp._id} className="px-5 py-3 flex items-center justify-between gap-3">
                          {/* Whole name block opens the detail panel - salary,
                              increments and the advance/loan ledger all live there. */}
                          <button
                            onClick={() => openDetail(emp)}
                            className="min-w-0 text-left flex-1 group"
                            title="Salary, increment aur advance/loan kholo"
                          >
                            <p className={`text-xs font-black truncate group-hover:text-blue-700 ${emp.isActive ? "text-slate-800" : "text-slate-400 line-through"}`}>
                              {emp.name}
                            </p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              {[emp.employeeCode, emp.designation, emp.mobile].filter(Boolean).join(" · ") || "—"}
                              {emp.linkedUsername && <span className="text-blue-600 ml-2">login: {emp.linkedUsername}</span>}
                            </p>
                            <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                              Joined {prettyDate(emp.joiningDate)}
                            </p>
                          </button>

                          <div className="hidden md:flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200 rounded-lg py-1 px-2">
                              Salary {inr(emp.monthlySalary || 0)}
                            </span>
                            {/* Only shown when something is actually outstanding -
                                a row of zeros is noise on a clean employee. */}
                            {bal.advanceBalance > 0 && (
                              <span className="text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200 rounded-lg py-1 px-2">
                                Advance {inr(bal.advanceBalance)}
                              </span>
                            )}
                            {bal.loanBalance > 0 && (
                              <span className="text-[10px] font-black uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200 rounded-lg py-1 px-2">
                                Loan {inr(bal.loanBalance)}
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => handleToggleActive(emp)}
                            title={emp.isActive ? "Roster se hatao" : "Wapas roster me daalo"}
                            className={`shrink-0 rounded-lg py-1.5 px-3 text-[10px] font-black uppercase tracking-wider border transition-colors flex items-center gap-1.5 ${
                              emp.isActive
                                ? "bg-white hover:bg-rose-50 text-rose-600 border-rose-200"
                                : "bg-white hover:bg-emerald-50 text-emerald-700 border-emerald-200"
                            }`}
                          >
                            {emp.isActive ? <><FiSlash size={11} /> Remove</> : <><FiRotateCcw size={11} /> Restore</>}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}


          {/* ============ EMPLOYEE DETAIL: salary, increments, advance & loan ============ */}
          {detailEmp && (
            <div
              className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm overflow-y-auto"
              onClick={() => setDetailEmp(null)}
            >
              <div
                className="bg-[#f3f6f9] rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden my-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-5 bg-white border-b border-slate-200 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-black uppercase tracking-wider text-[#0a2540] truncate">{detailEmp.name}</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                      Joined {prettyDate(detailEmp.joiningDate)}
                      {detailEmp.designation ? ` \u00b7 ${detailEmp.designation}` : ""}
                      {detailEmp.mobile ? ` \u00b7 ${detailEmp.mobile}` : ""}
                      {detailEmp.linkedUsername ? ` \u00b7 login: ${detailEmp.linkedUsername}` : ""}
                    </p>
                  </div>
                  <button onClick={() => setDetailEmp(null)} className="text-slate-400 hover:text-slate-700 shrink-0">
                    <FiX size={18} />
                  </button>
                </div>

                <div className="p-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">

                  {/* ---- Salary & increments ---- */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                        <FiTrendingUp className="text-blue-600" size={13} /> Salary
                      </h4>
                      <span className="text-sm font-black text-slate-900 font-mono">
                        {inr(detailEmp.monthlySalary || 0)}<span className="text-[10px] text-slate-400 font-bold"> / month</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <input
                        type="number"
                        min="0"
                        value={incForm.newSalary}
                        onChange={(e) => setIncForm((p) => ({ ...p, newSalary: e.target.value }))}
                        placeholder="New salary"
                        className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-blue-500"
                      />
                      <input
                        type="date"
                        value={incForm.effectiveDate}
                        onChange={(e) => setIncForm((p) => ({ ...p, effectiveDate: e.target.value }))}
                        title="Kis date se lagu"
                        className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-blue-500"
                      />
                      <input
                        type="text"
                        value={incForm.note}
                        onChange={(e) => setIncForm((p) => ({ ...p, note: e.target.value }))}
                        placeholder="Reason"
                        className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-blue-500"
                      />
                      <button
                        onClick={handleSaveIncrement}
                        disabled={savingDetail}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl py-2 px-3 text-[10px] font-black uppercase tracking-wider"
                      >
                        Update Salary
                      </button>
                    </div>

                    {(detailEmp.salaryHistory?.length || 0) > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                        {[...(detailEmp.salaryHistory || [])].reverse().map((h, i) => (
                          <div key={`${h.date}-${i}`} className="flex items-center justify-between gap-3 text-[11px]">
                            <span className="font-bold text-slate-400 font-mono w-24 shrink-0">{h.date}</span>
                            <span className="font-mono text-slate-700 flex-1">
                              {inr(h.oldSalary)} <span className="text-slate-300">&rarr;</span>{" "}
                              <span className="font-black">{inr(h.newSalary)}</span>
                            </span>
                            <span className="text-slate-400 truncate max-w-[45%] text-right">{h.note || ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ---- Advance & loan ledger ---- */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                      <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                        <FiCreditCard className="text-blue-600" size={13} /> Advance &amp; Loan
                      </h4>
                      <div className="flex gap-2">
                        <span className="text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200 rounded-lg py-1 px-2">
                          Advance baki {inr(detailBalance.advanceBalance)}
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200 rounded-lg py-1 px-2">
                          Loan baki {inr(detailBalance.loanBalance)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <select
                        value={ledgerForm.type}
                        onChange={(e) => setLedgerForm((p) => ({ ...p, type: e.target.value as LedgerType }))}
                        className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-2 text-xs font-bold focus:outline-none focus:border-blue-500"
                      >
                        {LEDGER_TYPES.map((t) => (
                          <option key={t.key} value={t.key}>{t.label}</option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={ledgerForm.date}
                        onChange={(e) => setLedgerForm((p) => ({ ...p, date: e.target.value }))}
                        className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-2 text-xs focus:outline-none focus:border-blue-500"
                      />
                      <input
                        type="number"
                        min="0"
                        value={ledgerForm.amount}
                        onChange={(e) => setLedgerForm((p) => ({ ...p, amount: e.target.value }))}
                        placeholder="Amount"
                        className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-blue-500"
                      />
                      <input
                        type="text"
                        value={ledgerForm.note}
                        onChange={(e) => setLedgerForm((p) => ({ ...p, note: e.target.value }))}
                        placeholder="Note"
                        className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-blue-500"
                      />
                      <button
                        onClick={handleAddLedger}
                        disabled={savingDetail}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl py-2 px-3 text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5"
                      >
                        <FiPlus size={12} /> Add
                      </button>
                    </div>

                    <div className="mt-3 pt-3 border-t border-slate-100">
                      {loadingDetail ? (
                        <div className="flex justify-center py-6">
                          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-blue-500" />
                        </div>
                      ) : ledger.length === 0 ? (
                        <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest text-center py-6">
                          Koi advance / loan entry nahi
                        </p>
                      ) : (
                        <div className="space-y-1 max-h-56 overflow-y-auto">
                          {ledger.map((entry) => {
                            const meta = ledgerMeta(entry.type);
                            return (
                              <div key={entry._id} className="flex items-center gap-3 text-[11px] py-1">
                                <span className="font-bold text-slate-400 font-mono w-24 shrink-0">{entry.date}</span>
                                <span className={`font-black uppercase tracking-wider w-28 shrink-0 ${meta?.tone}`}>
                                  {meta?.label}
                                </span>
                                <span className="font-mono font-black text-slate-800 w-24 shrink-0 text-right">
                                  {meta?.sign}{inr(entry.amount)}
                                </span>
                                <span className="text-slate-400 truncate flex-1">{entry.note || ""}</span>
                                <button
                                  onClick={() => handleDeleteLedger(entry)}
                                  title="Ye entry delete karo"
                                  className="text-slate-300 hover:text-rose-600 shrink-0"
                                >
                                  <FiTrash2 size={12} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </BlockGuard>
  );
}
