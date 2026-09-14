// Everything in this file is DOM mechanics only — no time math, no "is this
// today" logic. That lives in index.js, which passes in a computeCellText
// callback. Keeping the split means the AntD-specific plumbing here can be
// unit-tested against a fixture DOM later without dragging in date logic,
// and vice versa.

import { HEADER_TEXT, MARKER_ATTR } from "../lib/config.js";

function normText(el) {
  if (!el) return "";
  // The sortable "Date" header wraps its text in a nested
  // span.ant-table-column-title (next to the sort-arrow icons); other
  // headers don't have one, so fall back to the cell itself.
  const titleEl = el.querySelector(".ant-table-column-title");
  const source = titleEl || el;
  return source.textContent.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Find the AntD table wrapper that renders the attendance table, identified
 * by header TEXT rather than a class hash. `css-1m77us0`-style emotion
 * classes change on every AntD/build bump; header text is what a human
 * reading the page relies on, so it's the more durable anchor.
 * @returns {Element|null}
 */
export function findTable() {
  const wrappers = document.querySelectorAll(".ant-table-wrapper");
  for (const wrapper of wrappers) {
    const texts = getHeaderTexts(wrapper);
    if (texts.includes(HEADER_TEXT.startTime) && texts.includes(HEADER_TEXT.date)) {
      return wrapper;
    }
  }
  return null;
}

/** @param {Element} wrapper @returns {string[]} */
export function getHeaderTexts(wrapper) {
  const headerRow = wrapper.querySelector("thead tr:first-child");
  if (!headerRow) return [];
  return [...headerRow.children].map((th) => normText(th));
}

/**
 * @param {string[]} headerTexts
 * @returns {{srcIdx:number, endIdx:number, insertAt:number}|null}
 */
export function computeIndices(headerTexts) {
  const srcIdx = headerTexts.indexOf(HEADER_TEXT.startTime);
  const endIdx = headerTexts.indexOf(HEADER_TEXT.endTime);
  if (srcIdx === -1 || endIdx === -1) return null;
  return { srcIdx, endIdx, insertAt: endIdx + 1 };
}

export function removeInjected() {
  document.querySelectorAll(`[${MARKER_ATTR}]`).forEach((node) => node.remove());
}

/**
 * Insert a "Secure End Time" column. Handles:
 *  - BOTH colgroups (header table + body table — they are NOT symmetric:
 *    the header's carries AntD's resolved pixel widths, the body's carries
 *    the originally declared ones — both need a <col> or the column widths
 *    shear apart under table-layout:fixed).
 *  - the sticky header's single <thead> row.
 *  - the layout-only `tr.ant-table-measure-row` — patching this is what
 *    keeps AntD from discarding our column when it next re-measures.
 *  - every real data row (`tr[data-row-key]`, i.e. not the measure row).
 *
 * @param {Element} wrapper
 * @param {number} insertAt
 * @param {(row: Element) => string} computeCellText
 */
export function injectColumn(wrapper, insertAt, computeCellText) {
  wrapper.querySelectorAll("colgroup").forEach((colgroup) => {
    const col = document.createElement("col");
    col.style.width = "160px";
    col.setAttribute(MARKER_ATTR, "1");
    colgroup.insertBefore(col, colgroup.children[insertAt] || null);
  });

  const headerRow = wrapper.querySelector("thead tr:first-child");
  if (headerRow) {
    const th = document.createElement("th");
    // Inherit AntD's own cell padding/border/font — without this class the
    // injected header looks visibly out of place on first render.
    th.className = "ant-table-cell";
    th.setAttribute(MARKER_ATTR, "1");
    th.textContent = "Secure End Time";
    headerRow.insertBefore(th, headerRow.children[insertAt] || null);
  }

  const measureRow = wrapper.querySelector("tr.ant-table-measure-row");
  if (measureRow) {
    const td = document.createElement("td");
    td.className = "ant-table-measure-cell";
    td.setAttribute(MARKER_ATTR, "1");
    measureRow.insertBefore(td, measureRow.children[insertAt] || null);
  }

  const rows = wrapper.querySelectorAll(
    ".ant-table-tbody > tr[data-row-key]:not(.ant-table-measure-row)"
  );
  rows.forEach((row) => {
    const td = document.createElement("td");
    td.className = "ant-table-cell cto-cell";
    td.setAttribute(MARKER_ATTR, "1");
    td.textContent = computeCellText(row);
    row.insertBefore(td, row.children[insertAt] || null);
  });
}
