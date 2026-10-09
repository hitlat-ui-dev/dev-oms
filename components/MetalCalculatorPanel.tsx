"use client";
import { useMemo, useState } from "react";
import { DENSITIES, METAL_SHAPES, SHAPES, UNIT_TO_M, Unit } from "@/lib/metalConfig";

const UNITS: Unit[] = ["mm", "meter", "inch"];
const METALS = Object.keys(DENSITIES);

const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

// Core weight-per-meter / total-weight calculator - shared by its own full
// page (app/dashboard/metal-calculator/page.tsx, which just adds the Back
// button/page chrome around this) and the Header's quick-access popup, the
// same split already used for Urgent Tasks and GeM Login Setup.
export default function MetalCalculatorPanel() {
  const [metal, setMetal] = useState(METALS[0]);
  const [shape, setShape] = useState(METAL_SHAPES[METALS[0]][0]);
  const [unit, setUnit] = useState<Unit>("mm");
  const [dims, setDims] = useState<Record<string, string>>({});
  const [length, setLength] = useState("");

  const def = SHAPES[shape];

  const result = useMemo(() => {
    const factor = def.fixedUnit ? 1 : UNIT_TO_M[unit];
    const vals: Record<string, number> = {};
    for (const key of Object.keys(def.fields)) {
      const raw = dims[key];
      const v = parseFloat(raw ?? "");
      if (raw === undefined || raw === "" || isNaN(v) || v <= 0) return null;
      vals[key] = v * factor;
    }
    const area = def.area(vals);
    if (area <= 0) {
      return { error: "Dimensions galat hain — ID/Wall/Thickness check karo (e.g. Inner Dia Outer Dia se chhoti honi chahiye)." };
    }
    const kgPerM = area * DENSITIES[metal];
    const len = parseFloat(length);
    return { kgPerM, total: isNaN(len) || len <= 0 ? null : kgPerM * len };
  }, [metal, unit, dims, length, def]);

  const changeMetal = (m: string) => {
    setMetal(m);
    setShape(METAL_SHAPES[m][0]);
    setDims({});
  };

  const changeShape = (s: string) => {
    setShape(s);
    setDims({});
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Metal</label>
            <select
              value={metal}
              onChange={(e) => changeMetal(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold text-slate-700 focus:outline-none focus:border-blue-500"
            >
              {METALS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Shape</label>
            <select
              value={shape}
              onChange={(e) => changeShape(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold text-slate-700 focus:outline-none focus:border-blue-500"
            >
              {METAL_SHAPES[metal].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!def.fixedUnit && (
          <div className="flex gap-2">
            {UNITS.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                className={`flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-colors ${
                  unit === u
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {Object.entries(def.fields).map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                {label}
                {!def.fixedUnit && <span className="normal-case text-slate-400 font-bold"> ({unit})</span>}
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={dims[key] || ""}
                onChange={(e) => setDims({ ...dims, [key]: e.target.value })}
                placeholder="0"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold text-slate-700 focus:outline-none focus:border-blue-500"
              />
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Length (meter)</label>
          <input
            type="number"
            min="0"
            step="any"
            value={length}
            onChange={(e) => setLength(e.target.value)}
            placeholder="Total length for the full weight"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold text-slate-700 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        {result && "error" in result ? (
          <p className="text-rose-600 font-bold text-sm">{result.error}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">1 meter</span>
              <span className="text-xl font-black text-slate-800 block mt-1">
                {result ? round3(result.kgPerM) : "—"} <span className="text-xs font-bold text-slate-400">kg/m</span>
              </span>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <span className="text-[9px] font-black uppercase text-emerald-600 tracking-wider block">Total Weight</span>
              <span className="text-xl font-black text-emerald-800 block mt-1">
                {result?.total != null ? round3(result.total) : "—"} <span className="text-xs font-bold text-emerald-600">kg</span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
