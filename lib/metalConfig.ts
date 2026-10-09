// lib/metalConfig.ts
//
// Metal Calculator's density/shape/formula data - kept separate from the
// page component so adding a metal (e.g. Brass, Stainless Steel) or a shape
// later is a data-only change, no UI code to touch.

export const DENSITIES: Record<string, number> = {
  Copper: 8960,
  Aluminium: 2700,
  "Cast Iron": 7200,
  "Iron / Mild Steel": 7850,
};

export type Unit = "mm" | "meter" | "inch";

// Multiply a value in this unit by this factor to get meters.
export const UNIT_TO_M: Record<Unit, number> = {
  mm: 0.001,
  meter: 1,
  inch: 0.0254,
};

export interface ShapeDef {
  // field key -> input label, in the order they should be shown
  fields: Record<string, string>;
  // Cross-section area in m^2, given field values already converted to
  // meters (or, for a fixedUnit shape, in whatever unit that shape expects).
  area: (vals: Record<string, number>) => number;
  // Cable sizes are given directly in sq.mm, not a length-based unit - the
  // mm/meter/inch toggle doesn't apply, so this skips unit conversion
  // entirely rather than forcing a meaningless "unit" onto it.
  fixedUnit?: boolean;
}

export const SHAPES: Record<string, ShapeDef> = {
  "Round Bar": {
    fields: { d: "Diameter" },
    area: ({ d }) => (Math.PI / 4) * d * d,
  },
  Wire: {
    fields: { d: "Diameter" },
    area: ({ d }) => (Math.PI / 4) * d * d,
  },
  "Square Bar": {
    fields: { a: "Side" },
    area: ({ a }) => a * a,
  },
  "Flat Bar": {
    fields: { w: "Width", t: "Thickness" },
    area: ({ w, t }) => w * t,
  },
  Plate: {
    fields: { w: "Width", t: "Thickness" },
    area: ({ w, t }) => w * t,
  },
  "Pipe (OD + ID)": {
    fields: { D: "Outer Dia", d: "Inner Dia" },
    area: ({ D, d }) => (Math.PI / 4) * (D * D - d * d),
  },
  "Pipe (OD + Wall)": {
    fields: { D: "Outer Dia", t: "Wall Thickness" },
    area: ({ D, t }) => (Math.PI / 4) * (D * D - (D - 2 * t) ** 2),
  },
  "Angle (L)": {
    fields: { a: "Leg 1", b: "Leg 2", t: "Thickness" },
    area: ({ a, b, t }) => (a + b - t) * t,
  },
  "Channel (C)": {
    fields: { h: "Height", w: "Flange Width", t: "Thickness" },
    area: ({ h, w, t }) => (h + 2 * w - 2 * t) * t,
  },
  "Cable (Conductor)": {
    fields: { n: "No. of Cores", s: "Size (sq.mm)" },
    // n is a count, s is already sq.mm - converts straight to m^2 (x1e-6),
    // no mm/meter/inch factor involved (see fixedUnit above).
    area: ({ n, s }) => n * s * 1e-6,
    fixedUnit: true,
  },
};

export const METAL_SHAPES: Record<string, string[]> = {
  Copper: ["Pipe (OD + ID)", "Pipe (OD + Wall)", "Plate", "Flat Bar", "Wire", "Round Bar", "Cable (Conductor)"],
  Aluminium: [
    "Wire",
    "Flat Bar",
    "Round Bar",
    "Plate",
    "Pipe (OD + ID)",
    "Pipe (OD + Wall)",
    "Angle (L)",
    "Channel (C)",
    "Cable (Conductor)",
  ],
  "Cast Iron": ["Square Bar", "Round Bar", "Flat Bar", "Plate", "Pipe (OD + ID)", "Pipe (OD + Wall)"],
  "Iron / Mild Steel": [
    "Round Bar",
    "Square Bar",
    "Flat Bar",
    "Angle (L)",
    "Channel (C)",
    "Pipe (OD + ID)",
    "Pipe (OD + Wall)",
    "Plate",
    "Wire",
    "Cable (Conductor)",
  ],
};
