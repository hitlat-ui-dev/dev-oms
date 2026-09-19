/*
 * Zero-dependency .xlsx writer.
 *
 * Chrome Manifest V3 extensions cannot load remote/bundled third-party
 * libraries the store hasn't vetted, and this build environment has no
 * network access to fetch SheetJS, so this is a small hand-written writer
 * instead. It produces a real OOXML (.xlsx) file: a ZIP (stored / no
 * compression, so no deflate implementation is needed) containing the
 * minimal set of XML parts Excel requires. Every cell is written as an
 * inline string, which sidesteps the shared-strings table entirely and
 * keeps this file self-contained.
 *
 * Exposes: window.buildXlsx(headers: string[], rows: string[][], options?: { highlightRows?: Set<number>, hyperlinkColumns?: number[] }) -> Uint8Array
 * highlightRows is a set of 0-based indices into `rows` (NOT counting the
 * header row) whose entire row should be filled yellow in the output.
 * hyperlinkColumns is a list of 0-based column indices (into `headers`)
 * whose cells, when the value looks like an http(s) URL, become real
 * clickable Excel hyperlinks (not just text that happens to look like one).
 */
(function (global) {
  "use strict";

  // ---------- CRC32 ----------
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // ---------- byte helpers ----------
  function u16(n) {
    return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
  }
  function u32(n) {
    return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
  }
  function concatBytes(arrays) {
    let total = 0;
    for (const a of arrays) total += a.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
      out.set(a, offset);
      offset += a.length;
    }
    return out;
  }
  function strToBytes(str) {
    return new TextEncoder().encode(str);
  }

  // ---------- minimal stored-only ZIP writer ----------
  function makeZip(files) {
    // files: [{ name: string, data: Uint8Array }]
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = strToBytes(file.name);
      const data = file.data;
      const crc = crc32(data);
      const size = data.length;

      const localHeader = concatBytes([
        u32(0x04034b50),
        u16(20), // version needed
        u16(0), // flags
        u16(0), // method: stored
        u16(0), // mod time
        u16(0), // mod date
        u32(crc),
        u32(size), // compressed size == size (stored)
        u32(size), // uncompressed size
        u16(nameBytes.length),
        u16(0), // extra length
        nameBytes,
      ]);

      localParts.push(localHeader, data);

      const centralHeader = concatBytes([
        u32(0x02014b50),
        u16(20), // version made by
        u16(20), // version needed
        u16(0), // flags
        u16(0), // method
        u16(0), // mod time
        u16(0), // mod date
        u32(crc),
        u32(size),
        u32(size),
        u16(nameBytes.length),
        u16(0), // extra length
        u16(0), // comment length
        u16(0), // disk number start
        u16(0), // internal attrs
        u32(0), // external attrs
        u32(offset), // local header offset
        nameBytes,
      ]);
      centralParts.push(centralHeader);

      offset += localHeader.length + data.length;
    }

    const centralDir = concatBytes(centralParts);
    const centralOffset = offset;

    const end = concatBytes([
      u32(0x06054b50),
      u16(0), // disk number
      u16(0), // disk with cd
      u16(files.length), // entries this disk
      u16(files.length), // total entries
      u32(centralDir.length),
      u32(centralOffset),
      u16(0), // comment length
    ]);

    return concatBytes([...localParts, centralDir, end]);
  }

  // ---------- XML escaping ----------
  function xmlEscape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/\r?\n/g, " ")
      // strip control chars XML 1.0 doesn't allow
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  }

  function colName(index) {
    // 0-based column index -> A, B, ..., Z, AA, AB, ...
    let n = index + 1;
    let name = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function buildSheetXml(headers, rows, highlightRowSet, hyperlinkColSet) {
    const allRows = [headers, ...rows];
    const hyperlinks = []; // { ref, target }
    const rowsXml = allRows
      .map((row, rIdx) => {
        const rowNum = rIdx + 1;
        const isHeader = rIdx === 0;
        // rIdx - 1 because allRows[0] is the header row, so data row 0
        // (the first actual record) lives at allRows[1].
        const isHighlighted = !isHeader && highlightRowSet && highlightRowSet.has(rIdx - 1);
        const cells = row
          .map((val, cIdx) => {
            const ref = colName(cIdx) + rowNum;
            const isLinkCell =
              !isHeader && hyperlinkColSet && hyperlinkColSet.has(cIdx) && /^https?:\/\//i.test(val || "");
            if (isLinkCell) hyperlinks.push({ ref, target: val });
            // Highlighted-row yellow takes visual priority over the blue
            // hyperlink style so "whole row highlighted" stays true even
            // for the link cell itself; the cell is still a real,
            // clickable hyperlink either way (that's driven by the
            // <hyperlinks> block below, not by which style index it uses).
            const styleAttr = isHeader ? ' s="1"' : isHighlighted ? ' s="2"' : isLinkCell ? ' s="3"' : "";
            return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t xml:space="preserve">${xmlEscape(val)}</t></is></c>`;
          })
          .join("");
        return `<row r="${rowNum}">${cells}</row>`;
      })
      .join("");

    const colCount = headers.length;
    const lastCol = colName(Math.max(colCount - 1, 0));
    const lastRow = allRows.length;

    const hyperlinksXml = hyperlinks.length
      ? `<hyperlinks>${hyperlinks
          .map((h, i) => `<hyperlink ref="${h.ref}" r:id="rId${i + 1}"/>`)
          .join("")}</hyperlinks>`
      : "";

    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<dimension ref="A1:${lastCol}${lastRow}"/>` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="15"/>` +
      `<cols>${headers.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="24" customWidth="1"/>`).join("")}</cols>` +
      `<sheetData>${rowsXml}</sheetData>` +
      hyperlinksXml +
      `</worksheet>`;

    return { xml, hyperlinks };
  }

  const CONTENT_TYPES_XML =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;

  const RELS_XML =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const WORKBOOK_XML =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="Bids" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`;

  const WORKBOOK_RELS_XML =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const STYLES_XML =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><sz val="11"/><b/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
    `<font><sz val="11"/><color rgb="FF2563EB"/><u/><name val="Calibri"/></font></fonts>` +
    `<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `</cellXfs>` +
    `</styleSheet>`;

  function buildXlsx(headers, rows, options) {
    const highlightRowSet = (options && options.highlightRows) || null;
    const hyperlinkColSet = options && options.hyperlinkColumns ? new Set(options.hyperlinkColumns) : null;
    const { xml: sheetXml, hyperlinks } = buildSheetXml(headers, rows, highlightRowSet, hyperlinkColSet);
    const files = [
      { name: "[Content_Types].xml", data: strToBytes(CONTENT_TYPES_XML) },
      { name: "_rels/.rels", data: strToBytes(RELS_XML) },
      { name: "xl/workbook.xml", data: strToBytes(WORKBOOK_XML) },
      { name: "xl/_rels/workbook.xml.rels", data: strToBytes(WORKBOOK_RELS_XML) },
      { name: "xl/styles.xml", data: strToBytes(STYLES_XML) },
      { name: "xl/worksheets/sheet1.xml", data: strToBytes(sheetXml) },
    ];
    if (hyperlinks.length) {
      const relsXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        hyperlinks
          .map(
            (h, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(h.target)}" TargetMode="External"/>`
          )
          .join("") +
        `</Relationships>`;
      files.push({ name: "xl/worksheets/_rels/sheet1.xml.rels", data: strToBytes(relsXml) });
    }
    return makeZip(files);
  }

  global.buildXlsx = buildXlsx;
})(typeof window !== "undefined" ? window : globalThis);
