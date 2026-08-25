// pdfjs-dist (used internally by pdf-parse) references the browser-only
// DOMMatrix class for certain PDF content - pattern fills and, notably,
// Type3-font glyph path transforms (Type3 fonts define each glyph as a
// drawing program rather than standard character codes, so pdfjs-dist has
// to execute that program - via DOMMatrix-based path transforms - to
// extract the actual text). Outside a browser this throws
// "DOMMatrix is not defined" - confirmed live in CourierRunLog: the
// 2026-08-21 and 2026-08-23 automated runs both failed with exactly this
// message, presumably from a courier PDF using Type3 fonts (most PDFs
// don't hit this codepath at all, which is why most runs succeed).
//
// pdfjs-dist has its own fallback (`if (!globalThis.DOMMatrix) { try
// require("canvas") ... }`), but this app deliberately doesn't depend on
// the `canvas` package - it's a native/compiled dependency, a poor fit for
// a Vercel serverless deployment. This is a small pure-JS 2D affine-matrix
// polyfill covering just the DOMMatrix surface pdfjs-dist actually calls
// (confirmed by inspecting node_modules/pdfjs-dist/legacy/build/pdf.mjs):
// the array constructor, translate/scale, multiplySelf/preMultiplySelf,
// and invertSelf. Installed as globalThis.DOMMatrix before pdf-parse runs,
// pdfjs-dist's own `if (!globalThis.DOMMatrix)` check finds it already set
// and skips its own (broken, since `canvas` isn't installed) attempt.
class DOMMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: number[]) {
    if (Array.isArray(init) && init.length >= 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init;
    }
  }

  // this = this ⋅ other (spec order: `this` post-multiplied by `other`)
  multiplySelf(other: DOMMatrixPolyfill): this {
    const { a, b, c, d, e, f } = this;
    this.a = a * other.a + c * other.b;
    this.b = b * other.a + d * other.b;
    this.c = a * other.c + c * other.d;
    this.d = b * other.c + d * other.d;
    this.e = a * other.e + c * other.f + e;
    this.f = b * other.e + d * other.f + f;
    return this;
  }

  // this = other ⋅ this
  preMultiplySelf(other: DOMMatrixPolyfill): this {
    const result = new DOMMatrixPolyfill([other.a, other.b, other.c, other.d, other.e, other.f]);
    result.multiplySelf(this);
    this.a = result.a;
    this.b = result.b;
    this.c = result.c;
    this.d = result.d;
    this.e = result.e;
    this.f = result.f;
    return this;
  }

  // Per spec: returns a NEW matrix, this post-multiplied by a translation matrix.
  translate(tx: number, ty: number): DOMMatrixPolyfill {
    return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(
      new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty])
    );
  }

  // Per spec: returns a NEW matrix, this post-multiplied by a scale matrix.
  scale(sx: number, sy?: number): DOMMatrixPolyfill {
    return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(
      new DOMMatrixPolyfill([sx, 0, 0, sy ?? sx, 0, 0])
    );
  }

  invertSelf(): this {
    const { a, b, c, d, e, f } = this;
    const det = a * d - b * c;
    if (!det) {
      // Matches native DOMMatrix behavior for a non-invertible matrix.
      this.a = this.b = this.c = this.d = this.e = this.f = NaN;
      return this;
    }
    this.a = d / det;
    this.b = -b / det;
    this.c = -c / det;
    this.d = a / det;
    this.e = (c * f - d * e) / det;
    this.f = (b * e - a * f) / det;
    return this;
  }
}

export function installDOMMatrixPolyfillIfMissing(): void {
  if (typeof (globalThis as any).DOMMatrix !== "undefined") return;
  (globalThis as any).DOMMatrix = DOMMatrixPolyfill;
}
