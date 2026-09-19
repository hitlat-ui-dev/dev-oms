/*
 * Minimal, dependency-free PDF text extractor.
 *
 * This is deliberately NOT a full PDF parser (no xref table walking, no
 * font CMap / ToUnicode decoding, no support for object streams / cross
 * reference streams used by some PDF producers). It is a best-effort
 * extractor built for one job: pull readable text out of standard,
 * non-scanned "form filled" PDFs like GeM's auto-generated bid documents,
 * well enough to locate known field labels and grab the value that
 * follows them.
 *
 * How it works:
 *   1. Scan the raw file for "N G obj ... endobj" blocks (regex over the
 *      file treated as Latin-1 text, so string offsets line up 1:1 with
 *      byte offsets).
 *   2. For blocks that contain a stream with /FlateDecode, inflate it
 *      with the browser's native DecompressionStream('deflate') API
 *      (Chrome ships this - no external zlib/inflate library needed).
 *   3. Scan the decompressed content stream for PDF text-showing
 *      operators - "(...) Tj" and "[(...) ... ] TJ" - and pull out the
 *      literal string contents, inserting a line break on Td/TD/T*.
 *   4. Concatenate everything into one plain-text blob, in object order.
 *
 * KNOWN LIMITATIONS (documented in README.md too):
 *   - Text drawn via embedded/subset fonts with custom encodings (common
 *     for complex scripts like Devanagari) will often come out garbled or
 *     missing, because proper decoding needs the font's ToUnicode CMap,
 *     which this extractor does not parse. Plain Latin/ASCII text
 *     (English labels, numbers, dates) usually extracts fine, which is
 *     why field matching below is done against the English portion of
 *     each bilingual label.
 *   - Scanned/image-only PDFs (no real text layer) will yield nothing.
 *   - Object-stream (cross-reference stream, PDF 1.5+ compressed objects)
 *     PDFs may hide some objects from the simple "N G obj" scan.
 *
 * Exposes on window:
 *   extractPdfText(arrayBuffer) -> Promise<string>
 *   extractFieldsFromText(text, labels) -> { [label]: string }
 *   extractBidPdfFields(arrayBuffer, labels) -> Promise<{ text, fields }>
 */
(function (global) {
  "use strict";

  async function inflateDeflate(bytes) {
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    // Attach a .catch immediately so a write-side failure (e.g. malformed
    // zlib data) never surfaces as an unhandled promise rejection - the
    // reader loop below will see (and we'll throw/propagate) the matching
    // error on the read side, which the caller already wraps in try/catch.
    const writeDone = writer
      .write(bytes)
      .then(() => writer.close())
      .catch(() => {});
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
    } finally {
      await writeDone;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }

  function decodeLiteralString(raw) {
    // raw = contents between the outer parens, with escape sequences
    // still literally present (backslash + char) exactly as written.
    let out = "";
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c !== "\\") {
        out += c;
        continue;
      }
      const n = raw[i + 1];
      if (n === "n") {
        out += "\n";
        i++;
      } else if (n === "r") {
        out += "\r";
        i++;
      } else if (n === "t") {
        out += "\t";
        i++;
      } else if (n === "(" || n === ")" || n === "\\") {
        out += n;
        i++;
      } else if (n === "\n") {
        i++; // line continuation, drop
      } else if (n === "\r") {
        i++;
        if (raw[i + 1] === "\n") i++;
      } else if (n >= "0" && n <= "7") {
        let oct = "";
        let j = i + 1;
        while (j < raw.length && oct.length < 3 && raw[j] >= "0" && raw[j] <= "7") {
          oct += raw[j];
          j++;
        }
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        i = j - 1;
      } else {
        out += n;
        i++;
      }
    }
    return out;
  }

  function isBoundary(ch) {
    return ch === undefined || /[\s\/\[\]<>()]/.test(ch);
  }

  // Decodes a hex string like "004100420043" into text, 4 hex digits (one
  // UTF-16BE code unit) at a time - the layout used both by ToUnicode CMap
  // destination values and, coincidentally, by the 2-byte character codes
  // Identity-H encoded fonts show text with.
  function decodeHex4PerUnit(hex) {
    let out = "";
    for (let i = 0; i < hex.length; i += 4) {
      const unit = parseInt(hex.slice(i, i + 4).padEnd(4, "0"), 16);
      if (!Number.isNaN(unit)) out += String.fromCharCode(unit);
    }
    return out;
  }

  // Parses a /ToUnicode CMap program (already decompressed to text) into a
  // Map from character code -> the Unicode string it represents. Handles
  // both bfchar (one-to-one) and bfrange (range, either a single
  // incrementing destination or an explicit destination array) entries,
  // which together cover the vast majority of CMaps real PDF producers
  // emit.
  function parseToUnicodeCMap(cmapText) {
    const map = new Map();
    for (const block of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        map.set(parseInt(pair[1], 16), decodeHex4PerUnit(pair[2]));
      }
    }
    // Each bfrange entry is "<srcStart> <srcEnd> " followed by EITHER a
    // single "<dst>" (destination increments per code) OR a
    // "[<d0> <d1> ...]" explicit array (one destination per code,
    // independent of srcEnd-srcStart). These two forms must be parsed as
    // one mutually-exclusive pass over the text - matching both forms
    // with separate global regexes against the same block (as an earlier
    // version of this code did) lets the range-form regex "find" spurious
    // 3-hex-value matches *inside* an array's own hex tokens, silently
    // corrupting the map with bogus entries.
    for (const block of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      const body = block[1];
      const entryRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[([^\]]*)\]|<([0-9A-Fa-f]+)>)/g;
      let em;
      while ((em = entryRe.exec(body)) !== null) {
        const start = parseInt(em[1], 16);
        const end = parseInt(em[2], 16);
        if (em[4] != null) {
          // array form
          const dsts = [...em[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => decodeHex4PerUnit(x[1]));
          dsts.forEach((str, i) => map.set(start + i, str));
        } else if (em[5] != null) {
          // single incrementing-destination form
          if (end - start <= 65535) {
            const dstBase = parseInt(em[5].slice(-4).padEnd(4, "0"), 16);
            for (let c = start; c <= end; c++) map.set(c, String.fromCharCode(dstBase + (c - start)));
          }
        }
      }
    }
    return map;
  }

  // Font-aware content-stream scanner. Handles both literal "(...)" strings
  // (simple fonts, WinAnsi-ish bytes) and hex "<...>" strings (the format
  // Identity-H / CID composite fonts use - each 4 hex digits is one glyph
  // code, decoded through that font's /ToUnicode map when available).
  // `fontMaps` is Map<fontObjNum, Map<code,string>>; `fontNameToObj` is
  // Map<"/F6" style resource name (without the slash), fontObjNum> for
  // whichever page this content stream belongs to.
  // This document (and most generators that use per-glyph positioning for
  // precise/complex-script layout) draws each "run" of text inside its own
  // BT...ET block: a "Tm" resets the text matrix to identity right after
  // BT, so the FIRST Td that follows carries an absolute-ish page position
  // for that run, while any further Td calls before the matching ET are
  // just small kerning steps *within* that run. Some generators (this one
  // included) also draw a run a second time, wrapped in a marked-content
  // BDC/EMC block at nearly the same position, to fake bold without a bold
  // font - each such re-draw is preceded by its own "Tm", which is treated
  // as a run boundary the same way BT is.
  //
  // Reconstructing the real page layout (as a proper PDF renderer would)
  // is out of scope here; instead each finished run's anchor position is
  // compared to the previous run's to decide whether to join them with a
  // space (same line), a newline (new line), or drop the run entirely
  // (near-identical text at a near-identical position = a bold-simulation
  // duplicate).
  function extractShowTokens(streamText, fontMaps, fontNameToObj) {
    const tokens = [];
    const n = streamText.length;
    let i = 0;
    let currentFontNum = null;

    let runStarted = false; // seen this run's anchoring Td yet?
    let runX = 0;
    let runY = 0;
    let runText = "";
    let haveLast = false;
    let lastX = 0;
    let lastY = 0;
    let lastText = "";

    function finalizeRun() {
      if (!runText) {
        runStarted = false;
        return;
      }
      const isDuplicateDraw = haveLast && runText === lastText && Math.abs(runX - lastX) < 400 && Math.abs(runY - lastY) < 3;
      if (!isDuplicateDraw) {
        if (haveLast) {
          tokens.push({ type: Math.abs(runY - lastY) > 3 ? "break" : "space" });
        }
        tokens.push({ type: "str", value: runText });
        lastX = runX;
        lastY = runY;
        lastText = runText;
        haveLast = true;
      }
      runStarted = false;
      runText = "";
    }

    while (i < n) {
      const c = streamText[i];

      if (c === "(") {
        let depth = 1;
        let j = i + 1;
        let raw = "";
        while (j < n && depth > 0) {
          const cj = streamText[j];
          if (cj === "\\") {
            raw += cj + (streamText[j + 1] || "");
            j += 2;
            continue;
          }
          if (cj === "(") depth++;
          if (cj === ")") {
            depth--;
            if (depth === 0) {
              j++;
              break;
            }
          }
          raw += cj;
          j++;
        }
        runText += decodeLiteralString(raw);
        i = j;
        continue;
      }

      if (c === "<") {
        if (streamText[i + 1] === "<") {
          // Inline dictionary (marked-content props, inline image dict) -
          // skip over it rather than misreading it as a hex string.
          let depth = 1;
          let j = i + 2;
          while (j < n && depth > 0) {
            if (streamText[j] === "<" && streamText[j + 1] === "<") {
              depth++;
              j += 2;
              continue;
            }
            if (streamText[j] === ">" && streamText[j + 1] === ">") {
              depth--;
              j += 2;
              continue;
            }
            j++;
          }
          i = j;
          continue;
        }
        let j = i + 1;
        let hex = "";
        while (j < n && streamText[j] !== ">") {
          hex += streamText[j];
          j++;
        }
        j++; // skip closing '>'
        hex = hex.replace(/\s+/g, "");
        const map = currentFontNum != null ? fontMaps.get(currentFontNum) : null;
        let decoded = "";
        if (map) {
          for (let k = 0; k < hex.length; k += 4) {
            const code = parseInt(hex.slice(k, k + 4).padEnd(4, "0"), 16);
            if (map.has(code)) decoded += map.get(code);
          }
        } else {
          // No ToUnicode map for the active font (or none tracked yet) -
          // best-effort fallback: treat as 1 byte per character.
          for (let k = 0; k < hex.length; k += 2) {
            decoded += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, "0"), 16));
          }
        }
        runText += decoded;
        i = j;
        continue;
      }

      if (c === "/") {
        let j = i + 1;
        let name = "";
        while (j < n && /[A-Za-z0-9.\-+_]/.test(streamText[j])) {
          name += streamText[j];
          j++;
        }
        if (name && fontNameToObj.has(name)) {
          const ahead = streamText.slice(j, j + 40);
          if (/^\s+[\d.\-]+\s+Tf\b/.test(ahead)) currentFontNum = fontNameToObj.get(name);
        }
        i = j || i + 1;
        continue;
      }

      if (c === "B" && streamText[i + 1] === "T" && isBoundary(streamText[i - 1]) && isBoundary(streamText[i + 2])) {
        finalizeRun();
        i += 2;
        continue;
      }
      if (c === "E" && streamText[i + 1] === "T" && isBoundary(streamText[i - 1]) && isBoundary(streamText[i + 2])) {
        finalizeRun();
        i += 2;
        continue;
      }
      if (c === "T" && streamText[i + 1] === "m" && isBoundary(streamText[i - 1]) && isBoundary(streamText[i + 2])) {
        // Text matrix reset - the next Td starts a fresh run anchor.
        finalizeRun();
        i += 2;
        continue;
      }
      if (
        c === "T" &&
        (streamText[i + 1] === "d" || streamText[i + 1] === "D") &&
        isBoundary(streamText[i - 1]) &&
        isBoundary(streamText[i + 2])
      ) {
        if (!runStarted) {
          const before = streamText.slice(Math.max(0, i - 40), i);
          const numMatch = before.match(/(-?[\d.]+)\s+(-?[\d.]+)\s*$/);
          if (numMatch) {
            runX = parseFloat(numMatch[1]);
            runY = parseFloat(numMatch[2]);
          }
          runStarted = true;
        }
        // Further Td calls before the next Tm/BT/ET are just kerning steps
        // within the same run - position doesn't need updating for them.
        i += 2;
        continue;
      }
      if (c === "T" && streamText[i + 1] === "*" && isBoundary(streamText[i - 1]) && isBoundary(streamText[i + 2])) {
        finalizeRun();
        i += 2;
        continue;
      }
      i++;
    }
    finalizeRun();
    return tokens;
  }

  function tokensToText(tokens) {
    const lines = [""];
    for (const t of tokens) {
      if (t.type === "break") lines.push("");
      else if (t.type === "space") {
        const cur = lines[lines.length - 1];
        if (cur.length && !/\s$/.test(cur)) lines[lines.length - 1] += " ";
      } else lines[lines.length - 1] += t.value;
    }
    return lines.join("\n");
  }

  // Locate every "N G obj" header in the file. Real-world PDF producers
  // (iText, PDFBox, etc.) almost always give streams an *indirect*
  // /Length (e.g. "/Length 10 0 R" pointing at another small object that
  // just contains the integer), rather than a literal number - so
  // resolving /Length means being able to look up any object by number.
  function indexObjects(latin1) {
    const headerRe = /(\d+)[ \t]+(\d+)[ \t]+obj\b/g;
    const objects = [];
    const byNum = new Map();
    let m;
    while ((m = headerRe.exec(latin1)) !== null) {
      const entry = { num: parseInt(m[1], 10), gen: parseInt(m[2], 10), start: m.index, headerEnd: headerRe.lastIndex };
      objects.push(entry);
      if (!byNum.has(entry.num)) byNum.set(entry.num, entry); // first definition wins
    }
    return { objects, byNum };
  }

  function resolveLength(dictText, byNum, latin1) {
    const indirect = dictText.match(/\/Length\s+(\d+)\s+\d+\s+R\b/);
    if (indirect) {
      const ref = byNum.get(parseInt(indirect[1], 10));
      if (ref) {
        const after = latin1.slice(ref.headerEnd, ref.headerEnd + 50);
        const numMatch = after.match(/^\s*(\d+)/);
        if (numMatch) return parseInt(numMatch[1], 10);
      }
      return null; // couldn't resolve - caller falls back to scanning for endstream
    }
    const direct = dictText.match(/\/Length\s+(\d+)\b/);
    return direct ? parseInt(direct[1], 10) : null;
  }

  // Locates the object's own stream (if it has one) and returns its raw
  // (still-compressed, if applicable) bytes plus the dictionary text that
  // preceded it. Shared by both the page-tree walk and the brute-force
  // fallback below.
  function findObjectStream(entry, nextStart, latin1, bytes, byNum) {
    const windowEnd = Math.min(nextStart, entry.headerEnd + 4000);
    const window = latin1.slice(entry.headerEnd, windowEnd);
    const streamRel = window.indexOf("stream");
    if (streamRel === -1) return null;

    const dictText = window.slice(0, streamRel);
    const streamKeywordAbs = entry.headerEnd + streamRel;
    let dataStart = streamKeywordAbs + "stream".length;
    if (latin1[dataStart] === "\r") dataStart++;
    if (latin1[dataStart] === "\n") dataStart++;

    let length = resolveLength(dictText, byNum, latin1);
    let dataEnd;
    if (length != null && length >= 0 && dataStart + length <= bytes.length) {
      dataEnd = dataStart + length;
      // Sanity-check: 'endstream' should show up shortly after. If not,
      // the resolved /Length is stale - fall back to scanning instead.
      const tail = latin1.slice(dataEnd, dataEnd + 20);
      if (!/^\s{0,4}endstream/.test(tail)) length = null;
    }
    if (length == null) {
      const esIdx = latin1.indexOf("endstream", dataStart);
      if (esIdx === -1) return null;
      dataEnd = esIdx;
      if (latin1[dataEnd - 1] === "\n") dataEnd--;
      if (latin1[dataEnd - 1] === "\r") dataEnd--;
    }
    if (dataEnd == null || dataEnd <= dataStart) return null;

    return { dictText, rawStreamBytes: bytes.slice(dataStart, dataEnd) };
  }

  async function decodeStream(dictText, rawStreamBytes) {
    let contentBytes = rawStreamBytes;
    if (/FlateDecode/.test(dictText)) {
      try {
        contentBytes = await inflateDeflate(rawStreamBytes);
      } catch (e) {
        return null;
      }
    }
    return new TextDecoder("iso-8859-1").decode(contentBytes);
  }

  async function streamToText(dictText, rawStreamBytes, fontMaps, fontNameToObj) {
    const contentLatin1 = await decodeStream(dictText, rawStreamBytes);
    if (contentLatin1 == null || !/\bBT\b/.test(contentLatin1)) return "";
    return tokensToText(extractShowTokens(contentLatin1, fontMaps, fontNameToObj)).trim();
  }

  // A sentinel unlikely to occur in real PDF text, used to carry link URLs
  // inline through the plain-text pipeline so extractFieldsFromText can
  // pull out "the URL right after this field's text" without a second,
  // position-aware pass.  is a control character no PDF text stream
  // legitimately renders.
  const LINK_MARK = "";

  // Collects the target URL of every clickable Link annotation on a page
  // ("Click here to view the file" style links - GeM buyers attach ATC
  // documents this way). Only /S /URI actions are handled since that's
  // what these documents use; /GoToR (link to an embedded/attached file)
  // would need separate handling this doesn't attempt.
  function getPageLinkUris(pageBody, objects, byNum, idxByNum, latin1) {
    const uris = [];
    const annotsMatch = pageBody.match(/\/Annots\s*\[([^\]]*)\]/) || pageBody.match(/\/Annots\s+(\d+)\s+\d+\s+R/);
    if (!annotsMatch) return uris;

    let annotNums;
    if (annotsMatch[0].includes("[")) {
      annotNums = [...annotsMatch[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => parseInt(m[1], 10));
    } else {
      const arrBody = resolveDictValue(annotsMatch[1] + " 0 R", objects, byNum, idxByNum, latin1);
      annotNums = arrBody ? [...arrBody.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => parseInt(m[1], 10)) : [];
    }

    for (const num of annotNums) {
      const entry = byNum.get(num);
      if (!entry) continue;
      const body = objectBodyText(entry, objects, idxByNum.get(num), latin1, 2000);
      if (!/\/Subtype\s*\/Link\b/.test(body)) continue;
      const uriMatch = body.match(/\/URI\s*\(((?:\\.|[^()\\])*)\)/) || body.match(/\/URI\s*<([0-9A-Fa-f\s]+)>/);
      if (!uriMatch) continue;
      const uri = body.match(/\/URI\s*\(/)
        ? decodeLiteralString(uriMatch[1])
        : uriMatch[1]
            .replace(/\s+/g, "")
            .match(/../g)
            .map((h) => String.fromCharCode(parseInt(h, 16)))
            .join("");
      if (uri) uris.push(uri);
    }
    return uris;
  }

  // Resolves a dictionary value that may be either an indirect reference
  // ("12 0 R") or an inline "<< ... >>" dictionary, returning the inner
  // text to scan either way.
  function resolveDictValue(valueText, objects, byNum, idxByNum, latin1) {
    if (valueText == null) return null;
    const refMatch = valueText.match(/^\s*(\d+)\s+\d+\s+R\s*$/);
    if (refMatch) {
      const num = parseInt(refMatch[1], 10);
      const entry = byNum.get(num);
      if (!entry) return null;
      return objectBodyText(entry, objects, idxByNum.get(num), latin1, 20000);
    }
    return valueText;
  }

  // Builds resource-name (e.g. "F6") -> font object number for a single
  // page, by resolving its /Resources -> /Font dictionary (each of which
  // may itself be inline or an indirect reference).
  function getPageFontNameMap(pageBody, objects, byNum, idxByNum, latin1) {
    const map = new Map();
    const resMatch = pageBody.match(/\/Resources\s+(\d+\s+\d+\s+R)/) || pageBody.match(/\/Resources\s*(<<[\s\S]*)/);
    let resourcesBody = null;
    if (resMatch) {
      if (/R\s*$/.test(resMatch[1])) {
        resourcesBody = resolveDictValue(resMatch[1], objects, byNum, idxByNum, latin1);
      } else {
        // inline - approximate the dict body with a generous slice; exact
        // closing brace matching isn't needed since we only regex-search
        // within it afterwards.
        resourcesBody = resMatch[1].slice(0, 20000);
      }
    }
    if (!resourcesBody) return map;

    const fontMatch = resourcesBody.match(/\/Font\s+(\d+\s+\d+\s+R)/) || resourcesBody.match(/\/Font\s*<<([\s\S]*?)>>/);
    if (!fontMatch) return map;
    const fontDictBody = /R\s*$/.test(fontMatch[1])
      ? resolveDictValue(fontMatch[1], objects, byNum, idxByNum, latin1)
      : fontMatch[1];
    if (!fontDictBody) return map;

    for (const m of fontDictBody.matchAll(/\/(\w+)\s+(\d+)\s+\d+\s+R/g)) {
      map.set(m[1], parseInt(m[2], 10));
    }
    return map;
  }

  // Lazily resolves and caches a font object's /ToUnicode CMap. Returns an
  // empty Map (cached) for fonts with no ToUnicode entry, so callers can
  // rely on a hex-string fallback rather than re-attempting resolution.
  async function getFontUnicodeMap(fontObjNum, cache, objects, byNum, idxByNum, latin1, bytes) {
    if (cache.has(fontObjNum)) return cache.get(fontObjNum);
    const entry = byNum.get(fontObjNum);
    if (!entry) {
      cache.set(fontObjNum, new Map());
      return cache.get(fontObjNum);
    }
    const idx = idxByNum.get(fontObjNum);
    const body = objectBodyText(entry, objects, idx, latin1, 2000);
    const refMatch = body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (!refMatch) {
      cache.set(fontObjNum, new Map());
      return cache.get(fontObjNum);
    }
    const cmapNum = parseInt(refMatch[1], 10);
    const cmapEntry = byNum.get(cmapNum);
    if (!cmapEntry) {
      cache.set(fontObjNum, new Map());
      return cache.get(fontObjNum);
    }
    const cmapIdx = idxByNum.get(cmapNum);
    const nextStart = cmapIdx + 1 < objects.length ? objects[cmapIdx + 1].start : latin1.length;
    const found = findObjectStream(cmapEntry, nextStart, latin1, bytes, byNum);
    if (!found) {
      cache.set(fontObjNum, new Map());
      return cache.get(fontObjNum);
    }
    const cmapText = await decodeStream(found.dictText, found.rawStreamBytes);
    const map = cmapText ? parseToUnicodeCMap(cmapText) : new Map();
    cache.set(fontObjNum, map);
    return map;
  }

  function objectBodyText(entry, objects, idx, latin1, cap) {
    const nextStart = idx + 1 < objects.length ? objects[idx + 1].start : latin1.length;
    const searchLimit = Math.min(nextStart, entry.headerEnd + cap);
    const endobjRel = latin1.indexOf("endobj", entry.headerEnd);
    const end = endobjRel !== -1 && endobjRel < searchLimit ? endobjRel : searchLimit;
    return latin1.slice(entry.headerEnd, end);
  }

  // Real page content is only ever found via Catalog -> Pages -> Kids ->
  // Page -> /Contents. Everything else with a FlateDecode stream in a
  // typical government-form PDF (embedded fonts, ICC profiles, page
  // background images, XObjects) is NOT text, and naive "does this
  // decompressed stream happen to contain the bytes B and T" checks give
  // false positives on that binary data often enough to be useless on
  // image-heavy documents. Walking the real page tree avoids that
  // entirely, and also returns pages in the correct reading order.
  function findContentStreamNums(latin1, objects, byNum) {
    const idxByNum = new Map(objects.map((o, i) => [o.num, i]));

    function bodyOf(num) {
      const entry = byNum.get(num);
      if (!entry) return null;
      return objectBodyText(entry, objects, idxByNum.get(num), latin1, 20000);
    }

    let catalogNum = null;
    for (const entry of objects) {
      const idx = idxByNum.get(entry.num);
      const body = objectBodyText(entry, objects, idx, latin1, 500);
      if (/\/Type\s*\/Catalog\b/.test(body)) {
        catalogNum = entry.num;
        break;
      }
    }
    if (catalogNum == null) return null;
    const catalogBody = bodyOf(catalogNum);
    const pagesRefMatch = catalogBody && catalogBody.match(/\/Pages\s+(\d+)\s+\d+\s+R/);
    if (!pagesRefMatch) return null;

    const pages = []; // [{ pageNum, contentNums: [...] }]
    const visited = new Set();
    function walk(num) {
      if (visited.has(num)) return; // guard against a malformed/cyclic tree
      visited.add(num);
      const body = bodyOf(num);
      if (body == null) return;
      if (/\/Type\s*\/Pages\b/.test(body)) {
        const kidsMatch = body.match(/\/Kids\s*\[([^\]]*)\]/);
        if (!kidsMatch) return;
        const kidNums = [...kidsMatch[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => parseInt(m[1], 10));
        for (const kid of kidNums) walk(kid);
      } else {
        // Treat as a Page node (works even if /Type /Page is missing).
        const contentNums = [];
        const arrMatch = body.match(/\/Contents\s*\[([^\]]*)\]/);
        if (arrMatch) {
          for (const m of arrMatch[1].matchAll(/(\d+)\s+\d+\s+R/g)) contentNums.push(parseInt(m[1], 10));
        } else {
          const refMatch = body.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
          if (refMatch) contentNums.push(parseInt(refMatch[1], 10));
        }
        if (contentNums.length) pages.push({ pageNum: num, pageBody: body, contentNums });
      }
    }
    walk(parseInt(pagesRefMatch[1], 10));
    return pages.length ? pages : null;
  }

  async function extractPdfText(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const latin1 = new TextDecoder("iso-8859-1").decode(bytes);
    const { objects, byNum } = indexObjects(latin1);
    const idxByNum = new Map(objects.map((o, i) => [o.num, i]));
    const parts = [];
    const fontUnicodeCache = new Map(); // fontObjNum -> Map<code,str>, shared across pages (fonts are usually reused)

    const pages = findContentStreamNums(latin1, objects, byNum);

    if (pages) {
      for (const page of pages) {
        const fontNameToObj = getPageFontNameMap(page.pageBody, objects, byNum, idxByNum, latin1);
        const resolvedFontMaps = new Map();
        for (const fontObjNum of new Set(fontNameToObj.values())) {
          resolvedFontMaps.set(fontObjNum, await getFontUnicodeMap(fontObjNum, fontUnicodeCache, objects, byNum, idxByNum, latin1, bytes));
        }
        let pageText = "";
        for (const num of page.contentNums) {
          const entry = byNum.get(num);
          if (!entry) continue;
          const idx = idxByNum.get(num);
          const nextStart = idx + 1 < objects.length ? objects[idx + 1].start : latin1.length;
          const found = findObjectStream(entry, nextStart, latin1, bytes, byNum);
          if (!found) continue;
          const text = await streamToText(found.dictText, found.rawStreamBytes, resolvedFontMaps, fontNameToObj);
          if (text) pageText += (pageText ? "\n\n" : "") + text;
        }
        // Append this page's clickable-link targets right after its text
        // (see LINK_MARK above) so field extraction can associate "Click
        // here to view the file" style links with whichever field's value
        // span they land in.
        for (const uri of getPageLinkUris(page.pageBody, objects, byNum, idxByNum, latin1)) {
          pageText += `${LINK_MARK}LINK:${uri}${LINK_MARK}`;
        }
        if (pageText) parts.push(pageText);
      }
      if (parts.length) return normalizeLigatures(parts.join("\n\n"));
      // fall through to brute-force if the page tree resolved but somehow
      // yielded no usable text
    }

    // Fallback: page tree couldn't be resolved (unusual/older PDF layout).
    // Scan every FlateDecode stream and keep the ones that look like real
    // text content. Slower and more error-prone (see note above) but
    // better than returning nothing. Font/CMap resolution is skipped here
    // (no reliable page context to resolve Resources from), so hex-string
    // text falls back to the raw 1-byte-per-char decode.
    const emptyFontMaps = new Map();
    const emptyFontNames = new Map();
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      const nextStart = i + 1 < objects.length ? objects[i + 1].start : latin1.length;
      const found = findObjectStream(obj, nextStart, latin1, bytes, byNum);
      if (!found) continue;
      if (/\/Filter/.test(found.dictText) && !/FlateDecode/.test(found.dictText)) continue;
      const text = await streamToText(found.dictText, found.rawStreamBytes, emptyFontMaps, emptyFontNames);
      if (text) parts.push(text);
    }
    return normalizeLigatures(parts.join("\n\n"));
  }

  // Some fonts these bid PDFs embed render common letter pairs ("fi", "fl",
  // etc.) as a single typographic ligature glyph, decoded via ToUnicode as
  // one dedicated Unicode codepoint (U+FB00-FB06) rather than as separate
  // "f" + "i" characters. Left alone, that silently breaks plain-string
  // label matching for any label containing those letters - e.g.
  // "Qualification" comes through as "Qualiﬁcation" (with a single "ﬁ"
  // glyph), so a literal search for "RA Qualification Rule" never matches
  // and the field comes back empty even though the text is right there.
  // Expanding these back to their plain-letter form fixes matching for
  // every label, not just this one.
  const LIGATURE_MAP = {
    "\uFB00": "ff",
    "\uFB01": "fi",
    "\uFB02": "fl",
    "\uFB03": "ffi",
    "\uFB04": "ffl",
    "\uFB05": "st",
    "\uFB06": "st",
  };
  function normalizeLigatures(text) {
    return text.replace(/[\uFB00-\uFB06]/g, (ch) => LIGATURE_MAP[ch] || ch);
  }


  // rather than requiring an exact literal substring. Real PDFs wrap long
  // bilingual labels onto multiple lines wherever the layout needs to
  // (e.g. "Document required" / "from seller" on separate lines), so a
  // plain indexOf on a label written with normal single spaces would miss
  // it entirely as soon as the PDF happens to wrap in the middle of it.
  function labelToRegex(label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped.replace(/\s+/g, "\\s+"));
  }

  // These bid PDFs lay every field out as "<Hindi label> /<English label>"
  // followed by its answer, one row after another (a two-column table
  // flattened into linear text). Once we've matched a field's own label,
  // the very next occurrence of *this same pattern* - Devanagari text
  // followed by a "/" and a Latin letter - marks the start of the NEXT
  // row's label, whether or not that next label happens to be one we're
  // searching for. Cutting the value there (instead of only at the next
  // *tracked* label, or an arbitrary character count) is what keeps a
  // short field like "EMD Amount" from swallowing every unrelated row
  // that follows it in the PDF until the next field we happen to be
  // looking for shows up.
  const ROW_BOUNDARY_RE = /[ऀ-ॿ][^\n]{0,120}\/\s*[A-Za-z]/;

  // Removes Devanagari-script characters (these PDFs pair every field
  // label, and often surrounding boilerplate, with a Hindi translation).
  // English text, numbers, dates and punctuation are untouched. Also
  // tidies up the "/" separator these documents put between the Hindi and
  // English halves of a label, which would otherwise be left dangling at
  // the front of the value once the Hindi side is gone.
  function stripDevanagari(value) {
    let out = value.replace(/[\u0900-\u097F\uA8E0-\uA8FF]+/g, "");
    out = out.replace(/^[\s\/]+/, "");
    out = out.replace(/[ \t]{2,}/g, " ");
    out = out.replace(/\n[ \t]*\/[ \t]*/g, "\n");
    out = out.replace(/\n{2,}/g, "\n");
    return out.trim();
  }

  // The "Consignees/Reporting Officer and Quantity" table (columns: S.No,
  // Consignee/Reporting Officer, Address, Quantity, Delivery Days) doesn't
  // carry per-column (x/y) positions in this extractor's flat text model
  // (see the module doc comment above), so columns can't be reconstructed
  // generically. Address specifically CAN be pulled out reliably though:
  // every consignee address in these bid PDFs starts with the 6-digit
  // delivery PIN code followed by a comma (e.g. "392001,Children home for
  // Girls, ..."), which is a much sturdier anchor than trying to match the
  // bilingual "Consignee/Reporting Officer" column heading itself - that
  // heading's own "/" sometimes lands between "Consignee" and "Reporting"
  // and sometimes between "Reporting" and "Officer" depending on how a
  // given PDF happens to wrap it, so matching it literally used to miss
  // entirely on some bids and leave Address blank every time.
  const ADDRESS_HEADER_RE = /Address\s*\/?\s*[\s\S]{0,20}?Quantity[\s\S]{0,60}?Delivery/i;
  const PIN_ADDRESS_RE = /\b\d{6}\s*,/;
  // Marks the end of the address: the next standalone "<quantity>
  // <delivery days>" number pair on its own line, which is the next
  // column over in the same table row.
  const QTY_ROW_END_RE = /\n[ \t]*\d+[ \t]+\d+[ \t]*(?:\n|$)/;

  function extractAddressField(text) {
    const headerMatch = ADDRESS_HEADER_RE.exec(text);
    if (!headerMatch) return "";
    const searchStart = headerMatch.index + headerMatch[0].length;
    const rest = text.slice(searchStart, searchStart + 4000);
    const linkRe = new RegExp(`${LINK_MARK}LINK:([^${LINK_MARK}]*)${LINK_MARK}`, "g");
    const cleanedRest = rest.replace(linkRe, "");
    const pinMatch = PIN_ADDRESS_RE.exec(cleanedRest);
    if (!pinMatch) return "";
    const addressStart = cleanedRest.slice(pinMatch.index);
    const endMatch = QTY_ROW_END_RE.exec(addressStart);
    let address = endMatch ? addressStart.slice(0, endMatch.index) : addressStart.slice(0, 300);
    address = stripPageFooters(address);
    address = stripDevanagari(address);
    // Addresses legitimately wrap across lines in the source PDF - collapse
    // those into a single readable line for the Excel cell rather than
    // leaving raw line breaks in the value.
    address = address.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
    if (address.length > 300) address = address.slice(0, 300) + "\u2026";
    return address;
  }

  // Every page of these GeM-generated bid PDFs ends with a "<page> /
  // <total pages>" footer line (e.g. "2 / 8") sitting on its own line.
  // When a field's value happens to span a page break, that footer line
  // ends up embedded in the middle of the extracted value as if it were
  // part of the answer. A real field value in these documents is never
  // itself formatted as "<number> / <number>" on its own line, so it's
  // safe to strip any line matching that shape out of a value.
  function stripPageFooters(value) {
    return value
      .replace(/(^|\n)[ \t]*\d{1,4}[ \t]*\/[ \t]*\d{1,4}[ \t]*(?=\n|$)/g, "$1")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }


  // Some labels (notably "Buyer Added Bid Specific ATC") legitimately
  // appear more than once in a bid PDF - once as a heading over the
  // buyer's own typed-out ATC clause text, and again as a heading over
  // "Buyer uploaded ATC document / Click here to view the file", which is
  // the actual answer (and the only occurrence a real PDF link annotation
  // is ever attached to). Matching only the first occurrence, as a plain
  // .exec() does, silently locks onto the wrong one and the link is never
  // seen. This collects every occurrence of a label and, when there's more
  // than one, prefers whichever is immediately followed by that uploaded-
  // document answer text; otherwise it keeps the old first-match behavior
  // so every other (single-occurrence) label is unaffected.
  function findLabelMatches(text, label) {
    const re = new RegExp(labelToRegex(label).source, "g");
    const matches = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length });
      if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width matches
    }
    return matches;
  }

  const UPLOADED_DOC_ANSWER_RE = /Buyer uploaded ATC document|Click here to view the file/i;

  function extractFieldsFromText(text, labels) {
    const found = [];
    for (const label of labels) {
      const matches = findLabelMatches(text, label);
      if (!matches.length) continue;
      let chosen = matches[0];
      if (matches.length > 1) {
        const withAnswer = matches.find((mm) => UPLOADED_DOC_ANSWER_RE.test(text.slice(mm.end, mm.end + 200)));
        if (withAnswer) chosen = withAnswer;
      }
      found.push({ label, start: chosen.start, end: chosen.end });
    }
    found.sort((a, b) => a.start - b.start);
    const result = {};
    const linkRe = new RegExp(`${LINK_MARK}LINK:([^${LINK_MARK}]*)${LINK_MARK}`, "g");
    for (let i = 0; i < found.length; i++) {
      const cur = found[i];
      const nextStart = i + 1 < found.length ? found[i + 1].start : Math.min(text.length, cur.end + 400);
      let value = text.slice(cur.end, nextStart);

      let links = [...value.matchAll(linkRe)].map((m) => m[1]);
      // Link markers are appended once at the very end of whichever page
      // they came from (see the getPageLinkUris call in extractPdfText),
      // not inline at the annotation's on-page position. For a field whose
      // answer is immediately followed by a lot of same-page boilerplate
      // text (e.g. "Buyer uploaded ATC document Click here to view the
      // file." followed by a multi-paragraph disclaimer), that marker can
      // land well past the normal ~400-char value window above and get
      // missed entirely. When the value clearly IS that kind of answer but
      // no link turned up yet, widen the search specifically for the link
      // marker (not for the display text, which stays trimmed as below).
      if (!links.length && UPLOADED_DOC_ANSWER_RE.test(value)) {
        const widenedEnd = Math.min(text.length, cur.end + 6000);
        const widenedLinks = [...text.slice(cur.end, widenedEnd).matchAll(linkRe)].map((m) => m[1]);
        if (widenedLinks.length) links = widenedLinks;
      }
      if (links.length) result[cur.label + "__links"] = links;
      value = value.replace(linkRe, "");

      // Stop at the next table row (see ROW_BOUNDARY_RE above) before
      // stripping Devanagari, since that's what makes the next row
      // recognizable as a row in the first place.
      const rowBoundary = ROW_BOUNDARY_RE.exec(value);
      if (rowBoundary) value = value.slice(0, rowBoundary.index);

      value = stripDevanagari(value);
      value = stripPageFooters(value);
      value = value.replace(/^[\s:\-\/]+/, "").trim();
      value = value.replace(/\s{2,}/g, " ");

      // Fields like "Buyer Added Bid Specific ATC" show a short answer
      // ("...Click here to view the file.") immediately followed by a long
      // boilerplate legal disclaimer paragraph that isn't part of the
      // actual answer. Cut the value right after that sentence so the
      // disclaimer doesn't leak into the export. (When a real clickable
      // link was found near this field - see the __links entry above and
      // how content.js uses it - that link is what actually ends up in the
      // Excel cell for this field; this trim only matters as the visible
      // fallback text when no such link exists in the PDF.)
      const clickHereMatch = value.match(/Click here to view the file\s*\.?/i);
      if (clickHereMatch) {
        value = value.slice(0, clickHereMatch.index + clickHereMatch[0].length).trim();
      }

      if (value.length > 300) value = value.slice(0, 300) + "\u2026";
      result[cur.label] = value;
    }
    for (const label of labels) {
      if (!(label in result)) result[label] = "";
    }
    // "Address" here means the Consignee/Reporting Officer/Quantity table
    // (see extractConsigneeTableBlock above), not a standalone "Address:"
    // field - GeM's bid PDFs don't reliably have the latter as its own
    // labeled row, and the table is the actual source of address info in
    // these documents.
    if (labels.includes("Address")) {
      const address = extractAddressField(text);
      if (address) result["Address"] = address;
    }
    return result;
  }

  async function extractBidPdfFields(arrayBuffer, labels) {
    const text = await extractPdfText(arrayBuffer);
    return { text, fields: extractFieldsFromText(text, labels) };
  }

  global.extractPdfText = extractPdfText;
  global.extractFieldsFromText = extractFieldsFromText;
  global.extractBidPdfFields = extractBidPdfFields;
})(typeof window !== "undefined" ? window : globalThis);
