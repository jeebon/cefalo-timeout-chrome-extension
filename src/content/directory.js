// DOM mechanics only for the members-directory tracker bar — no storage, no
// diffing, no policy. Mirrors table.js/panel.js's split: members.js decides
// WHAT to show and WHEN; this file only knows HOW to find the mount, scrape
// a card, and paint a view-state into the bar it built.

import { DIR_ATTR, DIR_READY_ATTR, DIR_BADGE_ATTR } from "../lib/config.js";

const AVATAR_SELECTOR = 'img[src*="/api/avatars/"]';
const PROFILE_LINK_SELECTOR = 'a[href^="/profile/view/?id="]';

/**
 * Every non-header avatar image on the page — the one count this whole
 * module anchors on instead of any Tailwind class, which the grid's own
 * class (`grid w-full grid-cols-2 gap-2 sm:grid-cols-[...]`) is exactly the
 * kind of string that gets rewritten on a layout tweak.
 */
function nonHeaderAvatarImgs() {
  return [...document.querySelectorAll(AVATAR_SELECTOR)].filter((img) => !img.closest("header"));
}

/**
 * The smallest ancestor of one avatar img that also contains that person's
 * profile link and no OTHER avatar — i.e. exactly one member's card,
 * regardless of how many wrapper divs the portal nests it in. Returns null
 * if no such ancestor exists within a reasonable climb (malformed markup).
 * @param {Element} img
 */
function cardFor(img) {
  let node = img;
  for (let i = 0; i < 8 && node; i++) {
    if (node.querySelector(PROFILE_LINK_SELECTOR) && node.querySelectorAll(AVATAR_SELECTOR).length === 1) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** @returns {Element[]} one element per member card currently rendered */
export function findMemberCards() {
  const seen = new Set();
  const cards = [];
  for (const img of nonHeaderAvatarImgs()) {
    const card = cardFor(img);
    if (card && !seen.has(card)) {
      seen.add(card);
      cards.push(card);
    }
  }
  return cards;
}

/**
 * Scrape one card by what it semantically contains, never by paragraph
 * index — one member renders 3 `<p>` instead of 4 (empty teams), and
 * positionally "teams missing" and "designation missing" are
 * indistinguishable, which would file a designation into the teams field.
 * Returns null (an explicit bail, matching computeIndices()'s -1 pattern)
 * if the card doesn't have what identity requires.
 * @param {Element} card
 * @returns {{userId:number, name:string, username:string, designation:string, teams:string[], photo:string}|null}
 */
export function scrapeCard(card) {
  const link = card.querySelector(PROFILE_LINK_SELECTOR);
  if (!link) return null;

  let userId;
  try {
    const b64 = new URL(link.getAttribute("href"), location.origin).searchParams.get("id") || "";
    userId = Number(atob(b64.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null; // malformed href — skip this one card, not the whole scrape
  }
  if (!Number.isFinite(userId)) return null;

  const nameEl = link.querySelector("p");
  const name = nameEl ? nameEl.textContent.trim() : "";
  if (!name) return null;

  const paragraphs = [...card.querySelectorAll("p")].filter((p) => !link.contains(p));
  const usernameIdx = paragraphs.findIndex((p) => p.textContent.trim().startsWith("@"));
  const username = usernameIdx >= 0 ? paragraphs[usernameIdx].textContent.trim() : "";
  const rest = usernameIdx >= 0 ? paragraphs.slice(usernameIdx + 1) : paragraphs;
  const designation = rest[0] ? rest[0].textContent.trim() : "";
  const teams = rest[1] ? rest[1].textContent.trim().split(",").map((t) => t.trim()).filter(Boolean) : [];

  const img = card.querySelector(AVATAR_SELECTOR);
  const photo = img ? img.src : "";

  return { userId, name, username, designation, teams, photo };
}

/**
 * The filter region is always present regardless of result count — anchoring
 * on "the parent of N member cards" instead breaks exactly when the bar is
 * needed most: filtering to 0 or a handful of matches removes that anchor,
 * so a bar meant to say "Clear filters to snap" disappears along with it.
 *
 * Locates the visible "Search Name" input, climbs to the smallest ancestor
 * that also contains the member grid, and returns that ancestor plus the
 * specific child to insert the bar before. Bails on `<body>`/`<html>` (the
 * page header holds the user's own profile link, which would otherwise let
 * the grid-side climb escape the content area entirely).
 * @returns {{container: Element, reference: Element}|null}
 */
export function findDirectoryMount() {
  const avatarImgs = nonHeaderAvatarImgs();
  if (!avatarImgs.length) return null;

  // Climb from one avatar until the ancestor's own avatar count covers every
  // non-header avatar on the page — the smallest container holding the
  // whole grid, whatever its actual class names are.
  let gridNode = avatarImgs[0];
  for (let i = 0; i < 12 && gridNode; i++) {
    if (gridNode.querySelectorAll(AVATAR_SELECTOR).length === avatarImgs.length) break;
    gridNode = gridNode.parentElement;
  }
  if (!gridNode) return null;

  const searchInput = [...document.querySelectorAll('input[placeholder="Search Name"]')].find(
    (el) => el.offsetParent !== null
  );
  if (!searchInput) return null;

  // Walk up from the grid until we find the ancestor that also contains the
  // search input — that's the shared container both regions live in.
  let root = gridNode;
  while (root && !root.contains(searchInput)) root = root.parentElement;
  if (!root || root === document.body || root === document.documentElement) return null;

  // The specific child of `root` that is (or contains) the grid — insert
  // the bar as ITS previous sibling, not as a sibling of the grid itself,
  // so the bar sits above any filter chrome the portal renders alongside it.
  // This climb assumes gridNode is a PROPER descendant of root, which is
  // normally true (root is found by climbing FROM gridNode) — except when
  // a narrow result set (measured live: selecting a Skills filter) collapses
  // the grid container and the filter-region container into the SAME node,
  // i.e. root === gridNode. In that case there's no distinct child to insert
  // before, and the naive climb runs past <html> and reads .parentElement of
  // null. Bail to null (findDirectoryMount's normal "no safe mount" signal,
  // already handled by syncMembers() as teardown) instead of throwing.
  let reference = gridNode;
  while (reference && reference.parentElement && reference.parentElement !== root) {
    reference = reference.parentElement;
  }
  if (!reference || reference.parentElement !== root) return null;

  return { container: root, reference };
}

// --- Bar construction ------------------------------------------------------

/**
 * Build the bar DOM once, fully detached — same discipline as panel.js's
 * createPanel(): the caller inserts it only after this returns, and stamps
 * DIR_READY_ATTR only as the last step, so a throw partway through never
 * leaves a half-built bar that ensure-present would mistake for working.
 * @returns {{node: Element, refs: object}}
 */
export function createDirectoryBar() {
  const node = document.createElement("div");
  node.setAttribute(DIR_ATTR, "1");
  node.className = "cto-dir";

  // The whole bar is collapsible, collapsed by default (see members.js) — a
  // click anywhere on the head toggles it. The head itself always stays
  // visible so there's always something to click back open; everything
  // else lives in `body`, one single element to hide/show.
  const head = document.createElement("button");
  head.type = "button";
  head.className = "cto-dir-head";
  const title = document.createElement("span");
  title.className = "cto-dir-head-title";
  title.textContent = "Member tracking";
  const headSummary = document.createElement("span");
  headSummary.className = "cto-dir-head-summary";
  const chevron = document.createElement("span");
  chevron.className = "cto-dir-chevron";
  chevron.textContent = "▾";
  chevron.setAttribute("aria-hidden", "true");
  head.append(title, headSummary, chevron);

  const body = document.createElement("div");
  body.className = "cto-dir-body";

  // Not-tracking view
  const trackRow = document.createElement("div");
  trackRow.className = "cto-dir-track-row";
  const trackBtn = document.createElement("button");
  trackBtn.type = "button";
  trackBtn.className = "cto-dir-btn cto-dir-btn-primary";
  trackBtn.textContent = "Track";
  const trackHint = document.createElement("p");
  trackHint.className = "cto-dir-hint";
  trackHint.textContent = "Records the current list so you can see who joins or leaves later.";
  trackRow.append(trackBtn, trackHint);

  // Tracking view — Former members strip
  const formerSection = document.createElement("div");
  formerSection.className = "cto-dir-former";
  const formerHeader = document.createElement("button");
  formerHeader.type = "button";
  formerHeader.className = "cto-dir-former-header";
  const formerHeaderText = document.createTextNode("Former members (0)");
  formerHeader.appendChild(formerHeaderText);
  const formerThumbs = document.createElement("div");
  formerThumbs.className = "cto-dir-former-thumbs";
  const formerList = document.createElement("div");
  formerList.className = "cto-dir-former-list";
  formerList.hidden = true;
  formerSection.append(formerHeader, formerThumbs, formerList);

  // Tracking view — action row
  const actionRow = document.createElement("div");
  actionRow.className = "cto-dir-action-row";
  const snapBtn = document.createElement("button");
  snapBtn.type = "button";
  snapBtn.className = "cto-dir-btn cto-dir-btn-primary";
  const untrackBtn = document.createElement("button");
  untrackBtn.type = "button";
  untrackBtn.className = "cto-dir-btn cto-dir-btn-danger";
  untrackBtn.textContent = "Untrack";
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "cto-dir-btn";
  exportBtn.textContent = "Export";
  actionRow.append(snapBtn, untrackBtn, exportBtn);

  // Untrack confirm (two-step, never window.confirm — that blocks the SPA)
  const untrackConfirm = document.createElement("div");
  untrackConfirm.className = "cto-dir-confirm";
  untrackConfirm.hidden = true;
  const untrackConfirmText = document.createElement("span");
  untrackConfirmText.textContent = "Delete all tracking history? This cannot be undone.";
  const untrackConfirmYes = document.createElement("button");
  untrackConfirmYes.type = "button";
  untrackConfirmYes.className = "cto-dir-btn cto-dir-btn-danger";
  untrackConfirmYes.textContent = "Delete";
  const untrackConfirmNo = document.createElement("button");
  untrackConfirmNo.type = "button";
  untrackConfirmNo.className = "cto-dir-btn";
  untrackConfirmNo.textContent = "Cancel";
  untrackConfirm.append(untrackConfirmText, untrackConfirmYes, untrackConfirmNo);

  // Snap delta confirm — states exactly what it's about to record (who
  // joined, who left) instead of saving silently. Shown for EVERY snap that
  // would actually change something; a snap with no change is refused
  // outright before this ever renders (see members.js#doSnap).
  const snapConfirm = document.createElement("div");
  snapConfirm.className = "cto-dir-confirm";
  snapConfirm.hidden = true;
  const snapConfirmText = document.createElement("span");
  const snapConfirmYes = document.createElement("button");
  snapConfirmYes.type = "button";
  snapConfirmYes.className = "cto-dir-btn cto-dir-btn-primary";
  snapConfirmYes.textContent = "Save snapshot";
  const snapConfirmNo = document.createElement("button");
  snapConfirmNo.type = "button";
  snapConfirmNo.className = "cto-dir-btn";
  snapConfirmNo.textContent = "Cancel";
  snapConfirm.append(snapConfirmText, snapConfirmYes, snapConfirmNo);

  // Delete-one-snapshot confirm. Never offered for the baseline (index 0,
  // see the "✕" omission in timelineRow below) — that one is only removable
  // via Untrack, which deletes the whole history at once.
  const deleteConfirm = document.createElement("div");
  deleteConfirm.className = "cto-dir-confirm";
  deleteConfirm.hidden = true;
  const deleteConfirmText = document.createElement("span");
  const deleteConfirmYes = document.createElement("button");
  deleteConfirmYes.type = "button";
  deleteConfirmYes.className = "cto-dir-btn cto-dir-btn-danger";
  deleteConfirmYes.textContent = "Delete";
  const deleteConfirmNo = document.createElement("button");
  deleteConfirmNo.type = "button";
  deleteConfirmNo.className = "cto-dir-btn";
  deleteConfirmNo.textContent = "Cancel";
  deleteConfirm.append(deleteConfirmText, deleteConfirmYes, deleteConfirmNo);

  const errorText = document.createElement("p");
  errorText.className = "cto-dir-error";
  errorText.hidden = true;

  // Shown INSTEAD of everything else whenever the URL carries a filter — a
  // filtered grid is a subset of the roster, and there is no reliable way
  // to tell "filtered out" apart from "left", so the whole feature steps
  // aside rather than risk recording a partial list as history.
  const filteredMessage = document.createElement("p");
  filteredMessage.className = "cto-dir-hint";
  filteredMessage.textContent = "Clear filters to use tracking — a filtered list isn't the full roster.";
  filteredMessage.hidden = true;

  const timeline = document.createElement("div");
  timeline.className = "cto-dir-timeline";

  body.append(filteredMessage, trackRow, formerSection, actionRow, untrackConfirm, snapConfirm, deleteConfirm, errorText, timeline);
  node.append(head, body);

  return {
    node,
    refs: {
      root: node,
      head,
      headSummary,
      body,
      filteredMessage,
      trackRow,
      trackBtn,
      formerSection,
      formerHeader,
      formerHeaderText,
      formerThumbs,
      formerList,
      actionRow,
      snapBtn,
      untrackBtn,
      exportBtn,
      untrackConfirm,
      untrackConfirmYes,
      untrackConfirmNo,
      snapConfirm,
      snapConfirmText,
      snapConfirmYes,
      snapConfirmNo,
      deleteConfirm,
      deleteConfirmText,
      deleteConfirmYes,
      deleteConfirmNo,
      errorText,
      timeline,
    },
  };
}

function thumb(person) {
  const img = document.createElement("img");
  img.className = "cto-dir-thumb";
  img.src = person.photo;
  img.alt = person.name;
  img.loading = "lazy";
  // Broken-image fallback: initials on a plain circle. The portal is not
  // guaranteed to keep serving a departed person's avatar (unverified —
  // see the plan's open measurements), so this is the expected path for
  // former members, not an edge case.
  img.addEventListener(
    "error",
    () => {
      img.replaceWith(initialsCircle(person.name));
    },
    { once: true }
  );
  return img;
}

function initialsCircle(name) {
  const el = document.createElement("div");
  el.className = "cto-dir-thumb cto-dir-thumb-fallback";
  el.textContent = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return el;
}

function formerRow(person, leftAtText) {
  const row = document.createElement("div");
  row.className = "cto-dir-former-row";
  row.append(thumb(person));
  const info = document.createElement("div");
  info.className = "cto-dir-former-info";
  const nameEl = document.createElement("div");
  nameEl.className = "cto-dir-former-name";
  nameEl.textContent = person.name;
  const metaEl = document.createElement("div");
  metaEl.className = "cto-dir-former-meta";
  metaEl.textContent = [person.designation, person.teams.join(", ")].filter(Boolean).join(" · ");
  const leftEl = document.createElement("div");
  leftEl.className = "cto-dir-former-left";
  leftEl.textContent = leftAtText;
  info.append(nameEl, metaEl, leftEl);
  row.append(info);
  return row;
}

/**
 * @param {object} snap
 * @param {(iso:string)=>string} formatLocal
 * @param {number} index this snap's position in store.snaps — needed by the
 *   delete button (deleteSnap() operates on that index), NOT the position in
 *   the reversed, newest-first list this row is rendered into.
 */
function timelineRow(snap, formatLocal, index) {
  const row = document.createElement("div");
  row.className = "cto-dir-timeline-row";
  const when = document.createElement("span");
  when.className = "cto-dir-timeline-when";
  when.textContent = formatLocal(snap.at);
  const summary = document.createElement("span");
  summary.className = "cto-dir-timeline-summary";
  if (snap.kind === "baseline") {
    summary.textContent = `Started tracking · ${snap.total} people`;
  } else if (snap.added.length === 0 && snap.removed.length === 0) {
    summary.textContent = "no change";
  } else {
    summary.textContent = `+${snap.added.length} −${snap.removed.length}`;
  }
  row.append(when, summary);
  // The baseline (index 0) has no delete button — it's only removable via
  // Untrack, which clears the whole history at once (see roster.js#deleteSnap).
  if (index > 0) {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "cto-dir-timeline-del";
    del.title = "Delete this snapshot";
    del.textContent = "✕";
    del.dataset.ctoDirDelIndex = String(index);
    row.append(del);
  }
  return row;
}

/**
 * Paint a fully-derived view state into an existing bar's refs. Every branch
 * here is infrequent (a user click or a storage change), never a per-second
 * repaint, so plain textContent/hidden writes are fine — the Text.data
 * discipline in attendance.js exists for a 1Hz clock, not for this. The
 * caller is still responsible for wrapping this in withApplying(), same as
 * every other write this extension makes to its own injected subtree.
 * @param {object} refs
 * @param {object} state
 * @param {(iso:string)=>string} formatLocal
 */
export function renderDirectoryBar(refs, state, formatLocal) {
  refs.root.dataset.ctoDirState = state.kind;

  // The bar is collapsible independent of everything else below — the head
  // (title + summary + chevron) always stays visible; `body` is the single
  // element that hides the rest, in every kind including "filtered" and
  // "loading". Defaults to collapsed (see members.js), so most page loads
  // never build the rest of this DOM into view at all.
  refs.root.dataset.ctoDirCollapsed = state.collapsed ? "1" : "0";
  refs.head.setAttribute("aria-expanded", String(!state.collapsed));
  refs.headSummary.textContent = state.headSummary || "";
  refs.body.hidden = !!state.collapsed;

  // "filtered" hides EVERYTHING else — Track, Snap/Untrack, Former members,
  // the timeline, even a pending error — because none of it is trustworthy
  // against a subset of the roster. This check comes first so nothing below
  // has to separately remember to also check for it.
  refs.filteredMessage.hidden = state.kind !== "filtered";
  if (state.kind === "filtered") {
    refs.trackRow.hidden = true;
    refs.formerSection.hidden = true;
    refs.actionRow.hidden = true;
    refs.untrackConfirm.hidden = true;
    refs.snapConfirm.hidden = true;
    refs.deleteConfirm.hidden = true;
    refs.errorText.hidden = true;
    refs.timeline.innerHTML = "";
    return;
  }

  refs.trackRow.hidden = state.kind !== "not-tracking";
  refs.trackBtn.disabled = state.kind === "not-tracking" && state.busy;

  const tracking = state.kind === "tracking";
  refs.formerSection.hidden = !tracking;
  refs.actionRow.hidden = !tracking;

  refs.errorText.hidden = !state.error;
  refs.errorText.textContent = state.error || "";

  if (tracking) {
    refs.snapBtn.disabled = state.busy;
    refs.untrackBtn.disabled = state.busy;
    refs.exportBtn.disabled = state.busy;
    refs.snapBtn.textContent = `Snap · ${state.currentCount} people`;

    refs.formerHeaderText.data = `Former members (${state.formerMembers.length})`;
    refs.formerThumbs.innerHTML = "";
    for (const p of state.formerMembers.slice(0, 24)) refs.formerThumbs.appendChild(thumb(p));
    refs.formerList.hidden = !state.formerExpanded;
    if (state.formerExpanded) {
      refs.formerList.innerHTML = "";
      for (const { person, leftAtText } of state.formerDetails) {
        refs.formerList.appendChild(formerRow(person, leftAtText));
      }
    }

    // Reversed for display (newest first) but each row keeps its ORIGINAL
    // index — that's what its delete button reports, and roster.js#deleteSnap
    // operates on store.snaps positions, not display positions.
    refs.timeline.innerHTML = "";
    state.snaps
      .map((snap, index) => ({ snap, index }))
      .reverse()
      .forEach(({ snap, index }) => refs.timeline.appendChild(timelineRow(snap, formatLocal, index)));
  } else {
    refs.timeline.innerHTML = "";
  }

  refs.snapConfirm.hidden = !state.snapConfirmText;
  if (state.snapConfirmText) refs.snapConfirmText.textContent = state.snapConfirmText;

  refs.deleteConfirm.hidden = !state.deleteSnapConfirmText;
  if (state.deleteSnapConfirmText) refs.deleteConfirmText.textContent = state.deleteSnapConfirmText;

  refs.untrackConfirm.hidden = !state.untrackConfirming;
}

// --- Badges ------------------------------------------------------------
// Marked with DIR_BADGE_ATTR, deliberately NOT DIR_ATTR — a sweep that
// removes every DIR_ATTR node that isn't the bar would delete every badge
// on each sync, since the bar has exactly one marked node and the grid can
// have hundreds of badges.

export function clearBadges() {
  document.querySelectorAll(`[${DIR_BADGE_ATTR}]`).forEach((n) => n.remove());
}

/**
 * @param {Set<number>} ids userIds to badge, matched against currently
 *   rendered cards only — a departed person has no card to badge.
 */
export function paintBadges(ids) {
  if (!ids.size) return;
  for (const card of findMemberCards()) {
    const scraped = scrapeCard(card);
    if (!scraped || !ids.has(scraped.userId)) continue;
    const badge = document.createElement("span");
    badge.setAttribute(DIR_BADGE_ATTR, "1");
    badge.className = "cto-dir-badge";
    badge.textContent = "NEW";
    if (getComputedStyle(card).position === "static") card.classList.add("cto-dir-badge-anchor");
    card.appendChild(badge);
  }
}
