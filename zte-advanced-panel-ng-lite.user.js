// ==UserScript==
// @name         ZTE Advanced Router Panel NG Lite
// @namespace    https://github.com/papatsonis/zte-advanced-router-panel-ng
// @version      2026-ng1.40
// @description  ZTE signal monitor and controls for ZTE 4G/5G routers with the ubus API (G5TC, MC7510, MC7530, MC8512, MC8532B and later) or the goform API (MC801A, MC888, MC888A/Ultra, MC888B, MC889, MC889A/Pro): signal, band lock, cell lock, network mode, ODU antenna selection, neighbor scan, bridge mode, DNS, APN, session timeout, temperature control, traffic stats, GPS, QoS speed cap, TR-069 remote-management toggles, hidden-page unlock, collapsible sections. Lite edition without the developer tools.
// @author       papatsonis (based on work by Cerix and Thomas Pöchtrager)
// @license      AGPL-3.0-or-later
// @homepageURL  https://github.com/papatsonis/zte-advanced-router-panel-ng
// @supportURL   https://github.com/papatsonis/zte-advanced-router-panel-ng/issues
// @downloadURL  https://raw.githubusercontent.com/papatsonis/zte-advanced-router-panel-ng/main/zte-advanced-panel-ng-lite.user.js
// @updateURL    https://raw.githubusercontent.com/papatsonis/zte-advanced-router-panel-ng/main/zte-advanced-panel-ng-lite.user.js
// @match        http://192.168.0.1/*
// @match        https://192.168.0.1/*
// @match        http://192.168.1.1/*
// @match        https://192.168.1.1/*
// @match        http://192.168.8.1/*
// @match        https://192.168.8.1/*
// @match        http://192.168.254.1/*
// @match        https://192.168.254.1/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * ZTE Advanced Router Panel NG — Lite edition
 *
 * The everyday features of the full panel, without the developer tools
 * (API finder, call recorder, custom ubus calls, raw dumps, lock probe).
 *
 * A port of "ZTE Advanced Router Panel" by Cerix to the ubus JSON-RPC API of
 * ZTE routers, built on the API calls, login flow and signal parsing of
 * "ZTE-Script-NG" by Thomas Pöchtrager, with further features added. ZTE
 * routers with the goform API are served by a second backend that works
 * through the router page's own functions.
 *
 * Port and modifications: papatsonis, 2026 — https://github.com/papatsonis/zte-advanced-router-panel-ng
 * This is a modified work. It is not maintained or endorsed by the original
 * authors; please do not ask them for support for this version.
 *
 * Copyright (C) 2026 papatsonis. Portions (C) Cerix (MIT) and Thomas
 * Pöchtrager (AGPLv3-or-later); see the third-party notices below.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details: <https://www.gnu.org/licenses/>.
 *
 * ── Third-party notices ─────────────────────────────────────────────────
 *
 * ZTE-Script-NG (ubus calls, login flow, signal parsing, frequency tables)
 *   (c) 2025 by Thomas Pöchtrager (t.poechtrager@gmail.com) — AGPLv3+
 *   https://github.com/tpoechtrager/ZTE-Web-Script
 *
 * ZTE Advanced Router Panel (panel layout, styles, feature set)
 *   https://github.com/Cerix/zte-advanced-router-panel
 *
 *   MIT License
 *
 *   Copyright (c) 2026 Cerix
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all
 *   copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 *
 * The ubus call names for the neighbor scan, mobile data on/off, DNS, APN and
 * resetting locks were found with the help of open-u60-pro (Jesther Silvestre)
 * and zte-u60-pro-mu5250-manager (faying), both MIT. No code from them is included.
 */

(function () {
  "use strict";
  if (window.__ztePanelNG) {
    try { window.dispatchEvent(new CustomEvent("zte-panel-ng-second-copy")); } catch (e) { }
    return;
  }
  window.__ztePanelNG = "starting";

  var CFG = {
    version: "2026-ng1.40",
    dev_ui: false,
    bmac: true,
    pollInterval: 1000,
    slowPollEvery: 5,
    loginWaitInterval: 1500,
    toastDuration: 4000,
    ajaxTimeout: 10000,
    retryOnAccessDenied: 5,
    lte_all_bands: [1, 3, 7, 8, 20, 28, 38, 40, 41, 42, 43],
    nr_all_bands: ["1", "3", "7", "8", "20", "28", "38", "40", "41", "75", "77", "78"],
    debug: false,
    settleMs: 1500,
    reconnectOffWaitMs: 4000,
    scanSettleMs: 6000,
    scanPollMs: 3000,
    modeWaitMs: 20000,
    modePollMs: 1500,
  };

  var ZERO_SID = "00000000000000000000000000000000";

  var S = {
    init_done: false,
    net: {},
    thermal: {},
    devinfo: {},
    wan: {},
    traffic: {},
    lte: [],
    nr: [],
    session_lost: false,
    lost_checks: 0,
    expired_warned: false,
    poll_tick: 0,
  };

  function zel(id) {
    return document.getElementById(id);
  }
  function esc(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") v = JSON.stringify(v);
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function sel_holds(e) {
    try {
      var s = window.getSelection();
      return !!s && !s.isCollapsed && s.rangeCount > 0 && s.getRangeAt(0).intersectsNode(e);
    } catch (x) {
      return false;
    }
  }
  function zset(id, t) {
    var e = zel(id);
    if (!e) return;
    t = t !== undefined && t !== null ? String(t) : "";
    if (e.textContent !== t && !sel_holds(e)) e.textContent = t;
  }
  function zhtml(id, h) {
    var e = zel(id);
    if (!e || e._zte_html === h || sel_holds(e)) return;
    e._zte_html = h;
    e.innerHTML = h;
  }

  function copy_fix_install() {
    if (window._zte_copy_fix) return;
    window._zte_copy_fix = true;
    document.addEventListener("copy", function (ev) {
      try {
        var s = window.getSelection();
        if (!s || s.isCollapsed || !s.rangeCount || !ev.clipboardData) return;
        var r = s.getRangeAt(0), host = r.commonAncestorContainer;
        if (host.nodeType !== 1) host = host.parentNode;
        if (!host || !host.closest || !host.closest("#zte_panel, #zte_modal")) return;
        var box = document.createElement("div");
        box.style.cssText = "position:fixed;left:-10000px;top:0;width:600px;white-space:normal;";
        box.appendChild(r.cloneContents());
        box.querySelectorAll(".zte_label").forEach(function (l) {
          var row = l.closest(".zte_row");
          if (row && row.querySelector(".zte_value") && l.textContent.trim()) l.appendChild(document.createTextNode(": "));
        });
        box.querySelectorAll(".zte_row").forEach(function (row) {
          if (row.style.display === "none") row.remove(); else row.style.display = "block";
        });
        (zel("zte_panel") || document.body).appendChild(box);
        var text = box.innerText.replace(/\n{3,}/g, "\n\n").trim();
        box.remove();
        if (!text) return;
        ev.clipboardData.setData("text/plain", text);
        ev.preventDefault();
      } catch (x) { }
    });
  }
  function ztoggle(id, show) {
    var e = zel(id);
    if (!e) return;
    var disp = show ? "" : "none";
    if (e.style.display !== disp) e.style.display = disp;
  }
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  function dash(v) {
    return v === null || v === undefined || v === "" ? "—" : v;
  }
  function rsrp_cls(v) {
    var n = num(v);
    if (n === null) return "";
    return n >= -80 ? "good" : n >= -100 ? "warn" : "bad";
  }
  function sinr_cls(v) {
    var n = num(v);
    if (n === null) return "";
    return n >= 20 ? "good" : n >= 10 ? "warn" : "bad";
  }
  function rsrp_color(v) {
    var c = rsrp_cls(v);
    return c === "good" ? "#2E7D32" : c === "warn" ? "#F57C00" : c === "bad" ? "#C62828" : "#37474F";
  }
  function strip_n(b) {
    return String(b || "").trim().replace(/^[nNbB]/, "");
  }

  var toastQueue = [];
  function repositionToasts() {
    var top = 18;
    for (var i = 0; i < toastQueue.length; i++) {
      toastQueue[i].style.top = top + "px";
      top += toastQueue[i].offsetHeight + 8;
    }
  }
  var TOAST_ERROR_MS = 20000, TOAST_LOG_MAX = 20, TOAST_LOG_KEY = "ZtePanelToastLog", toastLog = [];
  try { toastLog = JSON.parse(sessionStorage.getItem(TOAST_LOG_KEY) || "[]"); } catch (e) { toastLog = []; }
  if (!Array.isArray(toastLog)) toastLog = [];
  window.zte_toast_log = function () {
    return toastLog.map(function (x) { return new Date(x.t).toLocaleTimeString() + " " + x.type + ": " + x.msg; });
  };
  function toast(msg, type, ms) {
    var colors = { info: "#1976D2", ok: "#388E3C", warn: "#F57C00", error: "#D32F2F" };
    var el = document.createElement("div");
    el.style.cssText =
      "position:fixed;top:18px;right:18px;z-index:2147483647;background:" +
      (colors[type] || colors.info) +
      ";color:#fff;padding:12px 20px;border-radius:8px;font-family:Segoe UI,Verdana,sans-serif;" +
      "font-size:13px;box-shadow:0 4px 15px rgba(0,0,0,.25);max-width:min(400px, calc(100vw - 36px));box-sizing:border-box;white-space:pre-line;" +
      "word-wrap:break-word;transition:opacity .3s, top .3s ease-out;cursor:pointer;";
    el.title = "Click to close";
    el.textContent = msg;
    document.body.appendChild(el);
    toastQueue.push(el);
    repositionToasts();
    var important = type === "error" || type === "warn";
    if (important || type === "ok") {
      toastLog.push({ t: Date.now(), type: type, msg: String(msg) });
      if (toastLog.length > TOAST_LOG_MAX) toastLog.shift();
      try { sessionStorage.setItem(TOAST_LOG_KEY, JSON.stringify(toastLog)); } catch (e) { }
      try { (important ? console.warn : console.log)("[ZTE] " + type + ": " + msg); } catch (e) { }
    }
    var dur = ms || CFG.toastDuration;
    if (type === "error") dur = Math.max(dur, TOAST_ERROR_MS);
    var gone = false;
    function close() {
      if (gone) return;
      gone = true;
      el.style.opacity = "0";
      setTimeout(function () {
        var i = toastQueue.indexOf(el);
        if (i > -1) toastQueue.splice(i, 1);
        el.remove();
        repositionToasts();
      }, 350);
    }
    el.addEventListener("click", close);
    if (important && document.hidden) {
      document.addEventListener("visibilitychange", function onVis() {
        if (document.hidden) return;
        document.removeEventListener("visibilitychange", onVis);
        setTimeout(close, dur);
      });
    } else {
      setTimeout(close, dur);
    }
  }

  function sha256_js(str) {
    function rr(v, n) { return (v >>> n) | (v << (32 - n)); }
    function s0(x) { return rr(x, 7) ^ rr(x, 18) ^ (x >>> 3); }
    function s1(x) { return rr(x, 17) ^ rr(x, 19) ^ (x >>> 10); }
    function S0(x) { return rr(x, 2) ^ rr(x, 13) ^ rr(x, 22); }
    function S1(x) { return rr(x, 6) ^ rr(x, 11) ^ rr(x, 25); }
    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    var bytes = unescape(encodeURIComponent(str));
    var len = bytes.length;
    var words = [];
    for (var i = 0; i < len; i++)
      words[i >> 2] = (words[i >> 2] || 0) | (bytes.charCodeAt(i) << (24 - (i % 4) * 8));
    words[len >> 2] = (words[len >> 2] || 0) | (0x80 << (24 - (len % 4) * 8));
    var padded = Math.ceil((len + 9) / 64) * 16;
    words[padded - 1] = len * 8;
    words[padded - 2] = (len / 0x20000000) | 0;
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    for (var blk = 0; blk < padded; blk += 16) {
      var W = [];
      for (var t = 0; t < 16; t++) W[t] = words[blk + t] | 0;
      for (t = 16; t < 64; t++) W[t] = (s1(W[t - 2]) + W[t - 7] + s0(W[t - 15]) + W[t - 16]) | 0;
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var T1 = (h + S1(e) + ((e & f) ^ (~e & g)) + K[t] + W[t]) | 0;
        var T2 = (S0(a) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + T1) | 0; d = c; c = b; b = a; a = (T1 + T2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var hex = "";
    for (i = 0; i < 8; i++) hex += ("00000000" + (H[i] >>> 0).toString(16)).slice(-8);
    return hex.toUpperCase();
  }

  async function sha256Hex(str) {
    if (window.isSecureContext && window.crypto && crypto.subtle) {
      try {
        var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf))
          .map(function (b) { return b.toString(16).padStart(2, "0"); })
          .join("")
          .toUpperCase();
      } catch (e) { }
    }
    return sha256_js(str);
  }

  var MODEM_METHODS = {
    nwinfo_set_netselect: 1, nwinfo_set_gwl_bandlock: 1, nwinfo_set_lte_ext_band: 1, nwinfo_set_nrbandlock: 1,
    nwinfo_set_sa_bandlock: 1, nwinfo_lock_lte_cell: 1, nwinfo_lock_nr_cell: 1, nwinfo_set_sa_celllock: 1,
    nwinfo_reset_band_cell_setting: 1,
  };
  var SLOW_MODEM_MODELS = /^(MC7510)$/i;
  var SLOW_MODEM_ALIASES = /^(G5F|G51F)$/i;
  var MTK_NR_MODELS = /^(MC7510|MC8512)$/i;
  var MODEM_SETTLE_MS = 25000;
  function model_check() {
    if (!S.model_p) {
      S.model_p = ubusRetry({ service: "uci", method: "get", params: { config: "zwrt_common_info", section: "common_config" } }, { quiet: true }, 3)
        .then(function (r) {
          if (!r || !r.success) { S.model_p = null; return S.slow_modem === undefined ? null : S.slow_modem; }
          var vals = (r.data && r.data.values) || {};
          S.model = String(vals.model_name || "").trim();
          S.model_alias = String(vals.device_alias_name || "").trim();
          S.slow_modem = SLOW_MODEM_MODELS.test(S.model) || SLOW_MODEM_ALIASES.test(S.model_alias);
          S.mtk_nr = S.slow_modem || MTK_NR_MODELS.test(S.model) || SLOW_MODEM_ALIASES.test(S.model_alias);
          return S.slow_modem;
        }, function () { S.model_p = null; return S.slow_modem === undefined ? null : S.slow_modem; });
    }
    return S.model_p;
  }
  async function mtk_check() {
    var slow = await model_check();
    return slow === null || slow === undefined ? null : !!S.mtk_nr;
  }
  async function model_for(what) {
    var slow = await model_check();
    if (slow === null) toast(what + ": the panel could not read the router model yet — nothing was sent.\nTry again in a moment.", "warn", 10000);
    return slow;
  }
  function modem_last() {
    var t = 0;
    try { t = Number(localStorage.getItem(LS.MODEM_AT)) || 0; } catch (e) { }
    return Math.max(t, S.modem_at || 0);
  }
  function modem_mark() {
    S.modem_at = Date.now();
    try { localStorage.setItem(LS.MODEM_AT, String(S.modem_at)); } catch (e) { }
  }
  async function modem_settle() {
    var wait = modem_last() + MODEM_SETTLE_MS - Date.now();
    if (wait <= 0) return;
    if (wait > MODEM_SETTLE_MS) wait = MODEM_SETTLE_MS;
    toast("Waiting " + Math.ceil(wait / 1000) + " s — the router is still re-attaching after the last radio change…", "info", Math.min(wait, 9000));
    await sleep(wait);
  }
  async function ubus(calls, opts) {
    var arr = Array.isArray(calls) ? calls : [calls];
    var radio = arr.some(function (c) { return c && MODEM_METHODS[c.method]; });
    if (!radio || (await model_check()) === false) return ubus_raw(calls, opts);
    var run = (S.radio_q || Promise.resolve()).then(async function () {
      await modem_settle();
      var prev = modem_last();
      modem_mark();
      var res = await ubus_raw(calls, opts);
      var list = Array.isArray(res) ? res : [res];
      if (!list.some(function (r) { return r && (r.success || command_answer_uncertain(r)); })) {
        S.modem_at = prev;
        try { localStorage.setItem(LS.MODEM_AT, String(prev)); } catch (e) { }
      }
      return res;
    });
    S.radio_q = run.catch(function () { });
    return run;
  }
  async function ubus_raw(calls, opts) {
    opts = opts || {};
    var sid = opts.session || sessionStorage.getItem("ct") || ZERO_SID;
    var arr = Array.isArray(calls) ? calls : [calls];
    var req = arr.map(function (c, i) {
      return { jsonrpc: "2.0", id: i, method: "call", params: [sid, c.service, c.method, c.params || {}] };
    });

    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, CFG.ajaxTimeout);
    var json;
    try {
      var r = await fetch("/ubus/?t=" + Date.now() + "&t=" + Date.now(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Z-Mode": "1" },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      json = await r.json();
    } catch (e) {
      clearTimeout(to);
      var msg = e && e.name === "AbortError" ? "timeout" : (e && e.message || "fetch failed");
      var fails = arr.map(function () { return { success: false, data: null, error: msg, network: true }; });
      return Array.isArray(calls) ? fails : fails[0];
    } finally {
      clearTimeout(to);
    }

    var list = Array.isArray(json) ? json : [json];
    var byId = new Map(list.map(function (x) { return [x && x.id, x]; }));
    var out = req.map(function (rq) {
      var x = byId.get(rq.id);
      if (!x) return { success: false, data: null, error: "no response" };
      if (x.error) {
        if (!opts.quiet)
          console.warn("[ZTE] ubus error", rq.params[1] + "." + rq.params[2], x.error);
        dlog("ubus error", rq.params[1] + "." + rq.params[2], x.error);
        return { success: false, data: null, accessDenied: x.error.code === -32002, error: x.error.message };
      }
      var res = x.result || [];
      if (res[0] === 0) return { success: true, data: res.length > 1 ? res[1] : null };
      if (!opts.quiet) console.warn("[ZTE] ubus failed", rq.params[1] + "." + rq.params[2], "code", res[0]);
      dlog("ubus failed", rq.params[1] + "." + rq.params[2], "code", res[0]);
      return { success: false, data: null, code: res[0], error: "code " + res[0] };
    });
    return Array.isArray(calls) ? out : out[0];
  }

  async function ubusRetry(calls, opts, max) {
    max = max || CFG.retryOnAccessDenied;
    var many = Array.isArray(calls);
    var pending = many ? calls.slice() : [calls];
    var out = new Array(pending.length);
    var idx = pending.map(function (_, i) { return i; });
    for (var attempt = 0; attempt < max && idx.length; attempt++) {
      if (attempt) await sleep(250);
      var slice = idx.map(function (i) { return pending[i]; });
      var res = await ubus(slice, opts);
      var list = Array.isArray(res) ? res : [res];
      var next = [];
      for (var j = 0; j < idx.length; j++) {
        var one = list[j] || { success: false, error: "no response" };
        if (one.accessDenied) next.push(idx[j]);
        else out[idx[j]] = one;
      }
      idx = next;
    }
    idx.forEach(function (i) {
      if (!out[i]) out[i] = { success: false, accessDenied: true, error: "Access denied" };
    });
    return many ? out : out[0];
  }

  async function read_back(read, pred, ms) {
    var t0 = Date.now(), seen = false;
    await sleep(CFG.settleMs);
    for (;;) {
      var d = null;
      try { d = await read(); } catch (e) { d = null; }
      if (d) {
        seen = true;
        if (pred(d)) return true;
      }
      if (Date.now() - t0 >= ms) return seen ? false : null;
      await sleep(1500);
    }
  }

  async function run_action(label, fn, verify, opts) {
    opts = opts || {};
    var res;
    try { res = await fn(); } catch (e) { res = { success: false, error: e.message, network: true }; }
    if (res && (res.cancelled || res.denied)) return false;
    var list = Array.isArray(res) ? res : [res];
    var ok = list.every(function (r) { return r && r.success; });
    var lost = !ok && list.every(function (r) { return r && (r.success || command_answer_uncertain(r)); });
    if (!ok && !lost) {
      var bad = list.filter(function (r) { return !(r && r.success); })[0] || {};
      var why = bad.accessDenied ? " (access denied)" : bad.error ? " (" + bad.error + ")" : "";
      if (list.some(function (r) { return r && r.success; })) toast(label + " — only partly applied" + why + ". Check the setting.", "warn", 10000);
      else toast(label + " failed" + why, "error");
      poll_once();
      return false;
    }
    var v = null;
    if (verify) { try { v = await verify(); } catch (e) { v = null; } }
    poll_once();
    if (v === true) {
      toast((opts.ok || label + " ✓") + (opts.note || ""), "ok", opts.note ? 9000 : undefined);
      return true;
    }
    if (v === false) {
      toast(label + (lost ? ": no answer from the router, and it does not show the change." : ": the router accepted it, but still reads something else."),
        "warn", 10000);
      return false;
    }
    toast(label + (lost ? ": no answer from the router, and the panel could not read the setting back.\nCheck it in a moment — nothing more was sent."
      : ": sent, but the panel could not read the setting back.\nCheck it in a moment."), "warn", 10000);
    return false;
  }

  var LS = {
    PW: "ZtePanelPwHash",
    TRIED: "ZtePanelAutoLoginAt",
    USER_LOGOUT: "ZtePanelUserLogoutAt",
    NSA_TYPE: "ZtePanelNrNsaType",
    BOOT_SEEN: "ZtePanelBootSeen",
    RECONNECT: "ZtePanelReconnectPending",
    GLOCK: "ZtePanelGuidedLock",
    SCAN_RESULTS: "ZtePanelScanResults",
    SCAN_LAST: "ZtePanelScanLast",
    MODEM_AT: "ZtePanelModemChangeAt",
    HIDDEN: "ZtePanelHiddenMenus",
    DEBUG: "ZtePanelDebug",
  };
  function collapse_ls_key() { return "ZtePanelCollapse2:" + location.hostname; }

  var USER_LOGOUT_WINDOW = 60000;
  var LOGOUT_CONFIRM_WINDOW = 60000;

  function dlog() {
    if (!CFG.debug) return;
    try { console.log.apply(console, ["[ZTE]"].concat([].slice.call(arguments))); } catch (e) { }
  }

  function lsGetJson(key, maxAge, ageField) {
    try {
      var o = JSON.parse(localStorage.getItem(key) || "null");
      if (!o) return null;
      var t = o[ageField || "at"] || o.startedAt || 0;
      if (maxAge && t && Date.now() - t > maxAge) {
        localStorage.removeItem(key);
        return null;
      }
      return o;
    } catch (e) { return null; }
  }

  function op_start(name, quietSame) {
    if (S.op && S.op !== name) {
      var what = OP_NAMES[name] || "this action";
      toast(what.charAt(0).toUpperCase() + what.slice(1) + " was not started — " + (OP_NAMES[S.op] || "another change") + " is still running.", "warn");
      return false;
    }
    if (S.op === name) {
      if (quietSame) return false;
      var same = OP_NAMES[name] || "This action";
      toast(same.charAt(0).toUpperCase() + same.slice(1) + " is already running.", "info", 5000);
      return false;
    }
    S.op = name;
    S.pause_poll = name === "scan" || name === "glock" || name === "reconnect";
    return true;
  }
  function op_end(name) {
    if (S.op === name) S.op = null;
    if (!S.op) S.pause_poll = false;
  }

  function resetSessionFlags() {
    S.session_lost = false;
    S.expired_warned = false;
    S.lost_checks = 0;
    S.self_heal_tried = false;
  }

  async function onSessionRestored() {
    dlog("onSessionRestored");
    try { await reconnect_resume_if_pending(); } catch (e) { dlog("reconnect resume error", e && e.message); }
    try { glock_resume_if_pending(); } catch (e) { dlog("glock resume error", e && e.message); }
    try { await scan_results_resume(); } catch (e) { dlog("scan results error", e && e.message); }
  }

  function saved_hash() {
    try { return localStorage.getItem(LS.PW); } catch (e) { return null; }
  }
  function ms_since(storage, key) {
    var v = 0;
    try { v = Number(storage.getItem(key)) || 0; } catch (e) { }
    return Date.now() - v;
  }
  function stamp(storage, key) {
    try { storage.setItem(key, String(Date.now())); } catch (e) { }
  }
  var JOB_EXTRA_LOGINS = 2;
  function job_extra_login(consume) {
    var jobs = [[LS.RECONNECT, reconnect_get()], [LS.GLOCK, glock_get()]];
    for (var i = 0; i < jobs.length; i++) {
      var st = jobs[i][1];
      if (st && (st.extraLogins || 0) < JOB_EXTRA_LOGINS) {
        if (consume) {
          st.extraLogins = (st.extraLogins || 0) + 1;
          try { localStorage.setItem(jobs[i][0], JSON.stringify(st)); } catch (e) { }
        }
        return true;
      }
    }
    return false;
  }

  function just_logged_out() {
    return ms_since(localStorage, LS.USER_LOGOUT) < USER_LOGOUT_WINDOW;
  }

  function is_logout_control(node) {
    for (var el = node, hops = 0; el && el.nodeType === 1 && hops < 4; el = el.parentElement, hops++) {
      var txt = (el.textContent || "").trim();
      if (txt && txt.length <= 24 && /^(log\s?out|logout|sign\s?out|έξοδος|αποσύνδεση|退出|登出|注销)$/i.test(txt)) return true;
      var attrs = ((el.id || "") + " " + (el.className || "") + " " +
                   (el.getAttribute && (el.getAttribute("href") || "")) + " " +
                   (el.getAttribute && (el.getAttribute("onclick") || "")) + " " +
                   (el.getAttribute && (el.getAttribute("ng-click") || "")) + " " +
                   (el.getAttribute && (el.getAttribute("data-action") || ""))).toLowerCase();
      if (/log[\s_-]?out|sign[\s_-]?out/.test(attrs)) return true;
    }
    return false;
  }

  function el_label_is(node, re) {
    for (var el = node, hops = 0; el && el.nodeType === 1 && hops < 4; el = el.parentElement, hops++) {
      var txt = (el.textContent || "").trim();
      if (txt && txt.length <= 14 && re.test(txt)) return true;
    }
    return false;
  }
  var CONFIRM_RE = /^(yes|ok|okay|confirm|sure|ναι|εντάξει|ενταξει|确定|确认|是|好)$/i;
  var CANCEL_RE  = /^(no|cancel|όχι|οχι|άκυρο|ακυρο|取消|否)$/i;
  function in_confirm_dialog(node) {
    for (var el = node, hops = 0; el && el.nodeType === 1 && hops < 8; el = el.parentElement, hops++) {
      if (el.getAttribute && el.getAttribute("role") === "dialog") return true;
      var cls = String(el.className || "").toLowerCase();
      if (/\b(modal|dialog|confirm|popup|alert)\b/.test(cls)) return true;
    }
    return false;
  }

  function dismiss_login_again() {
    var RE = /please log ?in again|log in again|session (has )?expired|session timeout/i;
    var boxes = document.querySelectorAll('[role="dialog"], .modal, .dialog, .popup, .messager-window');
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      if (in_panel(box) || box.id === "zte_modal") continue;
      if (!box.offsetWidth && !box.offsetHeight) continue;
      if (!RE.test(box.innerText || "")) continue;
      var btns = box.querySelectorAll("button, input[type=button], a");
      for (var j = 0; j < btns.length; j++) {
        var label = (btns[j].textContent || btns[j].value || "").trim();
        if (/^(ok|okay|yes|confirm|εντάξει|ενταξει)$/i.test(label)) {
          try { btns[j].click(); dlog("dismissed a 'log in again' dialog"); return true; } catch (e) { }
        }
      }
    }
    return false;
  }

  function watch_logout_click() {
    document.addEventListener("click", function (e) {
      try {
        if (!e.isTrusted) return;
        if (is_logout_control(e.target)) {
          stamp(localStorage, LS.USER_LOGOUT);
          return;
        }
        if (ms_since(localStorage, LS.USER_LOGOUT) < LOGOUT_CONFIRM_WINDOW && in_confirm_dialog(e.target)) {
          if (el_label_is(e.target, CONFIRM_RE)) {
            stamp(localStorage, LS.USER_LOGOUT);
          } else if (el_label_is(e.target, CANCEL_RE)) {
            try { localStorage.removeItem(LS.USER_LOGOUT); } catch (err) { }
          }
        }
      } catch (err) { }
    }, true);
  }

  function ask_pw_hash() {
    return new Promise(function (resolve) {
      var ov = show_modal("Router password",
        '<div class="zte_sec" style="font-size:12px;line-height:1.5;">' +
        "This needs a developer session: type the router password (it is not saved).</div>" +
        '<div style="display:flex;gap:6px;">' +
        '<input type="password" id="zte_pw_ask" placeholder="router password" autocomplete="off" ' +
        'style="flex:1;min-width:0;padding:6px 9px;border:1px solid #B0BEC5;border-radius:6px;font-size:12px;background:#fff;color:#37474F;">' +
        '<button class="zte_btn ok" id="zte_pw_ask_ok">OK</button></div>');
      var inp = ov.querySelector("#zte_pw_ask"), done = false;
      var watch = setInterval(function () { if (!ov.isConnected) finish(null); }, 250);
      function finish(v) {
        if (done) return;
        done = true;
        clearInterval(watch);
        if (ov.isConnected) ov.remove();
        resolve(v);
      }
      async function ok() {
        var pw = inp.value;
        inp.value = "";
        if (!pw) { finish(null); return; }
        finish(await sha256Hex(pw));
      }
      ov.querySelector("#zte_pw_ask_ok").onclick = ok;
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") ok(); });
      inp.focus();
    });
  }

  async function router_login(pw_hash) {
    var saltRes = await ubus({ service: "zwrt_web", method: "web_login_info" }, { session: ZERO_SID });
    var sault = saltRes && saltRes.data && saltRes.data.zte_web_sault;
    if (!sault) return "error";
    var finalHash = await sha256Hex(pw_hash + sault);
    var r = await ubus({ service: "zwrt_web", method: "web_login", params: { password: finalHash } }, { session: ZERO_SID });
    var d = r && r.data;
    if (d && (d.result === 0 || d.result === "0") && d.ubus_rpc_session) {
      sessionStorage.setItem("ct", d.ubus_rpc_session);
      return "ok";
    }
    return d && d.result !== undefined ? "rejected" : "error";
  }

  async function check_login() {
    try {
      var r = await ubus({ service: "zwrt_web", method: "web_developer_login_info" }, { quiet: true });
      return !!(r.success && r.data);
    } catch (e) {
      return false;
    }
  }

  async function developer_option_login(pw_hash) {
    var sid = sessionStorage.getItem("ct") || ZERO_SID;
    var saltRes = await ubus({ service: "zwrt_web", method: "web_login_info" }, { session: sid });
    var sault = saltRes && saltRes.data && saltRes.data.zte_web_sault;
    if (!sault) throw new Error("could not retrieve salt");
    var finalHash = await sha256Hex(pw_hash + sault);
    var r = await ubus({ service: "zwrt_web", method: "web_developer_option_login", params: { password: finalHash } }, { session: sid });
    var d = r && r.data;
    return !!(d && (d.result === 0 || d.result === "0"));
  }

  window.zte_developer_login = async function () {
    var h = saved_hash() || (await ask_pw_hash());
    if (!h) return;
    try {
      var ok = await developer_option_login(h);
      toast(ok ? "Developer session active ✓" : "Developer login failed", ok ? "ok" : "error");
    } catch (e) {
      toast("Developer login failed: " + e.message, "error");
    }
  };

  window.zte_enable_auto_login = function () {
    var ov = show_modal("Auto Login",
      '<div class="zte_sec" style="font-size:12px;line-height:1.5;">' +
      "Save the router password so that the panel logs in by itself when you open the router page.<br>" +
      '<span style="color:#78909C;">It is stored in this browser as a SHA256 hash. Anyone who can use this browser profile ' +
      "can log in to the router with it. Nothing is changed right now; it is used the next time the page is opened.</span>" +
      '<div style="display:flex;gap:6px;margin-top:10px;">' +
      '<input type="password" id="zte_pw_in" placeholder="router password" autocomplete="off" ' +
      'style="flex:1;min-width:0;padding:6px 9px;border:1px solid #B0BEC5;border-radius:6px;font-size:12px;background:#fff;color:#37474F;">' +
      '<button class="zte_btn ok" id="zte_pw_save">Save</button></div></div>');
    var inp = ov.querySelector("#zte_pw_in");
    async function save() {
      if (!inp.value) { toast("Type the router password first", "warn"); return; }
      var h = await sha256Hex(inp.value);
      try { localStorage.setItem(LS.PW, h); } catch (e) { }
      ov.remove();
      update_login_state();
      if (saved_hash() !== h) {
        toast("The password could not be saved — this browser does not allow the page to store it\n(private window or blocked site data). Auto login stays off.", "error");
        return;
      }
      toast("Password saved.\nIt is used the next time you open the router page.", "ok");
    }
    ov.querySelector("#zte_pw_save").onclick = save;
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") save(); });
    inp.focus();
  };

  window.zte_forget_password = function () {
    if (!saved_hash()) { toast("No saved password to remove.", "info"); return; }
    if (!confirm("Forget the saved router password?\n\nAuto login will stop working until you turn it on again (\ud83d\udd11 Auto Login).")) return;
    try { localStorage.removeItem(LS.PW); } catch (e) { }
    update_login_state();
    toast("Saved password removed", "info");
  };

  function update_login_state() {
    zset("zte_autologin_state", saved_hash() ? "on (password saved)" : "off");
  }

  var LTE_EARFCN_BANDS = [
    [1, 2110, 0, 0, 599], [3, 1805, 1200, 1200, 1949], [4, 2110, 1950, 1950, 2399],
    [5, 869, 2400, 2400, 2649], [7, 2620, 2750, 2750, 3449], [8, 925, 3450, 3450, 3799],
    [20, 791, 6150, 6150, 6449], [28, 758, 9210, 9210, 9659], [32, 1452, 9920, 9920, 10359],
    [38, 2570, 37750, 37750, 38249], [40, 2300, 38650, 38650, 39649], [41, 2496, 39650, 39650, 41589],
    [42, 3400, 41590, 41590, 43589], [43, 3600, 43590, 43590, 45589], [71, 617, 68586, 68586, 68935],
  ];
  function lte_earfcn_to_mhz(earfcn) {
    var t = LTE_EARFCN_BANDS;
    for (var i = 0; i < t.length; i++) {
      if (earfcn >= t[i][3] && earfcn <= t[i][4])
        return { band: t[i][0], mhz: +(t[i][1] + 0.1 * (earfcn - t[i][2])).toFixed(1) };
    }
    return null;
  }

  var NR_ARFCN_BANDS = [
    [1, 422000, 434000], [3, 361000, 376000], [5, 173800, 178800], [7, 524000, 538000],
    [8, 185000, 192000], [20, 158200, 164200], [28, 151600, 160600], [38, 514000, 524000],
    [40, 460000, 480000], [41, 499200, 537999],
    [75, 286400, 303400], [77, 620000, 680000], [78, 620000, 653333], [79, 693334, 733333],
    [257, 2054167, 2104166], [258, 2016667, 2070833], [260, 2229167, 2279166], [261, 2070833, 2084999],
  ];
  var NR_ARFCN_MAX = 3279165;
  var LTE_EARFCN_MAX = 262143;
  function nr_arfcn_to_mhz(arfcn) {
    function f(N) {
      if (N >= 0 && N <= 599999) return 0.005 * N;
      if (N >= 600000 && N <= 2016666) return 3000 + 0.015 * (N - 600000);
      if (N >= 2016667 && N <= NR_ARFCN_MAX) return 24250 + 0.06 * (N - 2016667);
      return null;
    }
    var t = NR_ARFCN_BANDS;
    var hits = [];
    for (var i = 0; i < t.length; i++) {
      if (arfcn >= t[i][1] && arfcn <= t[i][2]) hits.push(t[i][0]);
    }
    var mhz = f(arfcn);
    if (mhz === null || !hits.length) return null;
    return { band: hits.length === 1 ? hits[0] : null, bands: hits, mhz: +mhz.toFixed(2) };
  }
  function nr_band(reported, conv) {
    var fw = strip_n(reported);
    if (/^\d+$/.test(fw)) return fw;
    return conv && conv.band != null ? String(conv.band) : "";
  }

  function cell_int(x) {
    x = String(x === undefined || x === null ? "" : x).trim();
    return /^\d{1,7}$/.test(x) ? String(parseInt(x, 10)) : null;
  }
  function check_lte_cell(pci, earfcn) {
    var p = cell_int(pci), e = cell_int(earfcn);
    if (p === null || e === null) return { error: "PCI and EARFCN must be whole numbers" };
    if (+p > 503) return { error: "LTE PCI must be between 0 and 503" };
    if (+e > LTE_EARFCN_MAX) return { error: "EARFCN must be between 0 and " + LTE_EARFCN_MAX };
    return { pci: p, earfcn: e };
  }
  function check_nr_cell(pci, arfcn, band) {
    var p = cell_int(pci), a = cell_int(arfcn), b = cell_int(strip_n(band));
    if (p === null || a === null || b === null) return { error: "PCI, ARFCN and band must be whole numbers" };
    if (+p > 1007) return { error: "5G PCI must be between 0 and 1007" };
    if (+a > NR_ARFCN_MAX) return { error: "NR-ARFCN must be between 0 and " + NR_ARFCN_MAX };
    if (+b < 1) return { error: "Band must be a 5G band number, e.g. 78" };
    var range = null;
    NR_ARFCN_BANDS.forEach(function (r) { if (r[0] === +b) range = r; });
    if (range && (+a < range[1] || +a > range[2])) {
      var conv = nr_arfcn_to_mhz(+a);
      return { error: "ARFCN " + a + " is not in n" + b + " (" + range[1] + "–" + range[2] + ")" +
        (conv && conv.bands.length ? " — it belongs to n" + conv.bands.join("/n") : "") };
    }
    return { pci: p, arfcn: a, band: b };
  }
  function nr_cell_tokens(v) {
    return String(v || "").split(",").map(function (x) { return strip_n(x); }).filter(function (x) { return x !== ""; });
  }
  function nr_cell_unlocked(v) {
    return nr_cell_tokens(v).every(function (x) { return /^0+$/.test(x); });
  }
  function nr_cell_matches(v, pci, arfcn, band) {
    var have = nr_cell_tokens(v).map(function (x) { return String(parseInt(x, 10)); }).sort().join(",");
    var want = [pci, arfcn, band].map(function (x) { return String(parseInt(x, 10)); }).sort().join(",");
    return have === want;
  }

  var CELL_ID_NONE = [268435455, 4294967295, 68719476735];
  function parse_cell_id(s) {
    if (s === null || s === undefined || s === "") return null;
    s = String(s).trim();
    var n = /^0x/i.test(s) || (/^[0-9a-f]+$/i.test(s) && !/^\d+$/.test(s)) ? parseInt(s.replace(/^0x/i, ""), 16) : parseInt(s, 10);
    return isNaN(n) || n <= 0 || CELL_ID_NONE.indexOf(n) > -1 ? null : n;
  }
  function split_cell_id(s) {
    var n = parse_cell_id(s);
    if (n === null) return null;
    return { node: Math.floor(n / 256), sector: n % 256 };
  }

  function sinr_num(v) { var n = num(v); return n !== null && n <= -3276 ? null : n; }
  function parse_lte_cells(d) {
    var out = [];
    if (!d || !d.lteca) return out;
    var ca = d.lteca.split(";").filter(function (e) { return e.trim() !== ""; });
    var sig = d.ltecasig ? d.ltecasig.split(";").filter(function (e) { return e.trim() !== ""; }) : [];
    ca.forEach(function (entry, idx) {
      var p = entry.split(",").map(function (x) { return x.trim(); });
      if (p.length < 5) return;
      var c = {
        pci: parseInt(p[0], 10),
        earfcn: parseInt(p[3], 10),
        bandwidth: parseInt(p[4], 10),
        rsrp: null, rsrq: null, sinr: null, rssi: null,
        ul: true, active: true,
      };
      if (idx === 0) {
        c.rsrp = num(d.lte_rsrp); c.rsrq = num(d.lte_rsrq); c.sinr = sinr_num(d.lte_snr); c.rssi = num(d.lte_rssi);
      } else if (sig[idx - 1]) {
        var s = sig[idx - 1].split(",").map(function (x) { return x.trim(); });
        if (s.length >= 6) {
          c.rsrp = num(s[0]); c.rsrq = num(s[1]); c.sinr = sinr_num(s[2]); c.rssi = num(s[3]);
          c.ul = s[4] === "1"; c.active = s[5] === "2";
        }
      }
      var f = lte_earfcn_to_mhz(c.earfcn);
      c.band = f ? String(f.band) : "";
      c.freq = f ? f.mhz : null;
      out.push(c);
    });
    return out;
  }

  function parse_nr_cells(d) {
    var out = [];
    if (!d) return out;
    if (d.nr5g_action_channel) {
      var arfcn = parseInt(d.nr5g_action_channel, 10);
      var conv = nr_arfcn_to_mhz(arfcn);
      out.push({
        pci: parseInt(d.nr5g_pci, 10),
        arfcn: arfcn,
        bandwidth: parseInt(d.nr5g_bandwidth, 10),
        rsrp: num(d.nr5g_rsrp), rsrq: num(d.nr5g_rsrq), sinr: sinr_num(d.nr5g_snr), rssi: num(d.nr5g_rssi),
        ul: true, active: true,
        band: nr_band(d.nr5g_action_band, conv),
        freq: conv ? conv.mhz : null,
      });
    }
    if (d.nrca) {
      d.nrca.split(";").filter(function (e) { return e.trim() !== ""; }).forEach(function (entry) {
        var p = entry.split(",").map(function (x) { return x.trim(); });
        if (p.length < 11) return;
        var a = parseInt(p[4], 10);
        var cv = nr_arfcn_to_mhz(a);
        var unmeasured = num(p[7]) !== null && num(p[7]) <= -140;
        out.push({
          pci: parseInt(p[1], 10),
          arfcn: a,
          bandwidth: parseInt(p[5], 10),
          rsrp: unmeasured ? null : num(p[7]), rsrq: unmeasured ? null : num(p[8]),
          sinr: unmeasured ? null : sinr_num(p[9]), rssi: unmeasured ? null : num(p[10]),
          ul: parseInt(p[0], 10) === 1,
          active: parseInt(p[2], 10) === 2,
          band: nr_band(p[3], cv),
          freq: cv ? cv.mhz : null,
        });
      });
    }
    return out;
  }

  function net_flags(nt) {
    var is_sa = nt === "SA";
    var is_nsa = nt === "ENDC" || nt === "LTE-NSA";
    return {
      is_lte: nt === "LTE" || is_nsa,
      is_sa: is_sa,
      is_nsa: is_nsa,
      show_nr: is_sa || is_nsa,
    };
  }

  function band_info(lte, nr) {
    var parts = [];
    nr.forEach(function (c) { if (c.band) parts.push("n" + c.band + (c.bandwidth ? "(" + c.bandwidth + "MHz)" : "")); });
    lte.forEach(function (c) { if (c.band) parts.push("B" + c.band + (c.bandwidth ? "(" + c.bandwidth + "MHz)" : "")); });
    return parts.join(" + ");
  }

  function lte_mask_from_bands(bands) {
    return bands.reduce(function (m, b) { return m | (1n << BigInt(Number(b) - 1)); }, 0n);
  }
  function lte_bands_from_mask(raw) {
    var m;
    try { m = BigInt(String(raw).trim()); } catch (e) { return null; }
    var out = [];
    for (var b = 1; b <= 128; b++) if ((m >> BigInt(b - 1)) & 1n) out.push(b);
    return out;
  }
  function parse_band_input(s) {
    var tokens = String(s).split(/[+,\s]+/).map(strip_n).filter(Boolean);
    if (!tokens.length || !tokens.every(function (t) { return /^\d+$/.test(t); })) return null;
    return tokens;
  }

  var NET_MODES = {
    Only_5G: "5G SA",
    LTE_AND_5G: "5G NSA",
    WL_AND_5G: "4G/5G Auto",
    Only_LTE: "LTE Only",
  };

  function type_fits_mode(mode, nt) {
    var f = net_flags(nt);
    if (mode === "Only_LTE") return f.is_lte && !f.is_nsa;
    if (mode === "Only_5G") return f.is_sa;
    return true;
  }

  window.zte_set_net_mode = async function (mode) {
    if (radio_busy("Network mode")) return;
    var label = "Network mode → " + (NET_MODES[mode] || mode);
    if (!/^[A-Za-z0-9_]{2,40}$/.test(mode)) {
      toast("“" + mode + "” is not a network-mode name (letters, digits and _ only) — nothing was sent.", "error", 9000);
      return false;
    }
    if (!confirm("Switch network mode to " + (NET_MODES[mode] || mode) + "?\n\nMobile data drops for a few seconds while the modem re-attaches.")) return false;
    if (radio_busy("Network mode")) return false;
    if (!op_start("net_mode")) return false;
    try {
      var typeBefore = S.net && S.net.network_type, modeBefore = S.net && S.net.net_select;
      var r = await ubusRetry({ service: "zte_nwinfo_api", method: "nwinfo_set_netselect", params: { net_select: mode } });
      var t0 = Date.now();
      if (r.accessDenied) { toast(label + " failed (access denied)", "error"); return false; }
      var slow = await model_check();
      var lost = !r.success && command_answer_uncertain(r);
      if (!r.success && !lost) {
        toast(label + " failed" + (r.error ? " (" + r.error + ")" : ""), "error");
        return false;
      }
      var d;
      if (slow !== false) {
        var w = await radio_wait(function (x) {
          return x.net_select === mode && has_service(x) && type_fits_mode(mode, x.network_type) &&
            (x.network_type !== typeBefore || Date.now() - t0 >= 20000);
        }, 30000);
        d = w.d;
      } else {
        await sleep(CFG.settleMs);
        d = await fresh_netinfo();
        var waitNew = !!typeBefore && modeBefore !== mode;
        var settled = function (x) {
          return has_service(x) && type_fits_mode(mode, x.network_type) && !(waitNew && x.network_type === typeBefore);
        };
        for (var i = 0; i < 8 && d && d.net_select === mode && !settled(d); i++) {
          await sleep(1000);
          d = (await fresh_netinfo()) || d;
        }
      }
      if (!d) { toast(label + " — sent, but the router could not be read back yet.", "warn", 9000); return true; }
      if (d.net_select !== mode) {
        toast(label + (lost ? " — sent, but the router did not answer and still reports " : " — the router accepted it, but still reports ") +
          (NET_MODES[d.net_select] || d.net_select || "?") + ".", "warn", 10000);
        return false;
      }
      var svc = has_service(d);
      if (svc && !type_fits_mode(mode, d.network_type)) {
        toast(label + " stored ✓ — the router still reports " + d.network_type + ".\nThe switch can take a few seconds; check the network type.", "warn", 10000);
        return true;
      }
      toast(label + " ✓" + (svc ? " (" + d.network_type + ")" : " — stored; no service yet (" + (d.network_type || "?") + ")"), svc ? "ok" : "warn");
      return true;
    } finally { op_end("net_mode"); poll_once(); }
  };

  function lte_sets_equal(a, b) {
    var x = band_list(a.join(",")), y = band_list(b.join(","));
    return x.join() === y.join();
  }
  var LTE_DECIDE_MS = 22000;
  async function lte_stored(want, how) {
    var t0 = Date.now(), seen = false;
    var low = want.filter(function (b) { return Number(b) <= LTE_MASK_MAX_BAND; });
    var high = low.length < want.length;
    while (Date.now() - t0 < 30000) {
      await sleep(1500);
      var d = await fresh_netinfo();
      if (!d) continue;
      seen = true;
      var list = band_list(d.lte_band);
      var mb = (lte_bands_from_mask(d.lte_band_lock) || []).map(String);
      if (how === "mask") {
        if (lte_sets_equal(mb, low)) return "ok";
      } else if (list.length) {
        if (lte_sets_equal(list, want)) return "ok";
      } else if (high) {
        if (Date.now() - t0 > LTE_DECIDE_MS) return "unconfirmed";
      } else if (lte_sets_equal(mb, low)) {
        return "ok";
      }
      if (Date.now() - t0 > LTE_DECIDE_MS) return "other";
    }
    return seen ? "other" : "unknown";
  }
  async function send_lte_bands(list, label) {
    list = band_list(list.join(","));
    var low = list.filter(function (b) { return Number(b) <= LTE_MASK_MAX_BAND; });
    var order = low.length < list.length ? ["list", "mask"] : ["mask", "list"];
    if (!op_start("lte_band")) return false;
    try {
      if (await model_check()) {
        var now = await fresh_netinfo();
        var nl = now ? band_list(now.lte_band) : [];
        var nm = now ? (lte_bands_from_mask(now.lte_band_lock) || []).map(String) : [];
        if (now && (nl.length ? lte_sets_equal(nl, list) : low.length === list.length && lte_sets_equal(nm, low))) {
          toast(label + " ✓ (already set — nothing sent)", "ok");
          return true;
        }
      }
      toast(label + "…", "info");
      for (var i = 0; i < order.length; i++) {
        var how = order[i], r;
        if (how === "mask") {
          if (!low.length) continue;
          r = await ubusRetry({
            service: "zte_nwinfo_api",
            method: "nwinfo_set_gwl_bandlock",
            params: { is_gw_band: "0", gw_band_mask: "0", is_lte_band: "1", lte_band_mask: lte_mask_from_bands(low).toString() },
          });
        } else {
          r = await ubusRetry({ service: "zte_nwinfo_api", method: "nwinfo_set_lte_ext_band", params: { lte_band: list.join(",") } });
        }
        if (r.accessDenied) { toast(label + " failed (access denied)", "error"); return false; }
        if (!r.success && !command_answer_uncertain(r)) {
          continue;
        }
        var target = how === "mask" ? low : list;
        var st = await lte_stored(target, how);
        if (st === "ok" && target.length < list.length) {
          toast(label + " — without B" + list.filter(function (b) { return low.indexOf(b) < 0; }).join(", B") +
            ":\nthis router does not take LTE bands above B" + LTE_MASK_MAX_BAND + ".", "warn", 10000);
          return true;
        }
        if (st === "ok") { toast(label + " ✓", "ok"); return true; }
        if (st === "unconfirmed") {
          toast(label + " sent — this router does not report its LTE band list,\nso bands above B" + LTE_MASK_MAX_BAND +
            " cannot be confirmed.", "warn", 10000);
          return true;
        }
        if (st === "unknown") {
          toast(label + " sent, but the router did not answer afterwards.\nCheck the LTE bands in a moment.", "warn", 9000);
          return false;
        }
      }
      toast(label + " failed — the router did not store it.", "error", 9000);
      return false;
    } finally { op_end("lte_band"); poll_once(); }
  }

  function nr_lock_fields(d) {
    var out = {};
    Object.keys(d || {}).forEach(function (k) {
      if (/^nr.*band_lock$/i.test(k) || k === "nr5g_sa_band_lock") out[k] = d[k];
    });
    return out;
  }
  var UCI_BAND_DEFAULTS = { service: "uci", method: "get", params: { config: "zwrt_zte_nwinfo", section: "default_band_lock" } };

  function band_list(v) {
    var seen = {};
    return String(v || "").split(/[,+\s]+/).map(strip_n).filter(function (b) {
      if (!/^\d+$/.test(b) || seen[b]) return false;
      seen[b] = true;
      return true;
    }).sort(function (a, b) { return a - b; });
  }
  function lte_from_router() { return !!(S.bands && S.bands.lte.length); }
  function nr_from_router() { return !!(S.bands && (S.bands.nr_sa.length || S.bands.nr_nsa.length)); }
  function lte_avail() {
    return lte_from_router() ? S.bands.lte : CFG.lte_all_bands.map(String);
  }
  var LTE_MASK_MAX_BAND = 64;
  function lte_avail_in_mask() {
    return lte_avail().filter(function (b) { return Number(b) <= LTE_MASK_MAX_BAND; });
  }
  function nr_avail(which) {
    if (!nr_from_router()) return CFG.nr_all_bands.map(String);
    var b = S.bands;
    if (which === "sa") return b.nr_sa.length ? b.nr_sa : b.nr_nsa;
    if (which === "nsa") return b.nr_nsa.length ? b.nr_nsa : b.nr_sa;
    return band_list(b.nr_sa.concat(b.nr_nsa).join(","));
  }
  function load_band_caps() {
    if (S.bands_loaded) return Promise.resolve();
    if (!S.bands_p) S.bands_p = load_band_caps_once().then(function () { S.bands_p = null; }, function () { S.bands_p = null; });
    return S.bands_p;
  }
  async function load_band_caps_once() {
    try {
      var r = await ubusRetry(UCI_BAND_DEFAULTS, { quiet: true });
      if (!r || !r.success) {
        S.bands_tries = (S.bands_tries || 0) + 1;
        if (S.bands_tries < 4) setTimeout(load_band_caps, 8000);
        else S.bands_gave_up = true;
        return;
      }
      var v = uci_values(r) || {};
      var lte = band_list(v.default_lte_ext_band_lock);
      if (!lte.length && v.default_lte_band_lock) lte = (lte_bands_from_mask(v.default_lte_band_lock) || []).map(String);
      S.bands = { lte: lte, nr_sa: band_list(v.default_nr5g_sa_band_lock), nr_nsa: band_list(v.default_nr5g_nsa_band_lock) };
      S.bands_loaded = true;
      render_band_chips();
    } catch (e) { S.bands_gave_up = true; }
  }

  var BAND_PRESETS = {
    lte: ["1", "3", "7", "8", "20", "28", "1+3", "1+3+7", "1+3+20", "1+3+7+20", "3+20"],
    nr: ["1", "3", "7", "28", "38", "75", "78", "1+78", "28+75", "38+78", "3+38+78", "28+78", "78+28+75"],
  };
  function band_chips(kind) {
    var lte = kind === "lte";
    var avail = lte ? lte_avail() : nr_avail();
    var prefix = lte ? "B" : "N", fn = lte ? "window.zte_lte_band" : "window.zte_nr_band";
    return '<div class="zte_bandrow">' +
      BAND_PRESETS[kind].filter(function (c) {
        return c.split("+").every(function (b) { return avail.indexOf(b) > -1; });
      }).map(function (b) { return chip(prefix + b, fn + "('" + b + "')"); }).join("") +
      chip("✏ Custom", fn + "(null)") + "</div>";
  }
  function bands_supported_text(kind) {
    if (!S.bands_loaded) return "reading…";
    if (kind === "lte") return lte_from_router() ? "B" + S.bands.lte.join(", B") : "not reported by this router";
    if (!nr_from_router()) return "not reported by this router";
    var sa = S.bands.nr_sa, nsa = S.bands.nr_nsa;
    if (!sa.length || !nsa.length || sa.join() === nsa.join()) return "n" + nr_avail().join(", n");
    return "SA n" + sa.join(", n") + " · NSA n" + nsa.join(", n");
  }
  function render_band_chips() {
    zhtml("zte_lte_chips", band_chips("lte"));
    zhtml("zte_nr_chips", band_chips("nr"));
    zset("zte_lte_supported", bands_supported_text("lte"));
    zset("zte_nr_supported", bands_supported_text("nr"));
  }
  function bands_missing(list, avail, known) {
    return known ? list.filter(function (b) { return avail.indexOf(String(b)) === -1; }) : [];
  }

  function nr_locked_list(v, which) {
    var l = String(v || "").split(",").map(strip_n).filter(Boolean);
    var all = nr_avail(which).every(function (b) { return l.indexOf(b) > -1; });
    return l.length && !all ? l : null;
  }
  function band_set(v) {
    return String(v || "").split(",").map(strip_n).filter(Boolean).sort().join(",");
  }
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }
  async function fresh_netinfo() {
    var r = await ubusRetry({ service: "zte_nwinfo_api", method: "nwinfo_get_netinfo" }, { quiet: true }, 5);
    return r.success && r.data ? r.data : null;
  }

  var NSA_TYPES = ["1", "NSA"];
  function nsa_type() {
    try { var v = localStorage.getItem(LS.NSA_TYPE); if (v) return v; } catch (e) { }
    return NSA_TYPES[0];
  }

  function nr_lock_call(type, bands) {
    return {
      service: "zte_nwinfo_api",
      method: "nwinfo_set_nrbandlock",
      params: { nr5g_type: String(type), nr5g_band: bands.join(",") },
    };
  }

  var NR_READBACK_MS = 7000;
  async function nr_lock_once(type, bands, target) {
    var r = await ubusRetry(nr_lock_call(type, bands));
    var lost = !r.success && !r.accessDenied && command_answer_uncertain(r);
    if (!r.success && !lost) return { ok: false, error: r.error };
    var want = band_set(bands.join(",")), d = null;
    if (await model_check()) {
      var re = target === "nsa" ? /_nsa_band_lock$/i : /_sa_band_lock$/i;
      var t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        await sleep(1500);
        var dd = await fresh_netinfo();
        if (!dd) continue;
        d = dd;
        var ff = nr_lock_fields(dd);
        if (Object.keys(ff).some(function (k) { return re.test(k) && band_set(ff[k]) === want; })) break;
        if (Date.now() - t0 > LTE_DECIDE_MS) break;
      }
    } else {
      var reN = target === "nsa" ? /_nsa_band_lock$/i : /_sa_band_lock$/i;
      var holds = function (x) {
        var fx = nr_lock_fields(x);
        return Object.keys(fx).some(function (k) { return reN.test(k) && band_set(fx[k]) === want; });
      };
      var tN = Date.now();
      await sleep(CFG.settleMs);
      d = await fresh_netinfo();
      while (Date.now() - tN < NR_READBACK_MS) {
        if (d && holds(d)) break;
        await sleep(1000);
        d = (await fresh_netinfo()) || d;
      }
    }
    if (!d) return { ok: true, checked: false, lost: lost };
    var f = nr_lock_fields(d);
    function has(re) { return Object.keys(f).some(function (k) { return re.test(k) && band_set(f[k]) === want; }); }
    return { ok: true, checked: true, sa: has(/_sa_band_lock$/i), nsa: has(/_nsa_band_lock$/i), fields: f, lost: lost };
  }

  async function nr_lock_apply(target, bands) {
    var mtk = await mtk_check();
    var first = mtk ? "1" : nsa_type();
    var types = target === "sa" ? ["SA"] : mtk ? ["1"] : [first].concat(NSA_TYPES.filter(function (t) { return t !== first; }));
    var res = null, lastRead = null;
    for (var i = 0; i < types.length; i++) {
      res = await nr_lock_once(types[i], bands, target);
      if (!res.ok) {
        if (i === types.length - 1 && lastRead) res = lastRead;
        continue;
      }
      if (!res.checked) break;
      lastRead = res;
      if (res[target]) {
        if (target === "nsa" && types[i] !== first) { try { localStorage.setItem(LS.NSA_TYPE, types[i]); } catch (e) { } }
        break;
      }
      if (res.lost) break;
    }
    return res;
  }

  async function send_nr_bands(bands, label, nsaBands) {
    if (!op_start("nr_band")) return "failed";
    try { return await send_nr_bands_inner(bands, label, nsaBands); } finally { op_end("nr_band"); }
  }
  async function send_nr_bands_inner(bands, label, nsaBands) {
    if ((await mtk_check()) === null) {
      toast(label + ": the panel could not read the router model yet — nothing was sent.\nTry again in a moment.", "warn", 10000);
      return "failed";
    }
    var nsaList = nsaBands || bands;
    var noSa = !bands.length, noNsa = !nsaList.length;
    if (noSa && noNsa) { toast(label + ": none of these bands is in the router's 5G lists — nothing was sent.", "error"); return "failed"; }
    var skip = { sa: false, nsa: false };
    if (await model_check()) {
      var now = await fresh_netinfo();
      if (now) {
        var f0 = nr_lock_fields(now);
        skip.sa = !noSa && f0.nr5g_sa_band_lock !== undefined && band_set(f0.nr5g_sa_band_lock) === band_set(bands.join(","));
        skip.nsa = !noNsa && f0.nr5g_nsa_band_lock !== undefined && band_set(f0.nr5g_nsa_band_lock) === band_set(nsaList.join(","));
        if ((noSa || skip.sa) && (noNsa || skip.nsa)) { toast(label + " ✓ (already set — nothing sent)", "ok"); return "ok"; }
      }
    }
    toast(label + "…", "info");
    var sa = noSa ? { ok: true, checked: true, sa: false, none: true } : skip.sa ? { ok: true, checked: true, sa: true } : await nr_lock_apply("sa", bands);
    if (!sa.ok) {
      toast(label + " failed" + (sa.error ? " (" + sa.error + ")" : ""), "error");
      return "failed";
    }
    if (sa.lost && !(sa.checked && sa.sa)) {
      poll_once();
      toast(label + " sent, but the router did not answer and does not show the new 5G lock yet — check it in a moment.", "warn", 10000);
      return "unverified";
    }
    var nsa = noNsa ? { ok: true, checked: true, nsa: false, none: true } : skip.nsa ? { ok: true, checked: true, nsa: true } : await nr_lock_apply("nsa", nsaList);
    poll_once();
    if (!sa.checked) {
      toast(label + " sent, but the panel could not confirm it was saved.", "warn");
      return "unverified";
    }
    var nsaChecked = nsa.ok && nsa.checked;
    var nsaWritten = !noNsa && !skip.nsa;
    var saSaved = sa.sa;
    var saKeys = nsa.fields ? Object.keys(nsa.fields).filter(function (k) { return /_sa_band_lock$/i.test(k) && !/_nsa_/i.test(k); }) : [];
    if (nsaWritten && nsaChecked && saKeys.length) {
      var wantSa = band_set(bands.join(","));
      saSaved = Object.keys(nsa.fields).some(function (k) { return /_sa_band_lock$/i.test(k) && !/_nsa_/i.test(k) && band_set(nsa.fields[k]) === wantSa; });
    }
    var nsaSaved = nsaChecked && nsa.nsa;
    var onNsa = net_flags(S.net.network_type).is_nsa;
    var stayHint = S.slow_modem ? "" : "\nIf the router stays on the old band, switch network mode once.";
    if (sa.none || nsa.none) {
      var one = sa.none ? "NSA" : "SA", other = sa.none ? "SA" : "NSA", res = sa.none ? nsa : sa;
      if (!res.ok) { toast(label + " failed" + (res.error ? " (" + res.error + ")" : ""), "error"); return "failed"; }
      if (!res.checked) { toast(label + " sent for 5G " + one + ", but the panel could not confirm it was saved.", "warn"); return "unverified"; }
      if (sa.none ? res.nsa : res.sa) {
        toast(label + " ✓ for 5G " + one + " — these bands are not in the router's " + other + " list, which was left as it is." + stayHint, "ok", 9000);
        return "ok";
      }
      if (res.lost) { toast(label + " sent for 5G " + one + ", but the router did not answer and does not show it yet — check it in a moment.", "warn", 10000); return "unverified"; }
      toast("The router did not save the 5G band lock (" + one + ").", "error");
      return "failed";
    }
    if (saSaved && nsaSaved) {
      toast(label + " ✓ (5G SA + NSA lists)" + stayHint, "ok");
      return "ok";
    }
    if (onNsa ? nsaSaved : saSaved) {
      toast(label + " ✓ for 5G " + (onNsa ? "NSA" : "SA") + " (the mode in use); the " + (onNsa ? "SA" : "NSA") +
        " list could not be confirmed." + stayHint, "ok", 9000);
      return "ok";
    }
    if (saSaved) {
      toast(label + " was saved for 5G SA only.\nOn 5G NSA this router may not apply it.", "warn");
      return "partial";
    }
    if (sa.lost || nsa.lost) {
      toast(label + " sent, but the router did not answer and does not show it yet — check it in a moment.", "warn", 10000);
      return "unverified";
    }
    toast("The router did not save the 5G band lock.", "error");
    return "failed";
  }

  function denied_msg(what) {
    return "The router refused " + what + ".\nLog in to the router again and retry.";
  }

  var _rpcModuleName = null;
  async function rpc_module_name() {
    if (_rpcModuleName) return _rpcModuleName;
    var urls = new Set();
    document.querySelectorAll("script[src]").forEach(function (s) { urls.add(s.src); });
    (performance.getEntriesByType("resource") || []).forEach(function (e) {
      if (/\.js(\?|$)/i.test(e.name)) urls.add(e.name);
    });
    var re = /RPC_MODULE_NAME\s*[:=]\s*["']([^"']+)["']/;
    for (var u of urls) {
      if (new URL(u, location.href).origin !== location.origin) continue;
      try {
        var m = re.exec(await (await fetch(u)).text());
        if (m) { _rpcModuleName = m[1]; break; }
      } catch (e) { }
    }
    _rpcModuleName = _rpcModuleName || "web";
    return _rpcModuleName;
  }

  var UB_REBOOT_KEY = "ZtePanelRebootAt", UB_REBOOT_MS = 360000;
  function ub_rebooting() { return ms_since(sessionStorage, UB_REBOOT_KEY) < UB_REBOOT_MS; }
  window.zte_reboot = async function () {
    if (!confirm("Reboot the router?")) return;
    stamp(sessionStorage, UB_REBOOT_KEY);
    var lost = "No answer from the router — it is probably rebooting.\nLog in again once it is back (about 1–2 min).";
    try {
      var mod = await rpc_module_name();
      var r = await ubusRetry({ service: "zwrt_mc.device.manager", method: "device_reboot", params: { moduleName: mod } });
      if (!r.success && command_answer_uncertain(r)) { toast(lost, "warn", 9000); return; }
      if (!r.success) {
        var r2 = await ubus({ service: "system", method: "reboot" });
        if (!r2.success && command_answer_uncertain(r2)) { toast(lost, "warn", 9000); return; }
        if (!r2.success) {
          try { sessionStorage.removeItem(UB_REBOOT_KEY); } catch (e) { }
          toast("Reboot failed (device_reboot: " + (r.error || "?") + ", system.reboot: " + (r2.error || "?") + ")", "error");
          return;
        }
      }
      toast("Router rebooting… log in again once it is back (about 1–2 min).", "warn");
    } catch (e) {
      toast(lost, "warn", 9000);
    }
  };

  async function get_wwan() {
    var variants = [{ source_module: "web", cid: 1 }, { cid: 1 }];
    for (var i = 0; i < variants.length; i++) {
      var r = await ubusRetry({ service: "zwrt_data", method: "get_wwaniface", params: variants[i] }, { quiet: true });
      if (r.success && r.data) return r.data;
    }
    return null;
  }
  function numish(v) {
    return v !== "" && v !== null && v !== undefined && !isNaN(v) ? Number(v) : v;
  }
  async function set_wwan(cur, enable, retries) {
    var body = { cid: 1, connect_mode: numish(cur.connect_mode), roam_enable: numish(cur.roam_enable), enable: enable };
    if (!enable) body.connect_status = "disconnected";
    if (S.poll_inflight) { try { await S.poll_inflight; } catch (e) { } }
    var r = await ubusRetry({ service: "zwrt_data", method: "set_wwaniface", params: body }, null, retries);
    return r;
  }
  function wwan_up(st) {
    if (!st) return false;
    var cs = String(st.connect_status || "").trim();
    if (/^connected(?:$|[\s,;+/])/i.test(cs) ||
        /(?:^|[_\s,;+/])ipv4_connected(?:$|[_\s,;+/])/i.test(cs) ||
        /^(?:ipv4_ipv6|ipv6_ipv4)_connected$/i.test(cs)) return true;
    return /^ipv6_connected$/i.test(cs) && String(st.enable) === "1";
  }
  function wwan_coming_up(st) {
    return !!st && !wwan_up(st) && (String(st.enable) === "1" || /connecting/i.test(String(st.connect_status || "")));
  }
  function wwan_connecting(st) {
    var cs = String((st && st.connect_status) || "");
    return !!st && !wwan_up(st) && /connecting/i.test(cs) && !/disconnecting/i.test(cs);
  }
  var RECONNECT_MAX_TRIES = 4;
  var RECONNECT_MAX_AGE = 600000;
  function reconnect_mark(cur) { try { localStorage.setItem(LS.RECONNECT, JSON.stringify({ at: Date.now(), connect_mode: cur.connect_mode, roam_enable: cur.roam_enable, tries: 0 })); } catch (e) { } }
  function reconnect_get() { return lsGetJson(LS.RECONNECT, RECONNECT_MAX_AGE, "at"); }
  function reconnect_clear() { try { localStorage.removeItem(LS.RECONNECT); } catch (e) { } }
  function reconnect_save(st) { try { localStorage.setItem(LS.RECONNECT, JSON.stringify(st)); } catch (e) { } }
  function command_answer_uncertain(r) { return !r || !!r.network || r.error === "no response"; }
  var RECONNECT_OFF_SETTLE_MS = 20000;
  function reconnect_off_issued() {
    var st = reconnect_get();
    if (st) { st.holdUntil = Date.now() + RECONNECT_OFF_SETTLE_MS; reconnect_save(st); }
  }
  async function reconnect_read_past_hold(where) {
    var st = await get_wwan();
    var mk = reconnect_get();
    var until = mk && mk.holdUntil ? mk.holdUntil : 0;
    while (wwan_up(st) && Date.now() < until) {
      await sleep(2000);
      st = await get_wwan();
    }
    return st;
  }
  var RECONNECT_ON_WINDOW = 45000;
  var RECONNECT_MAX_ONS = 6;
  function reconnect_on_budget_left() {
    var st = reconnect_get();
    return !st || (st.ons || 0) < RECONNECT_MAX_ONS;
  }
  function reconnect_give_up(where, why) {
    reconnect_clear();
    toast("Could not finish the reconnect (" + why + ").\nTurn mobile data on in the router's own page.", "warn", 12000);
    return true;
  }
  function reconnect_note_on() {
    var st = reconnect_get();
    if (!st) return 0;
    var prev = st.onAt || 0;
    st.onAt = Date.now();
    delete st.holdUntil;
    st.ons = (st.ons || 0) + 1;
    reconnect_save(st);
    return prev;
  }
  function reconnect_on_answer(on, prevOnAt) {
    if (on && !on.success && !on.network) {
      var st = reconnect_get();
      if (st) { st.onAt = prevOnAt || 0; reconnect_save(st); }
    }
  }
  function reconnect_done(where, st, okMsg) {
    var mk = reconnect_get();
    if (mk && mk.scanUntil && mk.scanUntil > Date.now()) {
      mk.watch = 1; delete mk.onAt; reconnect_save(mk);
      reconnect_recheck_later(mk.scanUntil - Date.now() + 1000);
    } else {
      reconnect_clear();
    }
    toast(okMsg || "Reconnected ✓ (" + st.connect_status + ")", "ok");
    poll_once();
    return true;
  }
  async function reconnect_wait_pending_on(where, live) {
    var st = reconnect_get() || {};
    var until = Math.max((st.onAt || 0) + RECONNECT_ON_WINDOW, wwan_coming_up(live) ? Date.now() + 30000 : 0);
    if (until <= Date.now()) return null;
    while (Date.now() < until) {
      await sleep(2000);
      var now = await get_wwan();
      if (wwan_up(now)) return now;
      if (!now && !(await check_login())) return "gone";
    }
    return null;
  }

  async function reconnect_check_before_on(where) {
    var st = await reconnect_read_past_hold(where);
    if (wwan_up(st)) return st;
    if (!st && !(await check_login())) return "gone";
    var w = await reconnect_wait_pending_on(where, st);
    if (w) return w;
    st = await reconnect_read_past_hold(where);
    if (wwan_up(st)) return st;
    if (!st) return (await check_login()) ? "unknown" : "gone";
    if (wwan_connecting(st)) return "unknown";
    return null;
  }
  var RECONNECT_RECHECK_MS = 30000;
  function reconnect_recheck_later(ms) {
    if (S.reconnect_timer) return;
    S.reconnect_timer = setTimeout(function () { S.reconnect_timer = null; reconnect_resume_if_pending(); }, ms || RECONNECT_RECHECK_MS);
  }

  async function reconnect_turn_on(cur, where) {
    var on = null, st;
    S.reconnect_alive = false;
    for (var i = 0; i < 3 && !(on && on.success); i++) {
      if (i > 0) {
        st = await reconnect_check_before_on(where);
        if (st === "gone" || st === "unknown") break;
        if (st) return reconnect_done(where, st);
      }
      if (!reconnect_on_budget_left()) return reconnect_give_up(where, RECONNECT_MAX_ONS + " attempts");
      var prevOn = reconnect_note_on();
      on = await set_wwan(cur, 1, 1);
      reconnect_on_answer(on, prevOn);
      if (on && on.accessDenied) break;
      if (!(on && on.success)) await sleep(1500);
    }
    if (!(on && on.success)) {
      var alive = false;
      try { alive = await check_login(); } catch (e) { alive = false; }
      if (alive) {
        st = await reconnect_check_before_on(where);
        if (st === "gone") alive = false;
        else if (st && st !== "unknown") return reconnect_done(where + " (ON not confirmed, data up)", st);
        else if (!st && !reconnect_on_budget_left()) return reconnect_give_up(where, RECONNECT_MAX_ONS + " attempts");
        if (alive && st === "unknown") {
          S.reconnect_alive = true;
          return false;
        }
        if (alive) {
          await sleep(3000);
          st = await reconnect_check_before_on(where);
          if (st === "gone") { alive = false; }
          else if (st === "unknown") {
            S.reconnect_alive = true;
            return false;
          } else if (st) return reconnect_done(where, st);
          else if (!reconnect_on_budget_left()) return reconnect_give_up(where, RECONNECT_MAX_ONS + " attempts");
          if (alive) {
            var prevOn2 = reconnect_note_on();
            on = await set_wwan(cur, 1, 1);
            reconnect_on_answer(on, prevOn2);
          }
        }
      }
      if (!(on && on.success)) {
        S.reconnect_alive = alive;
        return false;
      }
    }
    for (var k = 0; k < 12; k++) {
      await sleep(2000);
      st = await get_wwan();
      if (wwan_up(st)) return reconnect_done(where, st);
      if (!st && !(await check_login())) { return true; }
    }
    toast("Mobile data is on — waiting for the connection…", "warn");
    reconnect_recheck_later();
    return true;
  }

  window.zte_wan_reconnect = async function () {
    if (!op_start("reconnect")) return;
    try {
      if (scan_left_running()) { toast(scan_running_msg("Reconnect"), "warn", 10000); return; }
      var pend = job_pending_msg("Reconnect");
      if (pend) { toast(pend, "warn", 10000); return; }
      var cur = await get_wwan();
      if (!cur || cur.connect_mode === undefined || cur.roam_enable === undefined) {
        toast("Could not read the mobile-data settings (zwrt_data get_wwaniface) — not touching anything.", "error");
        return;
      }
      if (!confirm("Reconnect mobile data?\n\nTurns mobile data OFF and back ON (not a reboot).\n" +
        "Connection returns in about 10–30 s. On some routers the web page logs you out while it does\n" +
        "this — if a password is saved the panel logs in again and finishes by itself.\n\n" +
        "Current: connect_status=" + (cur.connect_status || "?") + ", connect_mode=" + cur.connect_mode + ", roaming=" + cur.roam_enable))
        return;
      reconnect_mark(cur);
      reconnect_off_issued();
      var off = await set_wwan(cur, 0);
      if (!off.success && !command_answer_uncertain(off)) {
        reconnect_clear();
        toast(off.accessDenied ? denied_msg("mobile data on/off") : "Data OFF refused (" + (off.error || "?") + ")", "error");
        return;
      }
      if (off.success) {
        toast("Mobile data off — reconnecting…", "warn", 9000);
        await sleep((await model_check()) !== false ? RECONNECT_OFF_SETTLE_MS : CFG.reconnectOffWaitMs);
      } else {
        toast("No answer to data OFF — checking the actual mobile-data state before recovery…", "warn", 10000);
        var afterOff = await reconnect_read_past_hold("reconnect");
        if (wwan_up(afterOff)) {
          reconnect_clear();
          toast("Mobile data is still connected — reconnect cancelled safely.", "info");
          return;
        }
        if (!afterOff) {
          reconnect_recheck_later();
          toast("Cannot confirm mobile-data status yet. The panel will check again in 30 s.", "warn", 12000);
          return;
        }
      }
      var ready = await reconnect_check_before_on("reconnect (after OFF)");
      if (ready === "gone") {
        toast("The router ended the session while reconnecting.\n" + (saved_hash()
          ? "The panel logs in again and turns mobile data back on by itself."
          : "Log in again — the panel then turns mobile data back on."), "warn", 12000);
        return;
      }
      if (ready === "unknown") {
        reconnect_recheck_later();
        return;
      }
      if (ready) { reconnect_done("reconnect (after OFF)", ready); return; }
      if (await reconnect_turn_on(cur, "reconnect")) return;
      if (S.reconnect_alive) {
        toast("The router did not turn mobile data back on yet.\nThe panel tries again in 30 s.", "warn", 12000);
        reconnect_recheck_later();
      } else {
        toast("The router ended the session while reconnecting.\nThe panel logs in again and turns mobile data back on by itself.", "warn", 12000);
      }
    } finally { op_end("reconnect"); }
  };

  async function reconnect_resume_if_pending() {
    var raw = null;
    try { raw = localStorage.getItem(LS.RECONNECT); } catch (e) { }
    var st = reconnect_get();
    if (!st) {
      if (raw) { toast("The mobile-data reconnect did not finish within 10 minutes.\nCheck mobile data in the router's own page.", "warn", 12000); }
      return;
    }
    if (S.op) { reconnect_recheck_later(); return; }
    if (st.scanUntil && Date.now() < st.scanUntil) {
      reconnect_recheck_later(st.scanUntil - Date.now() + 1000);
      return;
    }
    var live = await reconnect_read_past_hold("resume");
    if (wwan_up(live)) {
      reconnect_clear();
      if (!st.watch) toast("Mobile data is back — reconnect finished ✓", "ok");
      return;
    }
    if (!live) {
      if (await check_login()) { reconnect_recheck_later(); }
      return;
    }
    if (!op_start("reconnect", true)) { reconnect_recheck_later(); return; }
    try {
      if (wwan_coming_up(live) || (st.onAt && Date.now() - st.onAt < RECONNECT_ON_WINDOW)) {
        toast("Mobile data is coming back — waiting for it…", "info", 7000);
        var up = await reconnect_wait_pending_on("resume", live);
        if (up === "gone") { return; }
        if (up) { reconnect_clear(); toast("Mobile data is back — reconnect finished ✓", "ok"); return; }
        live = await get_wwan();
      }
      if (wwan_up(live)) { reconnect_clear(); toast("Mobile data is back — reconnect finished ✓", "ok"); return; }
      if (!live) {
        if (await check_login()) { reconnect_recheck_later(); return; }
        return;
      }
      if (wwan_connecting(live)) { reconnect_recheck_later(); return; }
      st = reconnect_get() || st;
      if (!reconnect_on_budget_left()) { reconnect_give_up("resume", RECONNECT_MAX_ONS + " attempts"); return; }
      if ((st.tries || 0) >= RECONNECT_MAX_TRIES) { reconnect_clear(); toast("Could not finish the reconnect — turn mobile data on in the router's own page.", "warn", 10000); return; }
      st.tries = (st.tries || 0) + 1; reconnect_save(st);
      var cur = {
        connect_mode: live && live.connect_mode !== undefined ? live.connect_mode : st.connect_mode,
        roam_enable: live && live.roam_enable !== undefined ? live.roam_enable : st.roam_enable,
      };
      toast("Finishing the mobile-data reconnect — turning data back on…", "info", 7000);
      var ok = await reconnect_turn_on(cur, "resume");
      if (!ok && S.reconnect_alive) {
        toast("The router did not turn mobile data back on yet.\nThe panel tries again in 30 s.", "warn", 9000);
        reconnect_recheck_later();
      }
    } catch (e) {
    } finally {
      op_end("reconnect");
    }
  }

  window.zte_reset_band_cell = async function () {
    if (radio_busy("Band & cell reset")) return;
    if (!confirm("Reset ALL band and cell locks to the firmware defaults?\n\n" +
      "Uses nwinfo_reset_band_cell_setting (the router's own 'unlock all').\n" + APPLY_HINT.trim()))
      return;
    if (!op_start("cell_lock")) return;
    try {
      var slow = await model_check();
      await load_band_caps();
      await run_action("Band & cell lock reset", function () {
        return ubusRetry({ service: "zte_nwinfo_api", method: "nwinfo_reset_band_cell_setting" });
      }, function () {
        return read_back(fresh_netinfo, locks_at_defaults, slow !== false ? 45000 : 8000);
      }, { ok: "Band & cell locks reset ✓ (router defaults).", note: slow ? "" : APPLY_HINT });
    } finally { op_end("cell_lock"); }
  };
  function locks_at_defaults(d) {
    var l = d.lock_lte_cell;
    if (l && l !== "0,0") return false;
    if (!nr_cell_unlocked(d.lock_nr_cell)) return false;
    if (lte_from_router() && d.lte_band_lock !== undefined) {
      var lb = lte_bands_from_mask(d.lte_band_lock) || [];
      if (!lte_avail_in_mask().every(function (b) { return lb.indexOf(Number(b)) > -1; })) return false;
    }
    if (nr_from_router()) {
      var f = nr_lock_fields(d);
      if (f.nr5g_sa_band_lock !== undefined && nr_locked_list(f.nr5g_sa_band_lock, "sa") !== null) return false;
      if (f.nr5g_nsa_band_lock !== undefined && nr_locked_list(f.nr5g_nsa_band_lock, "nsa") !== null) return false;
    }
    return true;
  }

  function pick(o, names) {
    var keys = Object.keys(o || {});
    for (var i = 0; i < names.length; i++) {
      for (var k = 0; k < keys.length; k++) if (keys[k].toLowerCase() === names[i]) return o[keys[k]];
    }
    for (i = 0; i < names.length; i++) {
      for (k = 0; k < keys.length; k++) if (keys[k].toLowerCase().indexOf(names[i]) > -1) return o[keys[k]];
    }
    return undefined;
  }
  function parse_nbr_text(raw, type) {
    var p = String(raw).split(",").map(function (x) { return x.trim(); });
    var o = { raw: String(raw) };
    function isInt(v) { return /^\d+$/.test(v || ""); }
    var bi = -1;
    p.forEach(function (t, i) { if (bi < 0 && /^[bn]\d+$/i.test(t)) bi = i; });
    if (bi >= 2 && isInt(p[bi - 2]) && isInt(p[bi - 1])) {
      o.pci = p[bi - 2]; o.earfcn = p[bi - 1]; o.band = p[bi];
      o.rsrp = p[bi + 1]; o.rsrq = p[bi + 2]; o.sinr = p[bi + 3];
    } else if (bi < 0 && p.length >= 3 && isInt(p[0]) && isInt(p[1])) {
      o.pci = p[0]; o.earfcn = p[1]; o.rsrp = p[2]; o.rsrq = p[3]; o.sinr = p[4];
      var cv = type === "NR" ? nr_arfcn_to_mhz(+p[1]) : lte_earfcn_to_mhz(+p[1]);
      if (cv) {
        var pre = type === "NR" ? "n" : "B";
        if (cv.band != null) o.band = pre + cv.band;
        else if (cv.bands && cv.bands.length) o.band = cv.bands.map(function (b) { return pre + b; }).join("/");
      }
    }
    return o;
  }

  function nbr_rows(data, type) {
    if (!data) return [];
    function split(s) { return s.split(";").map(function (e) { return e.trim(); }).filter(Boolean); }
    var arr = typeof data === "string" ? split(data) : Array.isArray(data) ? data : data.cells || data.list || null;
    if (!arr) {
      Object.keys(data).some(function (k) {
        var v = data[k];
        if (Array.isArray(v)) { arr = v; return true; }
        if (typeof v === "string" && v.indexOf(",") > -1) { arr = split(v); return true; }
        return false;
      });
    }
    if (!arr) {
      var one = pick(data, ["pci"]);
      arr = one !== undefined && one !== "" ? [data] : [];
    }
    return arr.map(function (x) {
      var o = typeof x === "string" ? parse_nbr_text(x, type) : x && typeof x === "object" ? x : { raw: String(x) };
      return {
        type: type,
        obj: o,
        pci: pick(o, ["pci"]),
        earfcn: pick(o, ["earfcn", "arfcn", "channel"]),
        band: pick(o, ["band"]),
        rsrp: pick(o, ["rsrp"]),
        rsrq: pick(o, ["rsrq"]),
        sinr: pick(o, ["sinr", "snr"]),
      };
    }).filter(function (c) {
      if (c.pci !== undefined && c.pci !== "") return true;
      if (c.obj.raw) return true;
      return Object.keys(c.obj).some(function (k) { return c.obj[k] !== "" && c.obj[k] !== null && typeof c.obj[k] !== "object"; });
    });
  }

  function render_nbr(status) {
    zset("zte_scan_status", status);
    var rows = S.nbr || [];
    var tb = zel("zte_scan_tbody");
    if (!tb) return;
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#78909C;padding:10px;">No cells reported yet…</td></tr>';
      return;
    }
    tb.innerHTML = rows.map(function (c, i) {
      if (c.obj && c.obj.raw !== undefined && c.pci === undefined)
        return '<tr><td>' + esc(c.type) + '</td><td colspan="7" style="word-break:break-all;">' + esc(c.obj.raw) + "</td></tr>";
      var canLock = !isNaN(parseInt(c.pci, 10)) && !isNaN(parseInt(c.earfcn, 10));
      return '<tr title="' + esc(c.obj.raw !== undefined ? c.obj.raw : JSON.stringify(c.obj)) + '">' +
        "<td>" + esc(c.type) + "</td>" +
        "<td>" + esc(dash(c.band)) + "</td>" +
        '<td style="color:' + rsrp_color(c.rsrp) + ';font-weight:700;">' + esc(dash(c.rsrp)) + "</td>" +
        "<td>" + esc(dash(c.rsrq)) + "</td>" +
        "<td>" + esc(dash(c.sinr)) + "</td>" +
        "<td>" + esc(dash(c.pci)) + "</td>" +
        '<td style="color:#1976D2;">' + esc(dash(c.earfcn)) + "</td>" +
        "<td>" + (canLock ? '<button class="zte_btn" style="padding:2px 7px;font-size:10px;" onclick="window.zte_force_lock(' + i + ')">🔒 Lock</button>' : "") + "</td>" +
        "</tr>";
    }).join("");
  }

  var SCAN_MIN_MS = 30000, SCAN_MAX_MS = 60000;
  function scan_left_running() {
    var st = reconnect_get();
    return st && st.scanUntil && st.scanUntil > Date.now() ? Math.ceil((st.scanUntil - Date.now()) / 1000) : 0;
  }
  var OP_NAMES = { scan: "the neighbor scan", reconnect: "the mobile-data reconnect", glock: "the guided LTE lock", lte_band: "the LTE band change", cell_lock: "the cell lock change",
    net_mode: "the network mode change", nr_band: "the 5G band change", nr_cell: "the 5G cell lock", probe: "the 5G NSA probe" };
  function radio_busy(what) {
    var busy = S.op ? OP_NAMES[S.op] || S.op : glock_get() ? OP_NAMES.glock : "";
    if (busy) { toast(what + ": " + busy + " is still running — try again when it has finished.", "warn", 8000); return true; }
    if (scan_left_running()) { toast(scan_running_msg(what), "warn", 10000); return true; }
    return false;
  }
  function scan_running_msg(what) {
    return what + ": a neighbor scan may still be running in the router (about " + scan_left_running() + " s left).\nMobile data is turned back on after it — try again then.";
  }
  var SCAN_RESULTS_MAX_AGE = 600000;
  var SCAN_LAST_MAX_AGE = 900000;
  function scan_take_results(raw, at) {
    S.nbr_raw = raw;
    S.nbr = nbr_rows(raw.lte, "LTE").concat(nbr_rows(raw.nr, "NR"))
      .sort(function (a, b) { return (num(b.rsrp) || -999) - (num(a.rsrp) || -999); });
    if (S.nbr.length) { try { localStorage.setItem(LS.SCAN_LAST, JSON.stringify({ at: at, raw: raw })); } catch (e) { } }
    var nl = S.nbr.filter(function (c) { return c.type === "LTE"; }).length;
    return S.nbr.length + " cell(s): " + nl + " LTE, " + (S.nbr.length - nl) + " 5G";
  }
  function scan_last_restore() {
    if (S.op === "scan" || (S.nbr && S.nbr.length)) return;
    var st = lsGetJson(LS.SCAN_LAST, SCAN_LAST_MAX_AGE, "at");
    if (!st || !st.raw) return;
    var what = scan_take_results(st.raw, st.at);
    ztoggle("zte_scan_panel", true);
    render_nbr("Scan results from " + new Date(st.at).toLocaleTimeString() + " — " + what);
  }
  function scan_results_is_current(st) {
    if (S.op === "scan") return false;
    var cur = lsGetJson(LS.SCAN_RESULTS, SCAN_RESULTS_MAX_AGE, "at");
    return !!cur && cur.at === st.at;
  }
  async function scan_results_resume() {
    var st = lsGetJson(LS.SCAN_RESULTS, SCAN_RESULTS_MAX_AGE, "at");
    if (!st || S.op === "scan" || S.scan_results_busy) return;
    var wait = (st.until || 0) - Date.now();
    if (wait > 0) { setTimeout(scan_results_resume, wait + 500); return; }
    S.scan_results_busy = true;
    try {
      var res = await ubusRetry([
        { service: "zte_nwinfo_api", method: "nwinfo_get_lte_nbr_contents" },
        { service: "zte_nwinfo_api", method: "nwinfo_get_nr5g_nbr_contents" },
      ], { quiet: true });
      if (!scan_results_is_current(st)) { return; }
      if (!res[0].success && !res[1].success) {
        if (!(await check_login())) return;
        if (!scan_results_is_current(st)) return;
        if ((st.retries || 0) < 1) {
          st.retries = (st.retries || 0) + 1;
          try { localStorage.setItem(LS.SCAN_RESULTS, JSON.stringify(st)); } catch (e) { }
          setTimeout(scan_results_resume, 30000);
          return;
        }
        try { localStorage.removeItem(LS.SCAN_RESULTS); } catch (e) { }
        return;
      }
      try { localStorage.removeItem(LS.SCAN_RESULTS); } catch (e) { }
      var what = scan_take_results({ lte: res[0].data, nr: res[1].data }, st.at);
      var when = new Date(st.at).toLocaleTimeString();
      var msg = S.nbr.length
        ? "Scan results from " + when + " — " + what
        : "The router returned no neighbor cells for the scan at " + when + ".";
      ztoggle("zte_scan_panel", true);
      render_nbr(msg);
      toast(msg, S.nbr.length ? "ok" : "warn", 10000);
    } catch (e) {
      dlog("scan results: unexpected error", e && e.message);
    } finally { S.scan_results_busy = false; }
  }

  async function restore_data_after_scan(before, marked, scanStart) {
    if (!marked) {
      toast("Mobile data was already off before the scan — left as it was.\nPress 🔀 Reconnect data to turn it on.", "info");
      return;
    }
    var left = scanStart + SCAN_MIN_MS - Date.now();
    if (left > 0) { await sleep(left); }
    if (!(await check_login())) {
      toast("The router ended the session during the scan.\n" + (saved_hash()
        ? "The panel logs in again and turns mobile data back on by itself."
        : "Log in again — the panel then turns mobile data back on."), "warn", 12000);
      return;
    }
    var ready = await reconnect_check_before_on("scan");
    if (ready === "gone") {
      return;
    }
    if (ready === "unknown") {
      reconnect_recheck_later();
      toast("Mobile-data status is temporarily unavailable — checking again in 30 s.", "warn", 9000);
      return;
    }
    if (ready) { reconnect_done("scan", ready, "Mobile data is on ✓ (" + ready.connect_status + ")"); return; }
    if (await reconnect_turn_on(before, "scan")) return;
    if (S.reconnect_alive) {
      toast("The router did not turn mobile data back on yet.\nThe panel tries again in 30 s.", "warn", 12000);
      reconnect_recheck_later();
    } else {
      toast("The router ended the session after the scan.\nThe panel logs in again and turns mobile data back on by itself.", "warn", 12000);
    }
  }

  function job_pending_msg(what) {
    if (glock_get()) return what + ": " + OP_NAMES.glock + " has not finished yet — try again when it has.";
    if (reconnect_get()) return what + ": " + OP_NAMES.reconnect + " has not finished yet (the panel is still turning mobile data back on) — try again in a moment.";
    return "";
  }

  window.zte_nbr_scan = async function () {
    if (S.op === "scan") { toast("Scan already running…", "warn"); return; }
    if (!S.op && scan_left_running()) { toast(scan_running_msg("Scan"), "warn", 10000); return; }
    var pend = job_pending_msg("Scan");
    if (pend) { toast(pend, "warn", 10000); return; }
    if (!confirm("Neighbor cell scan\n\nUses the router's built-in scan.\n" +
      "⚠️ Mobile data is disconnected while it scans (about 30 s). The panel turns it back on afterwards.\n\nContinue?"))
      return;
    pend = job_pending_msg("Scan");
    if (pend) { toast(pend, "warn", 10000); return; }
    if (!op_start("scan")) return;
    S.nbr = [];
    S.nbr_raw = null;
    try { localStorage.removeItem(LS.SCAN_LAST); } catch (e) { }
    ztoggle("zte_scan_panel", true);
    render_nbr("Starting scan…");
    var before = null, started = false, marked = false, summary = "", scanStart = 0, markAt = 0;
    try {
      before = await get_wwan();
      if (!before || before.connect_mode === undefined || before.roam_enable === undefined) {
        render_nbr("Could not read the mobile-data state — scan not started. Try again in a moment.");
        toast("Could not read the mobile-data state, so the scan was not started\n(it switches mobile data off). Try again in a moment.", "warn", 9000);
        return;
      }
      marked = wwan_up(before) || String(before.enable) === "1";
      scanStart = Date.now();
      if (marked) {
        if (reconnect_get()) {
          marked = false;
          render_nbr("A mobile-data reconnect is still being finished — scan not started.");
          toast(job_pending_msg("Scan"), "warn", 10000);
          return;
        }
        reconnect_mark(before);
        var mk = reconnect_get();
        if (mk) { mk.scanUntil = scanStart + SCAN_MAX_MS; reconnect_save(mk); }
        markAt = mk ? mk.at : 0;
      }
      var r = await ubusRetry({ service: "zte_nwinfo_api", method: "nwinfo_scan_nbr" });
      if (!r.success && !command_answer_uncertain(r)) {
        render_nbr(r.accessDenied ? "Scan refused by the router (web login)" : "Scan refused: " + (r.error || "?"));
        return;
      }
      started = true;
      scanStart = Date.now();
      try { localStorage.setItem(LS.SCAN_RESULTS, JSON.stringify({ at: scanStart, until: scanStart + SCAN_MAX_MS })); } catch (e) { }
      if (marked) {
        mk = reconnect_get();
        if (mk) { mk.scanUntil = scanStart + SCAN_MAX_MS; reconnect_save(mk); }
      }
      if (!r.success) {
        toast("Scan start was not confirmed. Checking for results and restoring mobile data if needed…", "warn", 11000);
      }
      render_nbr(r.success ? "Scanning… (mobile data is off during the scan)" : "Scan start uncertain — monitoring and restoring mobile data…");
      await sleep(CFG.scanSettleMs);
      var last = "", stable = 0, loggedOut = false;
      for (var i = 1; i <= 9; i++) {
        var res = await ubusRetry([
          { service: "zte_nwinfo_api", method: "nwinfo_get_lte_nbr_contents" },
          { service: "zte_nwinfo_api", method: "nwinfo_get_nr5g_nbr_contents" },
        ], { quiet: true });
        if (res[0].accessDenied && res[1].accessDenied && !(await check_login())) {
          loggedOut = true;
          break;
        } else if (res[0].success || res[1].success) {
          S.nbr_raw = { lte: res[0].data, nr: res[1].data };
          S.nbr = nbr_rows(res[0].data, "LTE").concat(nbr_rows(res[1].data, "NR"))
            .sort(function (a, b) { return (num(b.rsrp) || -999) - (num(a.rsrp) || -999); });
          var sig = JSON.stringify(S.nbr_raw);
          stable = S.nbr.length && sig === last ? stable + 1 : 0;
          last = sig;
        }
        render_nbr("Scanning… " + S.nbr.length + " cell(s) so far");
        if (stable >= 3 && Date.now() - scanStart >= SCAN_MIN_MS) break;
        await sleep(CFG.scanPollMs);
      }
      var nl = S.nbr.filter(function (c) { return c.type === "LTE"; }).length;
      summary = loggedOut
        ? "The router logged you out during the scan. After the login the panel turns mobile data back on and shows the scan results."
        : "Scan complete — " + S.nbr.length + " cell(s): " + nl + " LTE, " + (S.nbr.length - nl) + " 5G";
      render_nbr(summary + (loggedOut ? "" : " · restoring mobile data…"));
      if (!loggedOut && S.nbr.length) {
        try { localStorage.removeItem(LS.SCAN_RESULTS); } catch (e) { }
        scan_take_results(S.nbr_raw, scanStart);
      }
      if (!loggedOut) toast("Scan complete: " + nl + " LTE, " + (S.nbr.length - nl) + " 5G", S.nbr.length ? "ok" : "warn");
    } catch (e) {
      summary = "Scan error: " + e.message;
      render_nbr(summary);
    } finally {
      if (started) {
        try { await restore_data_after_scan(before, marked, scanStart); } catch (e) { }
        render_nbr(summary);
      } else if (marked) {
        var cur = reconnect_get();
        if (cur && cur.at === markAt) reconnect_clear();
      }
      op_end("scan");
      if (started) scan_results_resume();
    }
  };

  window.zte_force_lock = async function (i) {
    var c = (S.nbr || [])[i];
    if (!c) return;
    var pci = parseInt(c.pci, 10), ch = parseInt(c.earfcn, 10);
    if (c.type === "LTE") {
      await window.zte_guided_lte_lock(pci, ch);
    } else {
      if (radio_busy("5G cell lock")) return;
      var conv = nr_arfcn_to_mhz(ch);
      var band = strip_n(c.band);
      if (!/^\d+$/.test(band)) band = conv && conv.band != null ? String(conv.band) : "";
      band = prompt("Lock 5G cell PCI " + pci + ", ARFCN " + ch + "\n\nConfirm the band number" +
        (conv && conv.bands.length > 1 ? " (this channel can be n" + conv.bands.join(" or n") + ")" : "") + ":\n" +
        "⚠️ If this cell belongs to another operator the router will have no service until you unlock.", band);
      if (!band) return;
      var chk = check_nr_cell(pci, ch, band);
      if (chk.error) { toast("5G cell lock: " + chk.error, "error", 9000); return; }
      await nr_cell_apply(chk.pci, chk.arfcn, chk.band);
    }
  };

  function dnsf(d, k) {
    if (!d) return undefined;
    return d[k] !== undefined ? d[k] : d["wan_" + k];
  }
  function dns6(d, which) {
    if (!d) return undefined;
    var a = d["ipv6_" + which + "_dns_manual"];
    return a !== undefined ? a : d["ipv6_wan_" + which + "_dns_manual"];
  }
  function norm6(s) {
    s = String(s || "").trim().toLowerCase();
    if (!/^[0-9a-f:.]+$/.test(s) || s.indexOf(":") < 0) return null;
    var v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) {
      var o = v4[1].split(".").map(Number);
      if (o.some(function (x) { return x > 255; })) return null;
      s = s.slice(0, -v4[1].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
    }
    var parts = s.split("::");
    if (parts.length > 2) return null;
    var head = parts[0] ? parts[0].split(":") : [], tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
    var fill = 8 - head.length - tail.length;
    if (parts.length === 2 ? fill < 1 : fill !== 0) return null;
    var g = head.concat(new Array(parts.length === 2 ? fill : 0).fill("0"), tail);
    if (g.length !== 8 || g.some(function (x) { return !/^[0-9a-f]{1,4}$/.test(x); })) return null;
    return g.map(function (x) { return parseInt(x, 16).toString(16); }).join(":");
  }
  async function get_dns() {
    var r = await ubusRetry([
      { service: "zwrt_router.api", method: "router_get_dns_para" },
      { service: "uci", method: "get", params: { config: "zwrt_router", section: "dns" } },
    ], { quiet: true });
    var d = r[0].success ? r[0].data || {} : null;
    S.dns_para_missing = !r[0].success && r[0].code === 3;
    var u = r[1].success && r[1].data ? r[1].data.values || r[1].data : null;
    if (!d && !u) return null;
    d = d || {};
    if (u) {
      var map = { dns_mode: "wan_dns_mode", prefer_dns_manual: "wan_prefer_dns_manual", standby_dns_manual: "wan_standby_dns_manual",
        ipv6_prefer_dns_manual: "ipv6_wan_prefer_dns_manual", ipv6_standby_dns_manual: "ipv6_wan_standby_dns_manual" };
      Object.keys(map).forEach(function (k) {
        var have = /^ipv6_/.test(k) ? dns6(d, k.split("_")[1]) : dnsf(d, k);
        if (have === undefined && u[map[k]] !== undefined) d[k] = u[map[k]];
      });
    }
    return d;
  }
  async function set_dns(mode, p1, p2, v6a, v6b) {
    if (S.dns_busy) return { ok: false, msg: "The previous DNS change is still running — try again in a moment." };
    S.dns_busy = true;
    try { return await set_dns_once(mode, p1, p2, v6a, v6b); } finally { S.dns_busy = false; }
  }
  async function set_dns_once(mode, p1, p2, v6a, v6b) {
    var slowDns = mode === "manual" && (await mtk_check()) === true;
    if (slowDns) {
      var keep = (v6a === undefined || v6a === null || v6b === undefined || v6b === null) ? await get_dns() : null;
      if (v6a === undefined || v6a === null) v6a = (keep && dns6(keep, "prefer")) || "";
      if (v6b === undefined || v6b === null) v6b = (keep && dns6(keep, "standby")) || "";
    }
    var plain = { dns_mode: mode, prefer_dns_manual: p1 || "", standby_dns_manual: p2 || "" };
    var prefixed = { wan_dns_mode: mode, wan_prefer_dns_manual: p1 || "", wan_standby_dns_manual: p2 || "" };
    function given(v) { return v !== undefined && v !== null; }
    if (mode === "manual") {
      if (given(v6a) && !(slowDns && v6a === "")) { plain.ipv6_prefer_dns_manual = v6a; prefixed.ipv6_wan_prefer_dns_manual = v6a; }
      if (given(v6b) && !(slowDns && v6b === "")) { plain.ipv6_standby_dns_manual = v6b; prefixed.ipv6_wan_standby_dns_manual = v6b; }
    }
    function v6match(want, have) {
      if (!given(want)) return true;
      if (want === "") return !have;
      return norm6(have) === norm6(want);
    }
    function applied(d) {
      if (!d || dnsf(d, "dns_mode") !== mode) return null;
      if (mode !== "manual") return "DNS set to automatic (operator)";
      if (dnsf(d, "prefer_dns_manual") !== p1 || (dnsf(d, "standby_dns_manual") || "") !== (p2 || "")) return null;
      var v6read = dns6(d, "prefer") !== undefined || dns6(d, "standby") !== undefined;
      var v6sent = given(v6a) || given(v6b);
      if (v6sent && v6read && !(v6match(v6a, dns6(d, "prefer")) && v6match(v6b, dns6(d, "standby")))) return null;
      var msg = "DNS set to " + p1 + (p2 ? ", " + p2 : "");
      if (v6sent) {
        var parts6 = [];
        if (v6a) parts6.push(v6a);
        if (v6b) parts6.push(v6b);
        var cleared = (v6a === "" ? 1 : 0) + (v6b === "" ? 1 : 0);
        msg += " · IPv6 " + (parts6.length ? parts6.join(", ") : "") +
          (cleared ? (parts6.length ? ", " : "") + (cleared === 2 ? "cleared" : (v6a === "" ? "primary" : "secondary") + " cleared") : "") +
          (v6read ? "" : " (sent; this router does not report IPv6 DNS back)");
      }
      return msg;
    }
    var tries = [plain, prefixed];
    for (var i = 0; i < tries.length; i++) {
      var r = await ubusRetry({ service: "zwrt_router.api", method: "router_set_wan_dns", params: tries[i] });
      if (r.accessDenied) return { ok: false, msg: denied_msg("DNS changes") };
      var lost = !r.success && command_answer_uncertain(r);
      var msg = null;
      for (var k = 0; k < (lost ? 4 : 1) && !msg; k++) {
        await sleep(k ? 1500 : 1200);
        msg = applied(await get_dns());
      }
      if (msg) return { ok: true, msg: msg };
      if (lost) return { ok: false, msg: "DNS change sent, but the router did not answer and does not show it yet — check the DNS settings in a moment.", unknown: true };
    }
    return { ok: false, msg: "The router did not apply the DNS change." };
  }

  window.zte_dns = async function () {
    var d = await get_dns();
    if (!d) { toast("Could not read DNS settings (router_get_dns_para)", "error"); return; }
    var w = S.wan || {}, inUse = {};
    var v4 = [w.mwan_wanlan1_prefer_dns_auto, w.mwan_wanlan1_standby_dns_auto].filter(Boolean);
    var v6 = [w.mwan_wanlan1_ipv6_prefer_dns_auto, w.mwan_wanlan1_ipv6_standby_dns_auto].filter(Boolean);
    if (v4.length) inUse["IPv4 DNS"] = v4.join(", ");
    if (v6.length) inUse["IPv6 DNS"] = v6.join(", ");
    var notes = [];
    if (S.dns_para_missing)
      notes.push("This router reports only the DNS mode (no router_get_dns_para); manual servers are shown once they are set.");
    var ov = show_modal(
      "DNS",
      info_table("Current DNS settings", d, { rawKeys: true }) +
        (Object.keys(inUse).length ? info_table("DNS in use now (WAN)", inUse) : "") +
        notes.map(function (n) { return '<p style="font-size:11px;color:#78909C;margin:6px 0;">' + esc(n) + "</p>"; }).join("") +
        '<div class="zte_btn_grid">' +
        '<button class="zte_btn ok" id="zte_dns_manual">✏ Set manual DNS…</button>' +
        '<button class="zte_btn" id="zte_dns_auto">↺ Use operator DNS (auto)</button>' +
        "</div>",
    );
    ov.querySelector("#zte_dns_manual").onclick = async function () {
      var def = [dnsf(d, "prefer_dns_manual"), dnsf(d, "standby_dns_manual")].filter(Boolean).join(",") || "1.1.1.1,8.8.8.8";
      var inp = prompt("Manual DNS — primary,secondary (IPv4):", def);
      if (!inp) return;
      var p = inp.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      var ipRe = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
      if (!p.length || p.length > 2 || !p.every(function (x) { return ipRe.test(x); })) { toast("Invalid IPv4 address(es)", "error"); return; }
      var def6 = [dns6(d, "prefer"), dns6(d, "standby")].filter(Boolean).join(",");
      var inp6 = prompt("IPv6 DNS (optional) — primary,secondary\ne.g. 2606:4700:4700::1111,2001:4860:4860::8888\n" +
        "Keep the values shown to keep them. Empty or - = no IPv6 DNS; - clears one slot (e.g. 2606:4700:4700::1111,- ).", def6);
      if (inp6 === null) return;
      var q = inp6.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      if (q.length > 2 || !q.every(function (x) { return x === "-" || norm6(x) !== null; })) { toast("Invalid IPv6 address(es)", "error"); return; }
      if (!q.length || (q.length === 1 && q[0] === "-")) q = ["-", "-"];
      else if (q.length === 1) q.push("-");
      q = q.map(function (x) { return x === "-" ? "" : x; });
      ov.remove();
      var res = await set_dns("manual", p[0], p[1], q[0], q[1]);
      toast(res.msg, res.ok ? "ok" : res.unknown ? "warn" : "error", res.ok ? 7000 : undefined);
    };
    ov.querySelector("#zte_dns_auto").onclick = async function () {
      ov.remove();
      var res = await set_dns("auto", "", "");
      toast(res.msg, res.ok ? "ok" : res.unknown ? "warn" : "error");
    };
  };

  var OP_MODES = { PPP: "Router (normal)", LTE_BRIDGE: "Bridge" };

  window.zte_bridge_mode = async function (enable) {
    var target = enable ? "LTE_BRIDGE" : "PPP";
    var cur = S.wan.opms_wan_mode;
    if (cur === target) { toast("Already in " + OP_MODES[target] + " mode.", "info"); return; }
    var msg = enable
      ? "Switch to BRIDGE mode?\n\n• The router stops routing: the device on the LAN/Ethernet port gets the mobile IP directly.\n" +
        "• Wi-Fi and other devices may lose internet.\n• The router may restart and its page may only be reachable from that device.\n\n" +
        "Switch back with 'Router mode' here or in the router's own page."
      : "Switch back to normal ROUTER mode?\n\nThe router may restart.";
    if (S.bridge_busy) { toast("The previous mode change is still running.", "warn"); return; }
    if (radio_busy(enable ? "Bridge mode" : "Router mode")) return;
    if (!confirm(msg)) return;
    if (S.bridge_busy) return;
    S.bridge_busy = true;
    try { await bridge_apply(target); } finally { S.bridge_busy = false; }
  };
  async function bridge_apply(target) {
    stamp(sessionStorage, UB_REBOOT_KEY);
    var r = await ubusRetry({ service: "zwrt_router.api", method: "router_set_wan_mode", params: { opms_wan_mode: target } });
    if (!r.success && command_answer_uncertain(r)) {
      toast("No answer from the router — it is probably restarting into " + OP_MODES[target] + " mode.\nThis can take a minute; check the mode once the page answers again.", "warn", 12000);
    } else if (!r.success) {
      try { sessionStorage.removeItem(UB_REBOOT_KEY); } catch (e) { }
      toast("Mode change failed (" + (r.error || "?") + ")", "error");
      return;
    } else {
      toast("Switching to " + OP_MODES[target] + " mode… this can take a minute (the router may restart).", "warn");
    }
    await sleep(5000);
    try { await poll_once(); } catch (e) { }
    if (S.wan.opms_wan_mode === target) toast(OP_MODES[target] + " mode active ✓", "ok");
  }

  async function update_arp_state() {
    var state = null;
    try {
      var r = await ubus({ service: "uci", method: "get", params: { config: "zwrt_router", section: "network" } }, { quiet: true });
      var v = r.success && r.data && r.data.values;
      if (v) {
        var raw = v.arp_proxy_enable !== undefined ? v.arp_proxy_enable : v.network && v.network.arp_proxy_enable;
        state = raw === undefined ? "off (never set)" : String(raw) === "1" ? "on" : "off";
      }
    } catch (e) { }
    zset("zte_arp_state", state || "—");
    return state;
  }

  window.zte_arp_proxy = async function (enable) {
    var word = enable ? "ON" : "OFF";
    if (!confirm("Switch ARP proxy " + word + "?\n\n• It needs a developer session: the panel asks for the router password if none is saved.\n" +
      "• If nothing changes on your network afterwards, reboot the router.")) return;
    var call = { service: "zwrt_router.api", method: "router_set_arp_proxy", params: { arp_proxy_enable: enable ? 1 : 0 } };
    var r;
    try {
      r = await ubus(call, { quiet: true });
      if (r.accessDenied) {
        var h = saved_hash() || (await ask_pw_hash());
        if (!h) return;
        if (!(await developer_option_login(h))) { toast("Developer login failed — ARP proxy not changed.", "error"); return; }
        r = await ubus(call);
      }
    } catch (e) {
      toast("ARP proxy: the developer login did not go through (" + e.message + ") — nothing was changed.", "error");
      return;
    }
    var lost = !r.success && !r.accessDenied && command_answer_uncertain(r);
    if (!r.success && !lost) {
      toast(r.accessDenied ? "The router refused the ARP proxy call, even in a developer session." : "ARP proxy change failed (" + (r.error || "?") + ")", "error");
      return;
    }
    await sleep(1000);
    var now = await update_arp_state();
    if (now === (enable ? "on" : "off")) toast("ARP proxy is " + word + " ✓\nIf nothing changes on your network, reboot the router.", "ok", 8000);
    else toast((lost ? "No answer from the router, and the setting reads “" : "The router accepted the call, but the setting reads “") + (now || "unknown") + "”.", "warn", 8000);
  };

  var GPS_CALL = { service: "zwrt_gnss", method: "get_location_info", params: {} };
  var GPS_UCI = { service: "uci", method: "get", params: { config: "zwrt_zte_topsw_gnss_gen", section: "INFO" } };

  function gps_num(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim();
    return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : null;
  }
  function gps_empty(v) {
    return v === null || v === undefined || String(v).trim() === "";
  }
  function gps_ok(lat, lon) {
    var la = gps_num(lat), lo = gps_num(lon);
    return la !== null && lo !== null && !(la === 0 && lo === 0);
  }

  function router_service() {
    try {
      var rq = window.requirejs || window.require;
      var defs = rq && rq.s && rq.s.contexts && rq.s.contexts._ && rq.s.contexts._.defined;
      if (!defs) return null;
      for (var k in defs) {
        if (defs[k] && typeof defs[k].getDeviceInfo === "function") return defs[k];
      }
    } catch (e) { }
    return null;
  }
  function router_device_info() {
    return new Promise(function (resolve) {
      var svc = router_service();
      if (!svc) return resolve(null);
      var done = false;
      function fin(v) { if (!done) { done = true; clearTimeout(t); resolve(v || null); } }
      var t = setTimeout(function () { fin(null); }, 8000);
      try { svc.getDeviceInfo({}, fin, function () { fin(null); }); } catch (e) { fin(null); }
    });
  }

  async function gps_alt_position() {
    var has_record = false;
    try {
      var v = uci_values(await ubusRetry(GPS_UCI, { quiet: true }));
      if (v && (v.LAT !== undefined || v.LON !== undefined)) {
        has_record = true;
        if (gps_ok(v.LAT, v.LON)) return { lat: v.LAT, lon: v.LON, src: "uci zwrt_zte_topsw_gnss_gen" };
      }
    } catch (e) { }
    var info = await router_device_info();
    if (info && gps_ok(info.lat, info.lon)) return { lat: info.lat, lon: info.lon, src: "the router's own page" };
    return has_record ? { nofix: true } : null;
  }

  function render_gps(lat, lon, msg) {
    ztoggle("zte_dev_gps_wrap", true);
    if (msg && S.gps_last) {
      lat = S.gps_last.lat; lon = S.gps_last.lon;
      zhtml("zte_dev_gps", row("Now", "no position — showing the last known one") + gps_rows(lat, lon));
      return;
    }
    if (msg) { zhtml("zte_dev_gps", row("Position", msg)); return; }
    zhtml("zte_dev_gps", gps_rows(lat, lon));
  }
  function gps_rows(lat, lon) {
    return (
      row("Latitude", lat) + row("Longitude", lon) +
      '<div class="zte_row"><span class="zte_label">📍 Map</span><span class="zte_value">' +
      '<a href="https://www.google.com/maps?q=' + encodeURIComponent(lat + "," + lon) +
      '" target="_blank" rel="noopener noreferrer" style="color:#1976D2;">Open in Maps</a></span></div>'
    );
  }

  async function update_gps(manual) {
    if (S.gps_busy) return;
    S.gps_busy = true;
    function say(msg, type) { if (manual) toast(msg, type); }
    try {
      var r = await ubusRetry(GPS_CALL, { quiet: true });
      if (!r.success && !r.accessDenied && gps_service_absent(r.error)) {
        var alt = await gps_alt_position();
        if (alt && !alt.nofix) {
          S.gps = { state: "pos" };
          S.gps_last = { lat: String(alt.lat).trim(), lon: String(alt.lon).trim() };
          render_gps(S.gps_last.lat, S.gps_last.lon);
          say("GPS position updated ✓", "ok");
          return;
        }
        if (alt) {
          S.gps = { state: "nofix", err: "no coordinates stored" };
          render_gps(null, null, "no GPS fix right now");
          say("The router has no GPS position right now. Try again later.", "warn");
          return;
        }
      }
      if (!r.success) {
        var why = r.accessDenied ? "refused by the router" : "not available (" + (r.error || "?") + ")";
        S.gps = { state: "error", err: "get_location_info " + (r.accessDenied ? "refused" : (r.error || "?")) };
        render_gps(null, null, why);
        say("GPS " + why, "error");
        return;
      }
      var d = r.data || {};
      var lat = d.gnss_lat, lon = d.gnss_lon;
      var la = gps_num(lat), lo = gps_num(lon);
      if (la === null && !gps_empty(lat)) {
        var info = await router_device_info();
        if (info && gps_num(info.lat) !== null && gps_num(info.lon) !== null) {
          lat = info.lat; lon = info.lon; la = gps_num(lat); lo = gps_num(lon);
        } else {
          S.gps = { state: "encoded" };
          render_gps(null, null, "not readable on this router");
          say("This router returns the GPS position in a form the panel cannot read.", "warn");
          return;
        }
      }
      if (la === null || lo === null || (la === 0 && lo === 0)) {
        S.gps = { state: "nofix", err: "get_location_info: no coordinates" };
        render_gps(null, null, "no GPS fix right now");
        say("The router has no GPS fix right now — its own Device details page shows no position either. Try again later.", "warn");
        return;
      }
      S.gps = { state: "pos" };
      S.gps_last = { lat: String(lat).trim(), lon: String(lon).trim() };
      render_gps(S.gps_last.lat, S.gps_last.lon);
      say("GPS position updated ✓", "ok");
    } catch (e) {
      S.gps = { state: "error", err: "get_location_info: " + e.message };
      render_gps(null, null, "not available");
      say("GPS request failed: " + e.message, "error");
    } finally {
      S.gps_busy = false;
      render_gnss();
    }
  }
  window.zte_gps_refresh = function () { return update_gps(true); };

  var UCI_ANT = { service: "uci", method: "get", params: { config: "zte_nwinfo", section: "odu_as_mode" } };
  var UCI_ANT_EN = { service: "uci", method: "get", params: { config: "zte_nwinfo", section: "odu_as_enable" } };

  function uci_values(r) {
    var v = r && r.success && r.data && r.data.values;
    return v && typeof v === "object" ? v : null;
  }

  var ANT_BUILTIN = [
    { v: "auto", key: "ant_select_mode_auto", name: "Automatic switching" },
    { v: "front_directional", key: "ant_select_mode_front_directional", name: "Directional Antenna" },
    { v: "rear_directional", key: "ant_select_mode_rear_directional", name: "Directional Wide Beam Antenna" },
    { v: "omni", key: "ant_select_mode_rear_omni", name: "Omnidirectional Antenna" },
  ];
  var ANT_MODES = ANT_BUILTIN.slice();
  var ANT_SRC = { list: "built-in (MC7530)", names: "built-in" };

  function ant_pos(v) {
    var w = String(v || "").split("_")[0].toLowerCase();
    return { front: "Front", rear: "Rear", left: "Left", right: "Right", top: "Top", bottom: "Bottom", side: "Side" }[w] || "";
  }
  function ant_text(m) {
    var pos = ant_pos(m.v);
    return m.name + (pos && m.name.toLowerCase().indexOf(pos.toLowerCase()) < 0 ? " — " + pos : "");
  }
  function ant_label(v) {
    for (var i = 0; i < ANT_MODES.length; i++) if (ANT_MODES[i].v === v) return ant_text(ANT_MODES[i]);
    return v ? String(v) : "—";
  }

  function page_i18n(key) {
    try {
      var jq = window.$;
      if (jq && jq.i18n && typeof jq.i18n.prop === "function") {
        var t = jq.i18n.prop(key);
        if (t && t !== key && !/^\[.*\]$/.test(t)) return String(t);
      }
    } catch (e) { }
    return null;
  }
  function parse_properties(txt) {
    var out = {};
    String(txt || "").split(/\r?\n/).forEach(function (l) {
      var m = l.match(/^\s*([^#!=:\s][^=:]*?)\s*[=:]\s*(.*)$/);
      if (m) out[m[1]] = m[2].replace(/''/g, "'");
    });
    return out;
  }

  async function load_ant_ui() {
    var opts = [];
    try {
      var r = await fetch("/tmpl/auth/adm/developer_options.html", { cache: "no-store" });
      var html = r.ok ? await r.text() : "";
      var m = html.match(/<select[^>]*value:\s*as_mode[^>]*>([\s\S]*?)<\/select>/i);
      if (m) {
        (m[1].match(/<option\b[^>]*>/gi) || []).forEach(function (tag) {
          var v = (tag.match(/\bvalue\s*=\s*"([^"]*)"/i) || [])[1];
          var k = (tag.match(/\bdata-trans\s*=\s*"([^"]*)"/i) || [])[1] || "";
          if (v) opts.push({ v: v, key: k, name: "" });
        });
      }
    } catch (e) { }
    if (opts.length) { ANT_SRC.list = "router UI (developer_options)"; S.ant_has_ui = true; }
    else { opts = ANT_BUILTIN.map(function (x) { return { v: x.v, key: x.key, name: "" }; }); S.ant_has_ui = false; }

    var props = null, fromPage = 0, fromFile = 0;
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i], t = o.key ? page_i18n(o.key) : null;
      if (t) { o.name = t; fromPage++; continue; }
      if (props === null) props = (await router_props()) || {};
      if (o.key && props[o.key]) { o.name = props[o.key]; fromFile++; continue; }
      var b = ANT_BUILTIN.filter(function (x) { return x.v === o.v; })[0];
      o.name = b ? b.name : o.v;
    }
    ANT_SRC.names = fromPage ? "router translations" : fromFile ? "router language file" : "built-in";
    ANT_MODES = opts;
    fill_ant_select();
  }

  function fill_ant_select() {
    var sel = zel("zte_ant_sel");
    if (sel) {
      sel.innerHTML = ANT_MODES.map(function (m) {
        return '<option value="' + esc(m.v) + '" title="value sent: ' + esc(m.v) + '">' + esc(ant_text(m)) + "</option>";
      }).join("");
    }
    zset("zte_ant_src", "Options: " + ANT_SRC.list + " · names: " + ANT_SRC.names);
    render_antenna();
  }
  function ant_real_value(a) {
    return !!(a && a.as_mode && a.as_mode !== "null" && String(a.as_mode).trim() !== "");
  }
  function ant_supported() {
    return S.ant_has_ui === true || ant_real_value(S.ant);
  }

  function render_antenna() {
    if (ant_supported()) S.ant_supported = true;
    ztoggle("zte_ant_sec", S.ant_supported === true);
    if (S.ant_supported !== true) return;
    if (S.gf_ant_ui) return;
    var a = S.ant || {};
    var cur = a.as_mode || "";
    var sel = zel("zte_ant_sel");
    if (!S.ant && S.ant_err) {
      if (sel) sel.disabled = true;
      zhtml("zte_ant_cur", '<span style="color:#78909C;font-weight:400">not available on this router (uci zte_nwinfo / odu_as_mode: ' + esc(S.ant_err) + ")</span>");
      zset("zte_ant_sw", "—");
      return;
    }
    if (sel) sel.disabled = !!S.ant_busy;
    if (sel && !S.ant_busy && document.activeElement !== sel) {
      Array.prototype.forEach.call(sel.options, function (o) {
        var lbl = ant_label(o.value);
        o.textContent = (o.value === cur ? "● " : "  ") + lbl;
      });
      if (cur) sel.value = cur;
    }
    var known = ANT_MODES.some(function (m) { return m.v === cur; });
    zhtml("zte_ant_cur", cur
      ? '<b style="color:' + (cur === "auto" ? "#2E7D32" : "#E65100") + '">' + esc(ant_label(cur)) + "</b>" +
        ' <span style="font-size:10px;color:#78909C;font-weight:400">(' + esc(cur) + (known ? "" : " — unknown value") + ")</span>"
      : "—");
    var en = S.ant_en || {};
    zset("zte_ant_sw", en.as_switch === undefined ? "—" : String(en.as_switch) === "1" ? "on" : "off (" + en.as_switch + ")");
  }

  async function read_antenna() {
    var r = await ubusRetry([UCI_ANT, UCI_ANT_EN], { quiet: true }, 3);
    var a = uci_values(r[0]), e = uci_values(r[1]);
    if (a) S.ant = a;
    if (e) S.ant_en = e;
    render_antenna();
    return a ? a.as_mode : null;
  }

  window.zte_set_antenna = async function (v) {
    var sel = zel("zte_ant_sel");
    if (S.ant_busy) { toast("The previous antenna change is still running.", "warn"); return; }
    var cur = (S.ant && S.ant.as_mode) || "";
    function back() { if (sel) sel.value = cur || "auto"; if (sel) sel.blur(); }
    if (!v || v === cur) { back(); return; }
    if (!confirm("Antenna selection → " + ant_label(v) + " (" + v + ")?\n\n" +
      "• ZTE says: this setting is meant for debugging. A different antenna changes the signal; in normal use choose Automatic switching.\n" +
      "• It may need a developer session: the panel asks for the router password if none is saved.\n" +
      "• The connection can drop for a moment while the ODU switches.")) { back(); return; }
    if (S.ant_busy) { back(); return; }
    S.ant_busy = true;
    if (sel) sel.disabled = true;
    var call = { service: "zte_nwinfo_api", method: "nwinfo_set_odu_as_mode", params: { odu_as_mode: v } };
    var written = false;
    try {
      var r = await ubusRetry(call, { quiet: true }, 3);
      if (r.accessDenied) {
        var h = saved_hash() || (await ask_pw_hash());
        if (!h) { back(); return; }
        if (!(await developer_option_login(h))) { toast("Developer login failed — antenna selection not changed.", "error"); back(); return; }
        r = await ubus(call);
      }
      written = true;
      if (!r.success && !command_answer_uncertain(r)) {
        toast(r.accessDenied ? "The router refused the antenna call, even in a developer session." : "Antenna change failed (" + (r.error || "?") + ")", "error");
        back();
        return;
      }
      await sleep(1500);
      var now = await read_antenna();
      if (now === v) toast("Antenna selection: " + ant_label(v) + " ✓", "ok");
      else if (r.success) toast("The router accepted the call, but the setting reads “" + (now || "unknown") + "”.", "warn", 8000);
      else toast("Antenna selection: no answer from the router, and the setting reads “" + (now || "unknown") + "”.\nCheck it in a moment — nothing more was sent.", "warn", 10000);
    } catch (e) {
      if (written) toast("Antenna selection: the change was sent, but checking it failed (" + e.message + ") — check the setting.", "warn", 10000);
      else { toast("Antenna selection: the developer login did not go through (" + e.message + ") — nothing was changed.", "error"); back(); }
    } finally {
      S.ant_busy = false;
      if (sel) sel.disabled = false;
      render_antenna();
    }
  };
  window.zte_antenna_refresh = function () { return read_antenna(); };

  var THERMAL_POLICY_NAME = 19;

  var ROUTER_PROPS = null;
  function router_props() {
    if (!ROUTER_PROPS) ROUTER_PROPS = (async function () {
      try {
        var lang = (performance.getEntriesByType("resource") || []).map(function (e) { return e.name; })
          .filter(function (u) { return /Messages_[\w-]+\.properties/i.test(u); })[0] || "/i18n/Messages_en.properties";
        var r = await fetch(lang, { cache: "no-store" });
        if (r.ok) return parse_properties(await r.text());
      } catch (e) { }
      return {};
    })();
    return ROUTER_PROPS;
  }
  async function router_str(key, fallback) {
    var t = page_i18n(key);
    if (t) return t;
    var pr = await router_props();
    return (pr && pr[key]) || fallback;
  }

  async function read_sys_settings() {
    var r = await ubus([
      { service: "zwrt_web", method: "web_login_timeout_period_get" },
      { service: "zwrt_bsp.thermal", method: "get_policy" },
    ], { quiet: true });
    var fresh = { timeout: false, thermal: false };
    if (r[0].success && r[0].data && r[0].data.login_timeout_period !== undefined) {
      S.login_timeout = parseInt(r[0].data.login_timeout_period, 10);
      S.login_timeout_ok = fresh.timeout = true;
    } else if (!r[0].accessDenied && !command_answer_uncertain(r[0])) { S.login_timeout_ok = false; }
    if (r[1].success && r[1].data && r[1].data.current_policy !== undefined) {
      S.thermal_policy = parseInt(r[1].data.current_policy, 10);
      S.thermal_ok = fresh.thermal = true;
    } else if (!r[1].accessDenied && !command_answer_uncertain(r[1])) { S.thermal_ok = false; }
    if (S.thermal_ok && !S.thermal_label) {
      S.thermal_label = await router_str("tc_settings_switch", "Temperature control");
      S.thermal_info = await router_str("thermal_switch_info",
        "Protects the device by throttling when it gets too hot. Keep it ON. If turned off, it comes back on after a reboot.");
    }
    render_sys_settings();
    return fresh;
  }

  var QOS_UNIT_FACTOR = { 3: 1, 4: 10, 6: 1000 };
  function qos_from_mbps(mbps) {
    var best = null;
    [3, 4, 6].forEach(function (unit) {
      var f = QOS_UNIT_FACTOR[unit];
      var rate = Math.min(127, Math.floor(mbps / f));
      if (rate < 1) return;
      var v = rate * f;
      if (!best || v > best.mbps || (v === best.mbps && f < QOS_UNIT_FACTOR[best.unit])) best = { rate: rate, unit: unit, mbps: v };
    });
    if (!best) best = { rate: 1, unit: 3, mbps: 1 };
    best.rounded = best.mbps !== mbps;
    return best;
  }
  function qos_mbps(rate, unit) {
    var f = QOS_UNIT_FACTOR[unit] || 1;
    return (Number(rate) || 0) * f;
  }
  var CAP_TRIES = 5, CAP_RETRY_MS = 8000;
  function cap_retry(key, fn) {
    if (S.session_lost) { setTimeout(fn, CAP_RETRY_MS); return true; }
    S[key] = (S[key] || 0) + 1;
    if (S[key] >= CAP_TRIES) return false;
    setTimeout(fn, CAP_RETRY_MS);
    return true;
  }
  async function load_qos_cap() {
    if (S.session_lost) { setTimeout(load_qos_cap, CAP_RETRY_MS); return; }
    var r = await ubusRetry({ service: "zwrt_router.api", method: "router_get_qos" }, { quiet: true }, 2);
    if (r.accessDenied && cap_retry("qos_cap_tries", load_qos_cap)) return;
    S.qos_ok = !!r.success;
    if (r.success && r.data) S.qos = r.data;
    render_dev_sec();
    if (S.qos_ok) { refresh_qos(); load_qos_profiles(); }
  }

  async function load_tr069_cap() {
    if (S.session_lost) { setTimeout(load_tr069_cap, CAP_RETRY_MS); return; }
    var r = await ubusRetry({ service: "zwrt_tr069.api", method: "get_acsinfo", params: { moduleName: "web" } }, { quiet: true }, 2);
    if (r.accessDenied && cap_retry("tr069_cap_tries", load_tr069_cap)) return;
    if (r.success && r.data && r.data.EnableCWMP !== undefined) {
      S.tr069_ok = true;
      S.tr069 = { on: String(r.data.EnableCWMP) === "1", inform: String(r.data.PeriodicInformEnable) === "1" };
    } else {
      S.tr069_ok = false;
    }
    render_dev_sec();
  }
  function rpc_mod() { try { return (window.requirejs || window.require)("service_rpc"); } catch (e) { return null; } }
  function tr069_read_full() {
    return new Promise(function (res) {
      var m = rpc_mod();
      if (!m || typeof m.getTR069Config !== "function") return res(null);
      var done = false;
      function fin(v) { if (!done) { done = true; res(v && typeof v === "object" && v.enableCWMP !== undefined ? v : null); } }
      try { m.getTR069Config(fin, fin); } catch (e) { fin(null); }
      setTimeout(function () { fin(null); }, 7000);
    });
  }
  function tr069_write_full(cfg) {
    return new Promise(function (res) {
      var m = rpc_mod();
      if (!m || typeof m.setTR069Configuration !== "function") return res({ ok: false, err: "no setter" });
      var done = false;
      function fin(v) { if (!done) { done = true; res(v); } }
      try { m.setTR069Configuration(cfg, fin, fin); } catch (e) { fin({ ok: false, err: e.message }); }
      setTimeout(function () { fin({ ok: false, err: "timeout" }); }, 9000);
    });
  }
  async function refresh_qos() {
    var r = await ubusRetry({ service: "zwrt_router.api", method: "router_get_qos" }, { quiet: true }, 2);
    if (r.success) { S.qos = r.data || {}; render_dev_sec(); }
    return r.success ? r.data || {} : null;
  }
  function qos_check(want) {
    return read_back(refresh_qos, function (q) {
      return Object.keys(want).every(function (k) {
        var v = q[k] === undefined && k === "qos_smart_switch" ? "0" : q[k];
        return String(v) === String(want[k]);
      });
    }, 4000);
  }
  function qos_on() { return !!(S.qos && String(S.qos.qos_smart_switch) === "1"); }
  var QOS_PROFILES = [
    { v: "0", key: "speed_allocation_priority_0", name: "Automatic" },
    { v: "1", key: "speed_allocation_priority_1", name: "Game priority" },
    { v: "2", key: "speed_allocation_priority_2", name: "Web page priority" },
    { v: "3", key: "speed_allocation_priority_3", name: "Video priority" },
  ];
  async function load_qos_profiles() {
    if (S.qos_prof_loaded) return;
    S.qos_prof_loaded = true;
    for (var i = 0; i < QOS_PROFILES.length; i++) {
      QOS_PROFILES[i].name = await router_str(QOS_PROFILES[i].key, QOS_PROFILES[i].name);
    }
    render_dev_sec();
  }
  function qos_profile_now() { return S.qos && S.qos.qos_smart_pri_type !== undefined ? String(S.qos.qos_smart_pri_type) : "0"; }
  function wan_is_bridge() { return /bridge/i.test((S.wan && S.wan.opms_wan_mode) || ""); }
  function render_dev_sec() {
    var qos_vis = S.qos_ok && !wan_is_bridge();
    var show = qos_vis || S.tr069_ok || S.gf_tr069;
    ztoggle("zte_dev_sec", show);
    ztoggle("zte_qos_row", !!qos_vis);
    ztoggle("zte_qos_btns", !!qos_vis);
    ztoggle("zte_qos_prof_row", !!qos_vis);
    if (qos_vis) {
      var on = qos_on();
      var prof = QOS_PROFILES.filter(function (p) { return p.v === qos_profile_now(); })[0];
      var txt = on
        ? '<b style="color:#E65100">ON</b> — ↑' + esc(String(qos_mbps(S.qos.upload_total_limit_rate, S.qos.upload_total_limit_unit))) + " / ↓" +
          esc(String(qos_mbps(S.qos.download_total_limit_rate, S.qos.download_total_limit_unit))) + " Mb/s" + (prof ? " · " + esc(prof.name) : "")
        : '<span style="color:#78909C">off</span>';
      zhtml("zte_qos_state", txt);
      var b1 = zel("zte_qos_on_btn"), b0 = zel("zte_qos_off_btn");
      if (b1) b1.classList.toggle("active", on);
      if (b0) b0.classList.toggle("active", !on);
      var sel = zel("zte_qos_profile");
      if (sel) {
        if (sel.options.length !== QOS_PROFILES.length || (sel.options[0] && sel.options[0].textContent !== QOS_PROFILES[0].name)) {
          sel.innerHTML = QOS_PROFILES.map(function (p) { return '<option value="' + p.v + '">' + esc(p.name) + "</option>"; }).join("");
        }
        if (document.activeElement !== sel) sel.value = qos_profile_now();
      }
    }
    ztoggle("zte_tr069_row", !!S.tr069_ok || !!S.gf_tr069);
    ztoggle("zte_tr069_btns", !!S.tr069_ok);
    if (S.tr069_ok && S.tr069) {
      var ton = S.tr069.on, inf = S.tr069.inform;
      zhtml("zte_tr069_state",
        'CWMP <b style="color:' + (ton ? "#C62828" : "#2E7D32") + '">' + (ton ? "ON" : "off") + "</b>" +
        ' · Inform <b style="color:' + (inf ? "#C62828" : "#2E7D32") + '">' + (inf ? "on" : "off") + "</b>");
      var t1 = zel("zte_tr069_on_btn"), t0 = zel("zte_tr069_off_btn");
      if (t1) t1.classList.toggle("active", ton);
      if (t0) t0.classList.toggle("active", !ton);
      var i1 = zel("zte_tr069_inform_on_btn"), i0 = zel("zte_tr069_inform_off_btn");
      if (i1) i1.classList.toggle("active", inf);
      if (i0) i0.classList.toggle("active", !inf);
    }
  }

  window.zte_qos = async function (on) {
    if (S.qos_busy) { toast("The previous QoS change is still running.", "warn"); return; }
    S.qos_busy = true;
    try { await qos_apply(on); } finally { S.qos_busy = false; }
  };
  async function qos_apply(on) {
    if (!on) {
      if (!confirm("Turn the QoS speed limit off?")) return;
      await run_action("QoS off", function () {
        return sys_set({ service: "zwrt_router.api", method: "router_set_qos", params: { qos_smart_switch: 0 } });
      }, function () { return qos_check({ qos_smart_switch: 0 }); }, { ok: "QoS turned off ✓" });
      await refresh_qos();
      return;
    }
    var curUp = (S.qos && S.qos.upload_total_limit_rate) || "";
    var curDn = (S.qos && S.qos.download_total_limit_rate) || "";
    var curUpM = curUp ? qos_mbps(curUp, S.qos.upload_total_limit_unit) : "";
    var curDnM = curDn ? qos_mbps(curDn, S.qos.download_total_limit_unit) : "";
    var up = prompt("QoS — maximum UPLOAD speed in Mb/s (1-127000):", String(curUpM || ""));
    if (up === null) return;
    var dn = prompt("QoS — maximum DOWNLOAD speed in Mb/s (1-127000):", String(curDnM || ""));
    if (dn === null) return;
    up = parseInt(up, 10); dn = parseInt(dn, 10);
    if (!(up > 0) || !(dn > 0) || up > 127000 || dn > 127000) { toast("Enter whole numbers 1-127000 (Mb/s).", "error"); return; }
    var qu = qos_from_mbps(up), qd = qos_from_mbps(dn);
    if ((qu.rounded || qd.rounded) && !confirm("The router stores a speed as a whole number 1–127 in Mb/s, 10 Mb/s or Gb/s steps.\n" +
      "The closest limits that do not go above what you asked are:\n\n" +
      "  ↑ upload   " + up + " → " + qu.mbps + " Mb/s\n  ↓ download " + dn + " → " + qd.mbps + " Mb/s\n\nUse these?")) return;
    var limits = { upload_total_limit_rate: qu.rate, download_total_limit_rate: qd.rate,
      upload_total_limit_unit: qu.unit, download_total_limit_unit: qd.unit };
    var r1 = await sys_set({ service: "zwrt_router.api", method: "router_set_qos", params: limits });
    if (r1 && (r1.cancelled || r1.denied)) return;
    if (!(r1 && r1.success)) {
      if (!command_answer_uncertain(r1)) { toast("QoS set failed" + (r1 && r1.error ? " (" + r1.error + ")" : ""), "error"); return; }
      var c1 = await qos_check(limits);
      if (c1 !== true) {
        toast("QoS limits: no answer from the router, and " + (c1 === false ? "it does not show the new limits" : "the panel could not read them back") +
          ".\nQoS was not switched on — nothing more was sent.", "warn", 10000);
        await refresh_qos();
        return;
      }
    }
    var prof = parseInt(qos_profile_now(), 10);
    var note = (qu.rounded || qd.rounded) ? "\n(you asked for ↑" + up + " / ↓" + dn + " Mb/s)" : "";
    await run_action("QoS switch", function () {
      return sys_set({ service: "zwrt_router.api", method: "router_set_qos", params: { qos_smart_switch: 1, qos_smart_pri_type: prof } });
    }, function () {
      return qos_check(Object.assign({ qos_smart_switch: 1, qos_smart_pri_type: prof }, limits));
    }, { ok: "QoS on — ↑" + qu.mbps + " / ↓" + qd.mbps + " Mb/s ✓" + note });
    await refresh_qos();
  }

  window.zte_qos_profile = async function (v) {
    var n = parseInt(v, 10);
    if (!(n >= 0)) return;
    if (S.qos_busy) { toast("The previous QoS change is still running.", "warn"); await refresh_qos(); return; }
    S.qos_busy = true;
    try { await qos_profile_apply(n, v); } finally { S.qos_busy = false; }
  };
  async function qos_profile_apply(n, v) {
    var prof = QOS_PROFILES.filter(function (p) { return p.v === String(n); })[0];
    var sw = qos_on() ? 1 : 0;
    await run_action("QoS profile change", function () {
      return sys_set({ service: "zwrt_router.api", method: "router_set_qos", params: { qos_smart_switch: sw, qos_smart_pri_type: n } });
    }, function () { return qos_check({ qos_smart_switch: sw, qos_smart_pri_type: n }); },
    { ok: "QoS profile: " + (prof ? prof.name : v) + " ✓" });
    await refresh_qos();
  }

  async function refresh_tr069() {
    var r = await ubusRetry({ service: "zwrt_tr069.api", method: "get_acsinfo", params: { moduleName: "web" } }, { quiet: true }, 2);
    if (r.success && r.data && r.data.EnableCWMP !== undefined) {
      S.tr069 = { on: String(r.data.EnableCWMP) === "1", inform: String(r.data.PeriodicInformEnable) === "1" };
      render_dev_sec();
      return S.tr069;
    }
    return null;
  }

  async function tr069_apply(changes, label) {
    if (S.tr069_busy) { toast("The previous TR-069 change is still running.", "warn"); return; }
    S.tr069_busy = true;
    try { await tr069_apply_one(changes, label); } finally { S.tr069_busy = false; }
  }
  async function tr069_apply_one(changes, label) {
    var m = rpc_mod();
    if (!m || typeof m.getTR069Config !== "function" || typeof m.setTR069Configuration !== "function") {
      toast("This firmware does not expose the TR-069 config functions, so the panel can't change it.", "error", 9000);
      return;
    }
    var g = await tr069_read_full();
    if (!g) { toast("Could not read the TR-069 configuration.", "error"); return; }
    var copied = ["serverUrl", "serverUserName", "serverPassword", "requestUserName", "requestPassword", "requestPort", "tr069_PeriodicInformInterval"];
    if (changes.enableCWMP === undefined) copied.push("enableCWMP");
    if (changes.informEnable === undefined) copied.push("tr069_PeriodicInformEnable");
    var missing = copied.filter(function (k) { return g[k] === undefined; });
    if (missing.length) {
      toast(label + ": this firmware's TR-069 configuration has no " + missing.join(", ") + " field — nothing was written\n(writing it back could clear the ACS settings).", "error", 12000);
      return;
    }
    var payload = {
      enableCWMP: changes.enableCWMP !== undefined ? changes.enableCWMP : g.enableCWMP,
      serverURL: g.serverUrl, serverusername: g.serverUserName, serveruserpassword: g.serverPassword,
      connrequestname: g.requestUserName, connrequestpassword: g.requestPassword, connrequestport: g.requestPort,
      tr069_PeriodicInformEnable: changes.informEnable !== undefined ? changes.informEnable : g.tr069_PeriodicInformEnable,
      tr069_PeriodicInformInterval: g.tr069_PeriodicInformInterval,
    };
    var res = await tr069_write_full(payload);
    var ok = res && (res.result === "success" || res.result === 0 || res.result === "0");
    var lost = !ok && res && res.err === "timeout";
    if (!ok && !lost) {
      toast(label + " failed" + (res && res.errorText ? " (" + res.errorText + ")" : ""), "error", 7000);
      setTimeout(refresh_tr069, 800);
      return;
    }
    var want = {};
    if (changes.enableCWMP !== undefined) want.on = !!changes.enableCWMP;
    if (changes.informEnable !== undefined) want.inform = !!changes.informEnable;
    var v = await read_back(refresh_tr069, function (t) {
      return Object.keys(want).every(function (k) { return t[k] === want[k]; });
    }, 4000);
    if (v === true) toast(label + " ✓", "ok", 7000);
    else if (v === false) toast(label + (lost ? ": no answer from the router, and it does not show the change." : ": the router accepted it, but still reads the old setting."), "warn", 10000);
    else toast(label + ": " + (lost ? "no answer from the router, and " : "sent, but ") + "the panel could not read the setting back.\nCheck it in a moment.", "warn", 10000);
  }

  window.zte_tr069 = function (on) {
    if (on && !confirm("Turn TR-069 ON?\n\nThis lets your operator manage the router remotely (ACS). Only turn it on if you need it.")) return;
    if (!on && !confirm("Turn TR-069 (remote management) OFF?")) return;
    return tr069_apply({ enableCWMP: on ? 1 : 0 }, "TR-069 " + (on ? "ON" : "off"));
  };
  window.zte_tr069_inform = function (on) {
    return tr069_apply({ informEnable: on ? 1 : 0 }, "Periodic inform " + (on ? "on" : "off"));
  };

  function fmt_timeout(sec) {
    if (!(sec > 0)) return "—";
    if (sec % 3600 === 0) return (sec / 3600) + " h";
    if (sec % 60 === 0) return (sec / 60) + " min";
    return sec + " s";
  }

  function render_sys_settings() {
    ztoggle("zte_sys_timeout_row", !!S.login_timeout_ok);
    ztoggle("zte_sys_timeout_btns", !!S.login_timeout_ok);
    ztoggle("zte_thermal_sec", !!S.thermal_ok);
    if (S.login_timeout_ok) zhtml("zte_sys_timeout", (S.login_timeout > 0 ? esc(fmt_timeout(S.login_timeout)) +
      ' <span style="font-size:10px;color:#78909C;font-weight:400">(' + S.login_timeout + " s)</span>" : "—"));
    if (S.thermal_ok) {
      if (S.thermal_label) zset("zte_thermal_label", S.thermal_label);
      if (S.thermal_info) zset("zte_thermal_note", S.thermal_info);
      var on = S.thermal_policy === 1;
      zhtml("zte_sys_thermal", '<b style="color:' + (on ? "#2E7D32" : "#C62828") + '">' + (on ? "ON" : "OFF") + "</b>" +
        ' <span style="font-size:10px;color:#78909C;font-weight:400">(policy ' + esc(S.thermal_policy) + ")</span>");
      var b1 = zel("zte_thermal_on_btn"), b0 = zel("zte_thermal_off_btn");
      if (b1) b1.classList.toggle("active", on);
      if (b0) b0.classList.toggle("active", !on);
    }
  }

  async function sys_set(call) {
    var r = await ubusRetry(call, { quiet: true }, 3);
    if (r.accessDenied) {
      var h = saved_hash() || (await ask_pw_hash());
      if (!h) return { cancelled: true };
      var dev = false;
      try { dev = await developer_option_login(h); } catch (e) { dev = false; }
      if (!dev) { toast("Developer login failed.", "error"); return { denied: true }; }
      r = await ubus(call);
    }
    return r;
  }

  function sys_once(fn) {
    return async function (arg) {
      if (S.sys_busy) { toast("The previous change is still running.", "warn"); return; }
      S.sys_busy = true;
      try { await fn(arg); } finally { S.sys_busy = false; }
    };
  }
  window.zte_set_login_timeout = sys_once(async function () {
    var cur = S.login_timeout > 0 ? S.login_timeout : 600;
    var inp = prompt("Session timeout — seconds of inactivity before the router logs you out.\n" +
      "Now: " + cur + " s. New value in seconds (60\u201386400):", String(cur));
    if (inp === null) return;
    var n = parseInt(String(inp).trim(), 10);
    if (!(n >= 60 && n <= 86400)) { toast("Enter a number of seconds between 60 and 86400.", "warn"); return; }
    var r = await sys_set({ service: "zwrt_web", method: "web_login_timeout_period_set", params: { login_timeout_period: n } });
    if (r.cancelled || r.denied) return;
    var lost = !r.success && command_answer_uncertain(r);
    if (!r.success && !lost) { toast("Could not change the session timeout" + (r.error ? " (" + r.error + ")" : "") + ".", "error"); return; }
    var fresh = await read_sys_settings();
    if (!fresh.timeout) toast("Session timeout: " + (lost ? "no answer from the router, and " : "sent, but ") + "the panel could not read it back — check it in a moment.", "warn", 9000);
    else if (S.login_timeout === n) toast("Session timeout set to " + fmt_timeout(S.login_timeout) + " \u2713", "ok", 6000);
    else toast((lost ? "No answer from the router, and the session timeout reads " : "The router accepted the call, but the session timeout reads ") +
      fmt_timeout(S.login_timeout) + " (you asked for " + fmt_timeout(n) + ").", "warn", 9000);
  });

  window.zte_thermal = sys_once(async function (on) {
    if (!on) {
      var info = S.thermal_info || "With it off the device may run hotter. It comes back on after a reboot.";
      if (!confirm("Turn " + (S.thermal_label || "temperature control") + " OFF?\n\n" + info +
        "\n\nIt may ask for the router password (developer session).")) return;
    }
    var r = await sys_set({ service: "zwrt_bsp.thermal", method: "set_policy", params: { name: THERMAL_POLICY_NAME, action: on ? 1 : 0 } });
    if (r.cancelled || r.denied) return;
    var lost = !r.success && command_answer_uncertain(r);
    if (!r.success && !lost) { toast("Thermal control change failed" + (r.error ? " (" + r.error + ")" : "") + ".", "error"); return; }
    await sleep(1200);
    var fresh = await read_sys_settings();
    if (!fresh.thermal) toast("Thermal control: " + (lost ? "no answer from the router, and " : "sent, but ") + "the panel could not read it back — check it in a moment.", "warn", 9000);
    else if (S.thermal_policy === (on ? 1 : 0)) toast("Thermal control is " + (on ? "ON" : "OFF") + " \u2713", on ? "ok" : "warn", 6000);
    else toast((lost ? "No answer from the router, and thermal control reads policy " : "The router accepted the call, but thermal control reads policy ") + S.thermal_policy + ".", "warn", 8000);
  });

  function gps_service_absent(err) {
    return /not\s*found|no\s*object|unknown|invalid (object|command)/i.test(String(err || ""));
  }
  function gnss_status() {
    var gp = S.gps || {};
    if (S.gps_last) return { has: "yes", txt: "yes — position known" + (gp.state !== "pos" ? " (last known)" : ""), col: "#2E7D32" };
    if (gp.state === "encoded") return { has: "open", txt: "position sent encrypted only — could not decode it", col: "#E65100" };
    if (gp.state === "nofix") return { has: "open", txt: "no position yet", col: "#E65100" };
    if (gp.state === "error") {
      if (gps_service_absent(gp.err)) return { has: "no", txt: "not available on this router", col: "#78909C", why: gp.err };
      return { has: "open", txt: "unavailable right now", col: "#E65100", why: gp.err };
    }
    return { has: "checking", txt: "checking…", col: "#78909C" };
  }

  function render_gnss() {
    var st = gnss_status();
    ztoggle("zte_gnss_wrap", st.has === "yes" || st.has === "open");
    zhtml("zte_gnss_status", '<span style="color:' + st.col + '">' + esc(st.txt) + "</span>" +
      (st.why ? '<div style="font-size:9px;color:#B0BEC5;font-weight:400;">' + esc(st.why) + "</div>" : ""));
    ztoggle("zte_gnss_data", st.has === "yes" || st.has === "open");
    zset("zte_gnss_refresh_btn", st.has === "no" ? "🛰 Check again" : "🛰 Refresh position");
  }

  window.zte_reset_traffic = async function () {
    if (!confirm("Reset this month's traffic counters to 0?\n\n(Sets the monthly data and connected time to 0 using the router's own usage correction.)\n\n" +
      "Note: the router also takes this month's data and connected time off its All-time totals — that cannot be undone."))
      return;
    var mod = await rpc_module_name();
    var before = Number(S.traffic.month_rx_bytes) + Number(S.traffic.month_tx_bytes) || 0;
    var res = await ubusRetry([
      { service: "zwrt_data", method: "set_wwandst_calibmonth", params: { source_module: mod, cid: 1, type: 2, value: "0" } },
      { service: "zwrt_data", method: "set_wwandst_calibmonth", params: { source_module: mod, cid: 1, type: 1, value: "0" } },
    ]);
    function refused(x) { return !x.success && !command_answer_uncertain(x); }
    var lostAny = res.some(function (x) { return !x.success && command_answer_uncertain(x); });
    if (refused(res[0]) && refused(res[1])) {
      toast("Counter reset failed (" + (res[0].error || "?") + ")", "error");
      return;
    }
    if (refused(res[0]) || refused(res[1])) {
      toast("Counter reset only partly done: the " + (refused(res[1]) ? "connected time" : "data") + " counter was not reset (" +
        ((refused(res[1]) ? res[1] : res[0]).error || "?") + ")." + (lostAny ? " The router did not answer for the other one." : ""), "warn", 10000);
      await sleep(2000);
      await poll_once();
      return;
    }
    await sleep(2000);
    await poll_once();
    var after = Number(S.traffic.month_rx_bytes) + Number(S.traffic.month_tx_bytes) || 0;
    toast(after < before || after === 0 ? "Monthly counters reset ✓" :
      (lostAny ? "No clear answer from the router, and the monthly counter has not dropped yet" :
        "Router accepted the correction, but the monthly counter has not dropped yet") + " — check again in a moment.",
      after < before || after === 0 ? "ok" : "warn");
  };

  window.zte_traffic_clearday = async function () {
    var mod = await rpc_module_name();
    function read_clearday() {
      return ubusRetry({ service: "zwrt_data", method: "get_wwandst_clearday", params: { source_module: mod, cid: 1 } }, { quiet: true })
        .then(function (x) { return x.success && x.data && x.data.enable !== undefined ? x.data : null; });
    }
    var cur = await read_clearday();
    if (!cur) { toast("Could not read the automatic counter reset setting — nothing was changed.\nTry again in a moment.", "warn", 9000); return; }
    var on = String(cur.enable) === "1";
    var inp = prompt(
      "Automatic monthly counter reset\n\nCurrently: " + (on ? "ON, day " + (cur.clearday || "?") : "OFF") +
        "\n\nEnter a day of the month (1–31) to enable, or 0 to disable:",
      on ? String(cur.clearday || 1) : "1",
    );
    if (inp === null) return;
    var day = parseInt(inp, 10);
    if (isNaN(day) || day < 0 || day > 31) { toast("Enter a number from 0 to 31", "error"); return; }
    var params = { source_module: mod, cid: 1, enable: day > 0 ? 1 : 0, clearday: day > 0 ? day : parseInt(cur.clearday, 10) || 1 };
    await run_action(day > 0 ? "Automatic counter reset → day " + day : "Automatic counter reset → off", function () {
      return ubusRetry({ service: "zwrt_data", method: "set_wwandst_clearday", params: params });
    }, function () {
      return read_back(read_clearday, function (x) {
        return String(x.enable) === String(params.enable) && (day === 0 || String(x.clearday) === String(day));
      }, 4000);
    });
  };

  var SECRET_KEY_RE = new RegExp([
    "password", "passwd", "passphrase", "(^|_)pass\\d*($|_)", "pwd", "psk", "secret", "token", "session", "cookie", "credential",
    "auth_?key", "shared_?key", "(^|_)(wpa_?|wep_?)?key\\d*$", "_key\\d*($|_)", "wepkey", "wpakey",
    "(^|_)pin\\d*($|_)", "pin_?code", "sim_?pin", "(^|_)puk", "puk_?code", "(^|_)nck", "unlock_?code",
    "imei", "imsi", "iccid", "msisdn",
  ].join("|"), "i");
  function redact_secrets(v, depth) {
    depth = depth || 0;
    if (v === null || typeof v !== "object" || depth > 12) return v;
    if (Array.isArray(v)) return v.map(function (x) { return redact_secrets(x, depth + 1); });
    var o = {};
    Object.keys(v).forEach(function (k) {
      var x = v[k];
      o[k] = SECRET_KEY_RE.test(k) && x !== "" && x !== null && x !== undefined ? "(hidden)" : redact_secrets(x, depth + 1);
    });
    return o;
  }

  function render_any(title, data) {
    if (data && typeof data === "object" && !Array.isArray(data) &&
      Object.keys(data).every(function (k) { return data[k] === null || typeof data[k] !== "object"; }))
      return info_table(title, data, { rawKeys: true });
    return '<div class="zte_sec"><div class="zte_sec_title">' + esc(title) + "</div>" +
      '<pre style="white-space:pre-wrap;word-break:break-all;font-size:10px;margin:0;user-select:text;">' +
      esc(JSON.stringify(data, null, 2)) + "</pre></div>";
  }
  function find_obj_array(o, depth) {
    if (!o || typeof o !== "object" || depth > 3) return null;
    if (Array.isArray(o)) return o.length && o[0] && typeof o[0] === "object" ? o : null;
    var keys = Object.keys(o);
    for (var i = 0; i < keys.length; i++) {
      var r = find_obj_array(o[keys[i]], depth + 1);
      if (r) return r;
    }
    return null;
  }

  async function apn_state() {
    var r = await ubusRetry([
      { service: "zwrt_apn_object", method: "get_apn_mode", params: {} },
      { service: "zwrt_apn_object", method: "get_apn_at_cid", params: { cid: 1 } },
    ], { quiet: true });
    if (!r[0].success || !r[0].data) return null;
    var m = pick(r[0].data, ["apn_mode", "apnmode", "mode"]);
    if (m === undefined || m === null || typeof m === "object") return null;
    var at = r[1].success && r[1].data && typeof r[1].data === "object" ? r[1].data : null;
    return {
      mode: /^(1|manual)$/i.test(String(m)) ? 1 : /^(0|auto)$/i.test(String(m)) ? 0 : null,
      id: at ? pick(at, ["profileid", "profile_id"]) : undefined,
      apn: at ? pick(at, ["wanapn", "apn"]) : undefined,
    };
  }
  function apn_apply(label, calls, want) {
    return run_action(label, async function () {
      var res = await ubusRetry(calls);
      return res;
    }, function () {
      return read_back(apn_state, function (st) {
        if (st.mode !== want.mode) return false;
        if (want.mode === 0) return true;
        if (st.id !== undefined && st.id !== "") return String(st.id) === String(want.id);
        return want.apn !== undefined && st.apn !== undefined && String(st.apn) === String(want.apn);
      }, 10000);
    }, { ok: label + " ✓\nThe mobile connection restarts with the new APN…" });
  }

  window.zte_apn_info = async function () {
    var calls = [
      ["APN mode", "get_apn_mode", {}],
      ["APN in use (cid 1)", "get_apn_at_cid", { cid: 1 }],
      ["Manual APN profiles", "get_manu_apn_list", {}],
      ["Automatic APN list", "get_auto_apn_list", {}],
    ];
    var res = await ubusRetry(calls.map(function (c) {
      return { service: "zwrt_apn_object", method: c[1], params: c[2] };
    }), { quiet: true });

    var list = res[2].success ? find_obj_array(res[2].data, 0) || [] : [];
    var profiles = list.map(function (p) {
      return {
        id: pick(p, ["profileid", "profile_id", "id"]),
        name: pick(p, ["profilename", "profile_name", "name"]),
        apn: pick(p, ["wanapn", "apn"]),
        type: pick(p, ["pdptype", "pdp_type"]),
      };
    });

    var sw = '<div class="zte_sec"><div class="zte_sec_title">Switch APN</div>' +
      '<button class="zte_btn" id="zte_apn_auto" style="width:100%;margin-bottom:6px;">↺ Automatic APN (from the SIM)</button>' +
      (profiles.length
        ? profiles.map(function (p, i) {
            var hasId = p.id !== undefined && p.id !== "";
            return '<div class="zte_row"><span class="zte_label" style="flex-shrink:1;">' +
              esc(dash(p.name)) + " — <b>" + esc(dash(p.apn)) + "</b>" + (p.type ? " (" + esc(p.type) + ")" : "") +
              (hasId ? ' <span style="color:#B0BEC5;">#' + esc(p.id) + "</span>" : "") + "</span>" +
              (hasId ? '<button class="zte_btn" data-apn-idx="' + i + '" style="padding:3px 10px;">Use</button>'
                     : '<span style="font-size:10px;color:#78909C;">no profile id</span>') + "</div>";
          }).join("")
        : '<div style="color:#78909C;font-size:11px;">No manual APN profiles found. Create one in the router\'s own APN page and it will appear here.</div>') +
      "</div>";

    var ov = show_modal("APN", sw + calls.map(function (c, i) {
      return res[i].success ? render_any(c[0], redact_secrets(res[i].data)) :
        '<div class="zte_sec"><div class="zte_sec_title">' + esc(c[0]) + '</div><div style="color:#78909C;">Not available (' + esc(res[i].error || "") + ")</div></div>";
    }).join(""));

    var note = "\n\nThe mobile connection restarts. If there is no internet afterwards, open 📡 APN again and switch back.";
    ov.querySelector("#zte_apn_auto").onclick = async function () {
      if (radio_busy("APN")) return;
      if (!confirm("Switch to the automatic APN?" + note)) return;
      ov.remove();
      await apn_apply("Automatic APN", [{ service: "zwrt_apn_object", method: "set_apn_mode", params: { apn_mode: 0 } }], { mode: 0 });
    };
    ov.querySelectorAll("[data-apn-idx]").forEach(function (b) {
      b.onclick = async function () {
        var p = profiles[+b.getAttribute("data-apn-idx")];
        if (radio_busy("APN")) return;
        if (!confirm('Switch to the manual APN profile "' + (p.name || "?") + '" (' + (p.apn || "?") + ")?" + note)) return;
        ov.remove();
        await apn_apply('APN → "' + (p.name || p.apn || p.id) + '"', [
          { service: "zwrt_apn_object", method: "set_apn_mode", params: { apn_mode: 1 } },
          { service: "zwrt_apn_object", method: "enable_manu_apn_id", params: { profileId: p.id } },
        ], { mode: 1, id: p.id, apn: p.apn });
      };
    });
  };

  window.zte_lte_band = async function (bands) {
    if (radio_busy("LTE bands")) return;
    await load_band_caps();
    if (!bands) bands = prompt("LTE bands (e.g. 1+3+20)\n" + (lte_from_router() ? "This router has: B" + lte_avail().join(", B") + "\n" : "") +
      "Type AUTO to remove the LTE band lock.", "AUTO");
    if (!bands) return;
    if (bands.trim().toUpperCase() === "AUTO") return window.zte_lte_band_unlock(true);
    var list = parse_band_input(bands);
    if (!list || list.some(function (b) { return +b < 1 || +b > 128; })) {
      toast("Invalid band input — use e.g. 1+3+7 or AUTO", "error");
      return;
    }
    var missing = bands_missing(list, lte_avail(), lte_from_router());
    if (missing.length) {
      toast("This router does not have B" + missing.join(", B") + ".\nIt has: B" + lte_avail().join(", B"), "error", 9000);
      return;
    }
    return send_lte_bands(list, "LTE bands B" + list.join("+B"));
  };

  window.zte_lte_band_unlock = async function (skipConfirm) {
    if (radio_busy("LTE band unlock")) return;
    await load_band_caps();
    var all = lte_avail();
    if (!skipConfirm && !confirm("Remove LTE band lock?\n\nLocks to all bands " +
      (lte_from_router() ? "of this router" : "in the panel's built-in list") + ": B" + all.join(", B")))
      return;
    return send_lte_bands(all, "LTE band lock removed");
  };

  window.zte_nr_band = async function (bands) {
    if (radio_busy("5G bands")) return;
    await load_band_caps();
    if (!bands) bands = prompt("5G NR bands (e.g. 78+28)\n" + (nr_from_router() ? "This router has: n" + nr_avail().join(", n") + "\n" : "") +
      "Type AUTO to remove the NR band lock.", "AUTO");
    if (!bands) return;
    if (bands.trim().toUpperCase() === "AUTO") return window.zte_nr_band_unlock(true);
    var list = parse_band_input(bands);
    if (!list) {
      toast("Invalid band input — use e.g. 78+28 or AUTO", "error");
      return;
    }
    var missing = bands_missing(list, nr_avail(), nr_from_router());
    if (missing.length) {
      toast("This router does not have n" + missing.join(", n") + ".\nIt has: n" + nr_avail().join(", n"), "error", 9000);
      return;
    }
    if (nr_from_router() && S.bands.nr_sa.length && S.bands.nr_nsa.length) {
      var inL = function (l) { return list.filter(function (b) { return l.indexOf(String(b)) > -1; }); };
      var saL = inL(S.bands.nr_sa), nsaL = inL(S.bands.nr_nsa);
      if (saL.join() !== list.join() || nsaL.join() !== list.join())
        return send_nr_bands(saL, "5G bands n" + list.join("+n"), nsaL);
    }
    return send_nr_bands(list, "5G bands n" + list.join("+n"));
  };

  window.zte_nr_band_unlock = async function (skipConfirm) {
    if (radio_busy("5G band unlock")) return;
    await load_band_caps();
    var sa = nr_avail("sa"), nsa = nr_avail("nsa");
    if (!skipConfirm && !confirm("Remove NR (5G) band lock?\n\nLocks to all bands " +
      (nr_from_router() ? "of this router" : "in the panel's built-in list") + ": n" + nr_avail().join(", n")))
      return;
    await send_nr_bands(sa, "NR band lock removed", nsa);
  };

  window.zte_unlock_all_bands = async function () {
    if (radio_busy("Band unlock")) return;
    var slowA = await model_for("Band unlock");
    if (slowA === null) return;
    if (slowA) { await bands_reset_all(); return; }
    if (!confirm("Remove ALL band locks (LTE + 5G NR)?")) return;
    await window.zte_lte_band_unlock(true);
    await window.zte_nr_band_unlock(true);
  };

  function lte_cell_call(pci, earfcn) {
    return ubusRetry({
      service: "zte_nwinfo_api",
      method: "nwinfo_lock_lte_cell",
      params: { lock_lte_pci: String(pci), lock_lte_earfcn: String(earfcn) },
    });
  }
  function nr_cell_call(pci, arfcn, band) {
    return ubusRetry({
      service: "zte_nwinfo_api",
      method: "nwinfo_lock_nr_cell",
      params: { lock_nr_pci: String(pci), lock_nr_earfcn: String(arfcn), lock_nr_cell_band: String(band) },
    });
  }
  var APPLY_HINT = "\nToggle network mode or reboot the router to apply.";

  async function nr_cell_apply(pci, arfcn, band) {
    if (!op_start("nr_cell")) return "failed";
    try { return await nr_cell_apply_inner(pci, arfcn, band); } finally { op_end("nr_cell"); }
  }
  async function nr_cell_apply_inner(pci, arfcn, band) {
    var unlock = +pci === 0 && +arfcn === 0 && +band === 0;
    var label = unlock ? "5G cell unlock" : "5G cell lock " + pci + "," + arfcn + ",n" + band;
    var r;
    try { r = await nr_cell_call(pci, arfcn, band); } catch (e) { r = { success: false, error: e.message }; }
    var slow = await model_check();
    if (r && !r.success && !r.accessDenied && command_answer_uncertain(r)) r = { success: true, uncertain: true };
    if (!r || !r.success) {
      toast(label + " failed" + (r && r.error ? " (" + r.error + ")" : ""), "error");
      poll_once();
      return "failed";
    }
    toast(label + " — command " + (r.uncertain ? "sent" : "accepted") + ". Checking what the router stored…", "info");
    var d;
    if (slow) {
      var w = await radio_wait(function (x) {
        return x.lock_nr_cell !== undefined && (unlock ? nr_cell_unlocked(x.lock_nr_cell) : nr_cell_matches(x.lock_nr_cell, pci, arfcn, band)) &&
          has_service(x);
      }, 45000);
      d = w.d;
    } else {
      await sleep(CFG.settleMs);
      d = await fresh_netinfo();
    }
    poll_once();
    if (!d || d.lock_nr_cell === undefined) {
      toast(label + " — " + (r.uncertain ? "sent (no answer)" : "command accepted") + ", but the panel could not read the lock back." + APPLY_HINT, "warn", 10000);
      return "unverified";
    }
    var stored = d.lock_nr_cell;
    if (unlock ? nr_cell_unlocked(stored) : nr_cell_matches(stored, pci, arfcn, band)) {
      var svc = slow ? (has_service(d) ? " (" + d.network_type + ")" : "\nNo service yet (" + (d.network_type || "?") + ") — if it stays so, remove the lock.") : APPLY_HINT;
      toast(unlock ? "5G cell lock removed ✓ (stored)." + svc : label + " ✓ stored by the router." + svc, slow && !has_service(d) ? "warn" : "ok", 10000);
      return "ok";
    }
    toast(label + " — " + (r.uncertain ? "sent (no answer)" : "command accepted") + ", but the router reports lock_nr_cell = \"" + (stored || "(empty)") + "\"." +
      "\nThe lock may not be active.", "warn", 12000);
    return "mismatch";
  }

  function has_service(d) {
    return !!(d && d.network_type && !/no[\s_-]*service|limited|search|^\s*(none|unknown)?\s*$/i.test(String(d.network_type)));
  }
  async function radio_wait(pred, ms) {
    var t0 = Date.now(), d = null, last = null;
    while (Date.now() - t0 < ms) {
      await sleep(2000);
      d = await fresh_netinfo();
      if (!d) continue;
      last = d;
      if (pred(d)) return { ok: true, d: d };
    }
    return { ok: false, d: last };
  }
  async function lte_lock_direct(pci, earfcn) {
    if (!confirm("LTE cell lock — PCI " + pci + ", EARFCN " + earfcn + "\n\n" +
      "This router (" + S.model + ") applies a cell lock at once in any network mode, so the panel sends it\n" +
      "directly (no LTE-Only step). Mobile data drops for about 20 s.\n\n" +
      "⚠️ If this cell is not on your operator you will have no service until you remove the lock.\n\nContinue?")) return false;
    if (!op_start("cell_lock")) return false;
    try {
      toast("LTE cell lock " + pci + "," + earfcn + "…", "info");
      var r = await lte_cell_call(pci, earfcn);
      if (r.accessDenied) { toast("LTE cell lock failed (access denied)", "error"); return false; }
      if (!r.success && !command_answer_uncertain(r)) { toast("LTE cell lock failed (" + (r.error || "?") + ")", "error"); return false; }
      var want = pci + "," + earfcn;
      var w = await radio_wait(function (d) { return d.lock_lte_cell === want && has_service(d); }, 45000);
      if (w.ok) { toast("LTE cell lock " + want + " ✓ (" + w.d.network_type + ")", "ok"); return true; }
      if (w.d && w.d.lock_lte_cell === want) {
        toast("LTE cell lock " + want + " is set, but the router has no service yet (" + (w.d.network_type || "?") + ").\n" +
          "If it stays so, use 🔓 LTE Unlock.", "warn", 14000);
        return true;
      }
      toast("LTE cell lock " + want + ": the router " + (w.d ? "reports lock " + (w.d.lock_lte_cell || "(none)") : "did not answer afterwards") +
        ".\nCheck Cell Lock in a moment.", "warn", 12000);
      return false;
    } finally { op_end("cell_lock"); poll_once(); }
  }
  async function cell_unlock_reset(what) {
    if (!confirm("Remove " + what + " — " + S.model + "\n\n" +
      "On this router the panel uses the router's own reset (nwinfo_reset_band_cell_setting), as the\n" +
      "router's page does. It also puts the LTE and 5G band locks and the 5G cell lock back to the\n" +
      "router's defaults. Mobile data drops for about 20 s.\n\nContinue?")) return false;
    if (!op_start("cell_lock")) return false;
    try {
      toast("Removing " + what + "…", "info");
      var r = await ubusRetry({ service: "zte_nwinfo_api", method: "nwinfo_reset_band_cell_setting", params: {} });
      if (r.accessDenied) { toast("Reset failed (access denied)", "error"); return false; }
      if (!r.success && !command_answer_uncertain(r)) { toast("Reset failed (" + (r.error || "?") + ")", "error"); return false; }
      var w = await radio_wait(function (d) {
        var l = d.lock_lte_cell;
        return (!l || l === "0,0") && nr_cell_unlocked(d.lock_nr_cell) && has_service(d);
      }, 45000);
      if (w.ok) { toast(what + " removed ✓ — band locks are back to the router defaults (" + w.d.network_type + ").", "ok", 10000); return true; }
      toast(what + ": reset sent, but the router " + (w.d ? "reports " + (w.d.network_type || "?") + ", LTE lock " + (w.d.lock_lte_cell || "(none)")
        : "did not answer afterwards") + ".\nCheck again in a moment; if there is no service, reboot the router.", "warn", 14000);
      return false;
    } finally { op_end("cell_lock"); poll_once(); }
  }

  async function bands_reset_all() {
    var d0 = (await fresh_netinfo()) || S.net || {};
    var cells = [];
    if (d0.lock_lte_cell && d0.lock_lte_cell !== "0,0") cells.push("LTE " + d0.lock_lte_cell);
    if (!nr_cell_unlocked(d0.lock_nr_cell)) cells.push("5G " + d0.lock_nr_cell);
    if (!confirm("Remove ALL band locks (LTE + 5G) — " + S.model + "\n\n" +
      "On this router the panel uses the router's own reset (nwinfo_reset_band_cell_setting): one step,\n" +
      "mobile data drops once for about 20 s. The bands go back to the router's defaults.\n" +
      (cells.length ? "\n⚠️ It also removes the cell lock now set: " + cells.join(", ") + ".\n" : "") +
      "\nContinue?")) return false;
    if (!op_start("cell_lock")) return false;
    try {
      toast("Removing all band locks…", "info");
      var r = await ubusRetry({ service: "zte_nwinfo_api", method: "nwinfo_reset_band_cell_setting", params: {} });
      if (r.accessDenied) { toast("Reset failed (access denied)", "error"); return false; }
      if (!r.success && !command_answer_uncertain(r)) { toast("Reset failed (" + (r.error || "?") + ")", "error"); return false; }
      await load_band_caps();
      var need = lte_avail_in_mask().map(Number);
      var nrKnown = nr_from_router();
      var lteOk = function (d) {
        var lb = lte_bands_from_mask(d.lte_band_lock) || [];
        return need.every(function (b) { return lb.indexOf(b) > -1; }) && has_service(d);
      };
      var nrOk = function (d) {
        var f = nr_lock_fields(d);
        if (!nrKnown || f.nr5g_sa_band_lock === undefined || f.nr5g_nsa_band_lock === undefined) return null;
        return band_set(f.nr5g_sa_band_lock) === band_set(nr_avail("sa").join(",")) &&
          band_set(f.nr5g_nsa_band_lock) === band_set(nr_avail("nsa").join(","));
      };
      var w = await radio_wait(function (d) { return lteOk(d) && nrOk(d) !== false; }, 45000);
      if (w.ok && nrOk(w.d) === true) {
        toast("All band locks removed ✓ — router defaults (" + w.d.network_type + ").", "ok", 10000);
        return true;
      }
      if (w.ok) {
        toast("LTE band locks removed ✓ (" + w.d.network_type + ").\nThe 5G band lists could not be confirmed — check them in a moment.", "warn", 12000);
        return true;
      }
      if (w.d && lteOk(w.d)) {
        toast("LTE band locks removed ✓, but the 5G band lists are not back to the router defaults yet.\nCheck them in a moment.", "warn", 14000);
        return false;
      }
      toast("Band reset sent, but the router " + (w.d ? "reports " + (w.d.network_type || "?") : "did not answer afterwards") +
        ".\nCheck the bands in a moment; if there is no service, reboot the router.", "warn", 14000);
      return false;
    } finally { op_end("cell_lock"); poll_once(); }
  }

  window.zte_lte_cell_lock = async function (reset) {
    if (radio_busy("LTE cell lock")) return;
    if (reset) {
      var cur = S.net.lock_lte_cell;
      if (!cur || cur === "0,0") { toast("No LTE cell lock is active", "info"); return; }
      var slowL = await model_for("LTE cell lock");
      if (slowL === null) return;
      if (slowL) { await cell_unlock_reset("LTE cell lock " + cur); return; }
      if (!confirm("Remove LTE cell lock (" + cur + ")?")) return;
      if (!op_start("cell_lock")) return;
      try {
        await run_action("LTE cell unlock", function () { return lte_cell_call(0, 0); }, function () {
          return read_back(fresh_netinfo, function (d) { return !d.lock_lte_cell || d.lock_lte_cell === "0,0"; }, 6000);
        }, { ok: "LTE cell lock removed ✓ (stored).", note: APPLY_HINT });
      } finally { op_end("cell_lock"); }
      return;
    }
    var ch = S.net.lte_action_channel || (net_flags(S.net.network_type).is_lte ? S.net.wan_active_channel : "") || "";
    var def = (S.net.lte_pci || "") + "," + ch;
    var inp = prompt("LTE cell lock — PCI,EARFCN (e.g. 116,3350)\nDefault = current cell", def);
    if (!inp) return;
    var p = inp.split(",").map(function (x) { return x.trim(); });
    if (p.length !== 2) { toast("Invalid input — use PCI,EARFCN", "error"); return; }
    var chk = check_lte_cell(p[0], p[1]);
    if (chk.error) { toast("LTE cell lock: " + chk.error, "error", 9000); return; }
    await window.zte_guided_lte_lock(chk.pci, chk.earfcn);
  };

  window.zte_nr_cell_lock = async function (reset) {
    if (radio_busy("5G cell lock")) return;
    if (reset) {
      var cur = S.net.lock_nr_cell;
      if (nr_cell_unlocked(cur)) { toast("No 5G cell lock is active", "info"); return; }
      var slowN = await model_for("5G cell lock");
      if (slowN === null) return;
      if (slowN) { await cell_unlock_reset("5G cell lock " + cur); return; }
      if (!confirm("Remove 5G cell lock (" + cur + ")?")) return;
      await nr_cell_apply(0, 0, 0);
      return;
    }
    var def = (S.net.nr5g_pci || "") + "," + (S.net.nr5g_action_channel || "") + "," + strip_n(S.net.nr5g_action_band);
    var inp = prompt("5G cell lock — PCI,ARFCN,BAND (e.g. 202,639936,78)\nDefault = current cell", def);
    if (!inp) return;
    var p = inp.split(",").map(function (x) { return x.trim(); });
    if (p.length !== 3) { toast("Invalid input — use PCI,ARFCN,BAND", "error"); return; }
    var chk = check_nr_cell(p[0], p[1], p[2]);
    if (chk.error) { toast("5G cell lock: " + chk.error, "error", 9000); return; }
    if (!confirm("5G cell lock — PCI " + chk.pci + ", ARFCN " + chk.arfcn + ", band n" + chk.band + "\n\n" +
      "Mobile data can drop while the router re-attaches.\n" +
      "⚠️ If this cell is not on your operator you will have no service until you remove the lock.\n\nContinue?")) return;
    if (radio_busy("5G cell lock")) return;
    await nr_cell_apply(chk.pci, chk.arfcn, chk.band);
  };

  var GLOCK_MAX_RESUMES = 5;
  var GLOCK_MAX_AGE = 240000;
  var GLOCK_STEP_WAIT = CFG.modeWaitMs;
  var GLOCK_STEP_POLL = CFG.modePollMs;

  function glock_raw() { try { return JSON.parse(localStorage.getItem(LS.GLOCK) || "null"); } catch (e) { return null; } }
  function glock_get() {
    var st = glock_raw();
    return st && Date.now() - (st.startedAt || 0) <= GLOCK_MAX_AGE ? st : null;
  }
  function glock_set(st) { try { localStorage.setItem(LS.GLOCK, JSON.stringify(st)); } catch (e) { } }
  function glock_clear() { try { localStorage.removeItem(LS.GLOCK); } catch (e) { } }

  async function glock_wait(pred, budget) {
    var t0 = Date.now();
    while (Date.now() - t0 < budget) {
      try { await poll_once(true); } catch (e) { }
      if (pred(S.net || {})) return true;
      await sleep(GLOCK_STEP_POLL);
    }
    return false;
  }

  async function glock_call(desc, callObj) {
    var r = await ubusRetry(callObj);
    if (r && r.accessDenied) throw new Error("session lost at " + desc);
    if (command_answer_uncertain(r)) throw new Error("no answer at " + desc + " (" + (r && r.error) + ")");
    return !!(r && r.success);
  }
  async function glock_mode_back(mode) {
    var d = null;
    try { d = await fresh_netinfo(); } catch (e) { d = null; }
    if (!d) return false;
    if (d.net_select === mode) return true;
    if (!(await glock_set_mode(mode))) return false;
    await glock_wait(function (d) {
      return d.net_select === mode && (d.network_type === "ENDC" || d.network_type === "LTE-NSA" || d.network_type === "SA" || d.network_type === "LTE");
    }, GLOCK_STEP_WAIT);
    var after = null;
    try { after = await fresh_netinfo(); } catch (e) { after = null; }
    return !!after && after.net_select === mode;
  }
  var GLOCK_BACK_TRIES = 3;
  function glock_back_retry(st, mode) {
    st.backTries = (st.backTries || 0) + 1;
    if (st.backTries >= GLOCK_BACK_TRIES) return false;
    glock_set(st);
    toast("Guided lock: the router did not go back to " + (NET_MODES[mode] || mode) + " yet.\nThe panel tries again in 15 s.", "warn", 10000);
    setTimeout(glock_run, 15000);
    return true;
  }
  function glock_set_mode(mode) {
    return glock_call("mode " + mode, { service: "zte_nwinfo_api", method: "nwinfo_set_netselect", params: { net_select: mode } });
  }

  window.zte_guided_lte_lock = async function (pci, earfcn) {
    if (S.op === "glock" || glock_get()) {
      toast("A guided LTE lock is already in progress.", "warn"); return;
    }
    if (S.op) { toast("Guided lock: " + (OP_NAMES[S.op] || "another change") + " is still running — try again when it has finished.", "warn"); return; }
    if (scan_left_running()) { toast(scan_running_msg("Guided lock"), "warn", 10000); return; }
    if (glock_raw()) {
      toast("An earlier guided lock did not finish — checking it first.\nPress Lock again afterwards.", "warn", 9000);
      glock_run();
      return;
    }
    var chk = check_lte_cell(pci, earfcn);
    if (chk.error) { toast("Guided lock: " + chk.error, "error", 9000); return; }
    pci = chk.pci; earfcn = chk.earfcn;
    var slowG = await model_for("Guided lock");
    if (slowG === null) return;
    if (slowG) { await lte_lock_direct(pci, earfcn); return; }
    var orig = S.net.net_select || "";
    for (var mt = 0; !orig && mt < 3; mt++) {
      if (mt) await sleep(1500);
      var fn = null;
      try { fn = await fresh_netinfo(); } catch (e) { fn = null; }
      orig = (fn && fn.net_select) || "";
    }
    if (!orig) {
      toast("Guided lock: couldn't read the current Network Mode — try again in a moment (nothing was sent).", "warn", 11000);
      return;
    }
    var prev = orig;
    var onLte = prev === "Only_LTE";
    if (!confirm(
      "Guided LTE cell lock — PCI " + pci + ", EARFCN " + earfcn + "\n\n" +
      (onLte
        ? "The router is already on LTE-Only, which stays as it is.\nThe panel will lock this cell.\n\n"
        : "The panel will:\n  1. switch to LTE-Only\n  2. lock this cell\n  3. return to " + (NET_MODES[prev] || prev) + "\n\n") +
      "⚠️ Your connection may drop for ~10–20 s while the mode changes. If the router logs you out, the panel logs back in and finishes on its own.\n" +
      "⚠️ If this cell is not on your operator you will have no service until you unlock.\n\nContinue?"
    )) return;
    if (S.op || glock_raw()) {
      toast("Guided lock: " + (S.op ? (OP_NAMES[S.op] || S.op) : OP_NAMES.glock) + " started meanwhile — nothing was sent.", "warn", 9000);
      return;
    }
    glock_set({ phase: onLte ? "locking" : "to_lte", pci: pci, earfcn: earfcn, prevMode: prev, origMode: orig, startedAt: Date.now(), resumes: 0 });
    await glock_run();
  };

  var GLOCK_DROP_AGE = 86400000;
  var GLOCK_RECOVER_TRIES = 3;
  async function glock_give_up(st) {
    if (!op_start("glock", true)) return;
    try {
      var d = await fresh_netinfo();
      if (!d || !d.net_select) {
        if (Date.now() - (st.startedAt || 0) > GLOCK_DROP_AGE) glock_clear();
        toast("A guided LTE lock did not finish, and the network mode cannot be read right now —\nnothing was changed. The panel checks again at the next start.", "warn", 12000);
        return;
      }
      var back = st.prevMode;
      if (d.net_select !== "Only_LTE" || !back || back === "Only_LTE") {
        glock_clear();
        toast("A guided LTE lock did not finish. The network mode is " + (NET_MODES[d.net_select] || d.net_select) +
          " and was left as it is.", "info", 10000);
        return;
      }
      var accepted = false;
      try { accepted = await glock_set_mode(back); } catch (e) {
        st.lostTries = (st.lostTries || 0) + 1;
        glock_set(st);
        if (st.lostTries <= GLOCK_RECOVER_TRIES) setTimeout(glock_run, 30000);
        return;
      }
      if (!accepted && !(await check_login())) return;
      var restored = accepted && (await glock_wait(function (n) { return n.net_select === back; }, GLOCK_STEP_WAIT));
      if (!restored) {
        st.recoverTries = (st.recoverTries || 0) + 1;
        if (st.recoverTries < GLOCK_RECOVER_TRIES) {
          glock_set(st);
          toast("A guided LTE lock did not finish, and the router did not go back to " + (NET_MODES[back] || back) +
            " yet.\nThe panel tries again in 30 s.", "warn", 10000);
          setTimeout(glock_run, 30000);
          return;
        }
      }
      glock_clear();
      toast(restored
        ? "A guided LTE lock did not finish — the network mode is back to " + (NET_MODES[back] || back) + ".\n" +
          "The LTE cell lock " + st.pci + "," + st.earfcn + " may be set: check Cell Lock."
        : "A guided LTE lock did not finish, and the router did not go back to " + (NET_MODES[back] || back) + ".\n" +
          "Set the network mode by hand.", restored ? "warn" : "error", 14000);
    } finally { op_end("glock"); }
  }

  async function glock_run() {
    var st = glock_raw();
    if (!st || S.op === "glock") return;
    if (S.op) { setTimeout(glock_run, 5000); return; }
    if (Date.now() - (st.startedAt || 0) > GLOCK_MAX_AGE || (st.resumes || 0) > GLOCK_MAX_RESUMES) {
      await glock_give_up(st);
      return;
    }
    if (!op_start("glock", true)) return;
    try {
      if (st.phase === "to_lte") {
        toast("Guided lock 1/4 — switching to LTE-Only…", "info", 6000);
        var cur0 = await fresh_netinfo();
        if (!cur0 && st.resumes) throw new Error("no reading of the network mode");
        var accepted = cur0 && cur0.net_select === "Only_LTE" ? true : await glock_set_mode("Only_LTE");
        var onLte = await glock_wait(function (d) { return d.net_select === "Only_LTE"; }, GLOCK_STEP_WAIT);
        if (!onLte) {
          if (!(await check_login())) throw new Error("session lost while switching to LTE-Only");
          st.phase = "abort";
          st.reason = accepted ? "the router did not switch to LTE-Only" : "the router refused LTE-Only";
          glock_set(st);
        } else {
          await glock_wait(function (d) { return d.network_type === "LTE"; }, 8000);
          st.phase = "locking"; glock_set(st);
        }
      }
      if (st.phase === "abort") {
        var back = st.origMode || st.prevMode;
        if (!st.backTries) toast("Guided lock stopped — " + (st.reason || "the router did not switch to LTE-Only") +
          ". No cell lock was set. Restoring " + (NET_MODES[back] || back) + "…", "error", 10000);
        var restored = await glock_mode_back(back);
        if (!restored && glock_back_retry(st, back)) { op_end("glock"); return; }
        glock_clear();
        toast(restored
          ? "Guided lock cancelled — no cell lock was set. Network mode is back to " + (NET_MODES[back] || back) + "."
          : "Guided lock cancelled — no cell lock was set. The router still reports " + (NET_MODES[S.net.net_select] || S.net.net_select || "?") +
            "; set the network mode by hand if needed.", restored ? "warn" : "error", 14000);
      }
      if (st.phase === "locking") {
        toast("Guided lock 2/4 — locking LTE cell " + st.pci + "," + st.earfcn + "…", "info", 6000);
        var cur1 = await fresh_netinfo();
        if (!cur1 && st.resumes) throw new Error("no reading of the cell lock");
        if (!(cur1 && (cur1.lock_lte_cell || "") === st.pci + "," + st.earfcn))
          await glock_call("cell lock", { service: "zte_nwinfo_api", method: "nwinfo_lock_lte_cell", params: { lock_lte_pci: String(st.pci), lock_lte_earfcn: String(st.earfcn) } });
        st.phase = "settle"; glock_set(st);
      }
      if (st.phase === "settle") {
        await sleep(2500);
        st.phase = "restore"; glock_set(st);
      }
      if (st.phase === "restore") {
        if (st.prevMode !== "Only_LTE") {
          if (!st.backTries) toast("Guided lock 3/4 — returning to " + (NET_MODES[st.prevMode] || st.prevMode) + "…", "info", 6000);
          var isBack = await glock_mode_back(st.prevMode);
          if (!isBack && glock_back_retry(st, st.prevMode)) { op_end("glock"); return; }
        }
        st.phase = "verify"; glock_set(st);
      }
      if (st.phase === "verify") {
        try { await poll_once(false); } catch (e) { }
        var locked = (S.net.lock_lte_cell || "") === st.pci + "," + st.earfcn;
        var mode_ok = S.net.net_select === st.prevMode;
        var nt = S.net.network_type || "?";
        glock_clear();
        if (locked && mode_ok)
          toast("✅ Guided lock done — LTE " + st.pci + "," + st.earfcn + " locked · " + (NET_MODES[st.prevMode] || st.prevMode) + " (" + nt + ")", "ok", 12000);
        else if (!mode_ok)
          toast("Guided lock: the router is still on " + (NET_MODES[S.net.net_select] || S.net.net_select || "?") +
            " and did not go back to " + (NET_MODES[st.prevMode] || st.prevMode) + ".\nSet the network mode by hand (Network Mode). LTE cell lock " +
            (locked ? "✓ " + st.pci + "," + st.earfcn : "not confirmed") + ".", "error", 16000);
        else
          toast("Guided lock finished — lock ? · mode ✓ (" + nt + "). Check the panel; toggle mode or reboot if the lock is not active.", "warn", 14000);
      }
    } catch (e) {
      var cur = glock_get();
      if (cur) { cur.resumes = (cur.resumes || 0) + 1; glock_set(cur); }
      var alive = false;
      try { alive = await check_login(); } catch (_) { alive = false; }
      op_end("glock");
      if (!alive) {
        toast("Guided lock — the router dropped the session. Re-logging in to finish…", "warn", 9000);
        setTimeout(function () { location.reload(); }, 1200);
      } else {
        toast("Guided lock paused: " + (e && e.message ? e.message : e) + " — retrying…", "warn", 8000);
        setTimeout(glock_run, 2500);
      }
      return;
    }
    op_end("glock");
  }

  function glock_resume_if_pending() {
    var st = glock_raw();
    if (!st || S.op === "glock") return;
    if (glock_get()) toast("Resuming guided LTE lock (" + st.pci + "," + st.earfcn + ")…", "info", 7000);
    glock_run();
  }

  async function read_wifi_radios() {
    var res = await ubusRetry([
      { service: "uci", method: "get", params: { config: "wireless", section: "wifi0" } },
      { service: "uci", method: "get", params: { config: "wireless", section: "wifi1" } },
    ], { quiet: true });
    var v24 = uci_values(res[0]), v5 = uci_values(res[1]);
    return v24 && v5 ? { v24: v24, v5: v5 } : null;
  }
  async function set_wifi_param(param, label, validator, formatter, extraCb, disclaimer, same) {
    if (S.wifi_busy) { toast("The previous WiFi change is still running.", "warn"); return; }
    S.wifi_busy = true;
    try { await set_wifi_param_once(param, label, validator, formatter, extraCb, disclaimer, same); } finally { S.wifi_busy = false; }
  }
  async function set_wifi_param_once(param, label, validator, formatter, extraCb, disclaimer, same) {
    formatter = formatter || function (v) { return v; };
    extraCb = extraCb || function () { return ""; };
    same = same || function (a, b) { return String(a) === String(b); };
    var now = await read_wifi_radios();
    if (!now) { toast("Could not read the current WiFi settings — nothing was changed.\nTry again in a moment.", "warn", 9000); return; }
    var v24 = now.v24, v5 = now.v5;
    var c24 = v24[param] !== undefined ? String(v24[param]) : "", c5 = v5[param] !== undefined ? String(v5[param]) : "";
    var shown = function (c) { return c === "" ? "not reported" : formatter(c); };
    while (true) {
      var input = prompt(
        "WiFi " + label + " for 2.4 GHz and 5 GHz (value1,value2 — or one value for both)\n" +
          "Current:\n  2.4 GHz: " + shown(c24) + extraCb(v24) + "\n  5 GHz:   " + shown(c5) + extraCb(v5) +
          "\n\nThe WiFi restarts after a change: a device on WiFi (this browser too) loses it for a moment." +
          (disclaimer ? "\n\n" + disclaimer : ""),
        c24 && c5 ? c24 + "," + c5 : c24 || c5,
      );
      if (input === null) return;
      var parts = input.split(",").map(function (x) { return x.trim(); });
      if (parts.length < 1 || parts.length > 2) { alert("Enter one value or two values separated by a comma."); continue; }
      var a = parts[0], b = parts.length === 2 ? parts[1] : parts[0];
      if (!validator(a) || !validator(b)) { alert("Invalid value for " + label + "."); continue; }
      var w0 = {}, w1 = {};
      w0[param] = a; w1[param] = b;
      await run_action("WiFi " + label + " → " + formatter(a) + " / " + formatter(b), function () {
        return ubusRetry({ service: "zwrt_wlan", method: "set", params: { wifi0: w0, wifi1: w1 } });
      }, function () {
        return read_back(read_wifi_radios, function (x) { return same(x.v24[param], a) && same(x.v5[param], b); }, 30000);
      });
      return;
    }
  }

  window.zte_wifi_txpower = function () {
    return set_wifi_param(
      "txpowerpercent", "TX Power %",
      function (v) { var n = parseInt(v, 10); return !isNaN(n) && n >= 1 && n <= 100; },
      function (v) { return v + "%"; },
      function (vals) { return vals.txpower ? " (" + vals.txpower + " dBm)" : ""; },
      null,
      function (have, want) { return parseInt(have, 10) === parseInt(want, 10); },
    );
  };

  window.zte_wifi_country = function () {
    return set_wifi_param(
      "country", "Country",
      function (v) { return /^[A-Za-z]{2}$/.test(v); },
      function (v) { return String(v).toUpperCase(); },
      null,
      "⚠️ Wrong settings may be illegal in your country or cause connectivity issues.",
      function (have, want) { return String(have).toUpperCase() === String(want).toUpperCase(); },
    );
  };

  var modal_key = null;
  function show_modal(title, html) {
    var old = zel("zte_modal");
    if (old) old.remove();
    if (modal_key) { document.removeEventListener("keydown", modal_key); modal_key = null; }
    var ov = document.createElement("div");
    ov.id = "zte_modal";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.innerHTML =
      '<div class="zte_modal_box">' +
      '<div class="zte_modal_hdr"><span>' + esc(title) + '</span><button class="zte_icon_btn" id="zte_modal_x" type="button" aria-label="Close">×</button></div>' +
      '<div class="zte_modal_body">' + html + "</div></div>";
    document.body.appendChild(ov);
    function close() {
      ov.remove();
      document.removeEventListener("keydown", onKey);
      if (modal_key === onKey) modal_key = null;
    }
    function onKey(e) {
      if (!ov.isConnected) { close(); return; }
      if (e.key === "Escape") { e.preventDefault(); close(); }
    }
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    zel("zte_modal_x").onclick = close;
    modal_key = onKey;
    document.addEventListener("keydown", onKey);
    try { zel("zte_modal_x").focus(); } catch (e) { }
    return ov;
  }

  function label_from_key(k) {
    return k.split("_").map(function (w) {
      return w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }

  function info_table(title, obj, opts) {
    opts = opts || {};
    var excl = opts.exclude || [];
    var rows = Object.keys(obj || {})
      .filter(function (k) {
        var v = obj[k];
        if (k.charAt(0) === "." || excl.indexOf(k) > -1) return false;
        return !(v === "" || v === null || v === undefined);
      })
      .map(function (k) { return [opts.rawKeys ? k : label_from_key(k), obj[k]]; })
      .sort(function (a, b) { return a[0].localeCompare(b[0]); });
    return (
      '<div class="zte_sec"><div class="zte_sec_title">' + esc(title) + "</div>" +
      (rows.length
        ? rows.map(function (r) {
            return '<div class="zte_row"><span class="zte_label">' + esc(r[0]) + '</span><span class="zte_value">' + esc(r[1]) + "</span></div>";
          }).join("")
        : '<div style="color:#78909C;">No data</div>') +
      "</div>"
    );
  }

  window.zte_hw_sw_info = async function () {
    var r = await ubusRetry({ service: "uci", method: "get", params: { config: "zwrt_common_info", section: "common_config" } });
    if (!r.success || !r.data || !r.data.values) return show_modal("HW / SW Info", "<p>No data available.</p>");
    show_modal("HW / SW Info", info_table("Hardware & Software", r.data.values, { exclude: ["imei_sv", "manufacturer"] }));
  };

  window.zte_sim_info = async function () {
    var r = await ubusRetry({ service: "zwrt_zte_mdm.api", method: "get_sim_info" });
    if (!r.success || !r.data) return show_modal("SIM Info", "<p>Failed to retrieve SIM info.</p>");
    show_modal("SIM Info", info_table("SIM", r.data, { exclude: ["wlan_mac_address"] }));
  };

  window.zte_wms_info = async function () {
    var r = await ubusRetry({ service: "zwrt_wms", method: "zwrt_wms_get_wms_capacity" });
    if (!r.success || !r.data) return show_modal("SMS Storage (WMS)", "<p>Failed to retrieve WMS info.</p>");
    show_modal("SMS Storage (WMS)", info_table("WMS Capacity", r.data));
  };

  async function check_wifi() {
    var r;
    try { r = await ubusRetry({ service: "zwrt_wlan", method: "report", params: {} }, { quiet: true }, 3); } catch (e) { r = null; }
    S.wifi_absent = !!(r && !r.success && !r.accessDenied && /not\s*found/i.test(String(r.error || "")));
    ztoggle("zte_wifi_sec", !S.wifi_absent);
  }

  window.zte_wifi_info = async function () {
    var r = await ubusRetry([
      { service: "uci", method: "get", params: { config: "wireless", section: "wifi0" } },
      { service: "uci", method: "get", params: { config: "wireless", section: "main_2g" } },
      { service: "uci", method: "get", params: { config: "wireless", section: "wifi1" } },
    ]);
    function vals(x) { return (x && x.data && x.data.values) || {}; }
    show_modal(
      "WiFi Info",
      info_table("Radio 2.4 GHz (wifi0)", vals(r[0]), { rawKeys: true }) +
        info_table("Radio 5 GHz (wifi1)", vals(r[2]), { rawKeys: true }) +
        info_table("Main SSID (main_2g)", vals(r[1]), { rawKeys: true }),
    );
  };

  function copy_text(text, msg) {
    if (navigator.clipboard && window.isSecureContext)
      navigator.clipboard.writeText(text).then(function () { toast(msg || "Copied!", "ok"); },
        function () { prompt("Copy:", text); });
    else prompt("Copy:", text);
  }

  window.zte_test_connection = async function () {
    var s = Date.now();
    var r = await ubus({ service: "zwrt_web", method: "web_developer_login_info" }, { quiet: true });
    var ms = Date.now() - s;
    if (r.success && r.data) toast("Router OK — " + ms + " ms", "ok");
    else if (r.accessDenied) toast("Router OK — " + ms + " ms (not logged in)", "warn");
    else toast("The router did not answer (" + (r.error || "no answer") + ", " + ms + " ms).", "error");
  };

  window.zte_copy_signal = function () {
    var d = S.net;
    var lines = [
      "=== ZTE Signal Report — " + new Date().toLocaleString() + " ===",
      "Provider: " + (d.network_provider_fullname || "N/A"),
      "Network Type: " + (d.network_type || "N/A"),
      "Bands: " + (band_info(S.lte, S.nr) || "N/A"),
    ];
    var e = split_cell_id(d.cell_id);
    if (e) lines.push("eNodeB: " + e.node + " (0x" + e.node.toString(16).toUpperCase() + ") | Sector: " + e.sector);
    var g = split_cell_id(d.nr5g_cell_id);
    if (g) lines.push("gNodeB: " + g.node + " (0x" + g.node.toString(16).toUpperCase() + ") | Sector: " + g.sector);
    lines.push("Cell ID: " + (parse_cell_id(d.cell_id) !== null ? d.cell_id : "N/A") + " | 5G Cell ID: " + (parse_cell_id(d.nr5g_cell_id) !== null ? d.nr5g_cell_id : "N/A"));
    lines.push("WAN IP: " + (S.wan.mwan_wanlan1_wan_ipaddr || "N/A"));
    function cl(prefix, c, i) {
      return prefix + (i === 0 ? " PCell " : " SCell #" + i + " ") + c.band +
        " | RSRP: " + dash(c.rsrp) + " dBm | RSRQ: " + dash(c.rsrq) + " dB | SINR: " + dash(c.sinr) +
        " dB | BW: " + dash(c.bandwidth) + " MHz | " + (prefix === "LTE" ? "EARFCN: " + c.earfcn : "ARFCN: " + c.arfcn) +
        " | PCI: " + dash(c.pci);
    }
    var f = net_flags(d.network_type);
    if (f.is_lte) S.lte.forEach(function (c, i) { lines.push(cl("LTE", Object.assign({}, c, { band: "B" + c.band }), i)); });
    if (f.show_nr) S.nr.forEach(function (c, i) { lines.push(cl("5G ", Object.assign({}, c, { band: "n" + c.band }), i)); });
    copy_text(lines.join("\n"), "Signal copied!");
  };

  var HIDDEN_SKIP = ["#login", "#home", "#change_password", "#privacy_policy", "#developer_options_login", "#check_license"];

  function hidden_on() {
    try { return localStorage.getItem(LS.HIDDEN) === "1"; } catch (e) { return false; }
  }

  function ui_modules() {
    try {
      var rq = window.requirejs || window.require;
      return (rq && rq.s && rq.s.contexts && rq.s.contexts._ && rq.s.contexts._.defined) || null;
    } catch (e) {
      return null;
    }
  }

  function ui_can_open(hash) {
    try {
      var mods = ui_modules(), menu = mods && mods["config/menu"];
      if (!menu || typeof menu.findMenu !== "function") return null;
      return menu.findMenu(hash).length > 0;
    } catch (e) {
      return null;
    }
  }

  function ui_pages() {
    var mods = ui_modules(), out = [], seen = {};
    if (!mods) return out;
    Object.keys(mods).forEach(function (k) {
      var v = mods[k];
      if (!/(^|\/)menu(_\w+)?$/.test(k) || !Array.isArray(v)) return;
      v.forEach(function (e) {
        if (!e || typeof e.hash !== "string" || seen[e.hash]) return;
        if (ui_can_open(e.hash) === false) return;
        seen[e.hash] = true;
        out.push({ hash: e.hash, path: String(e.path || "") });
      });
    });
    return out;
  }

  function in_panel(el) {
    return !!el.closest("#zte_panel,#zte_modal");
  }

  function menu_entry_opens(li) {
    var links = li.querySelectorAll("a[href^='#']"), any = false, known = false;
    for (var i = 0; i < links.length; i++) {
      var h = links[i].getAttribute("href");
      if (h.length < 2) continue;
      var can = ui_can_open(h);
      if (can !== null) known = true;
      if (can) any = true;
    }
    return any || !known;
  }

  function apply_hidden_menus() {
    if (!hidden_on()) return;
    var shown = 0;
    function reveal(el, how) {
      if (how === "class") el.classList.remove("hide"); else el.style.display = "";
      el.dataset.zteUnhidden = how;
      el.classList.add("zte_unhidden");
      el.title = "Hidden by the router's web interface (shown by ZTE Panel NG)";
      shown++;
    }
    document.querySelectorAll("#leftMenu li, #sidebarMenu li").forEach(function (li) {
      if (in_panel(li)) return;
      var byClass = li.classList.contains("hide"), byStyle = li.style.display === "none";
      if (!byClass && !byStyle) return;
      if (!menu_entry_opens(li)) return;
      reveal(li, byClass ? "class" : "style");
    });
    document.querySelectorAll("#container .hide").forEach(function (el) {
      if (in_panel(el) || el.closest(".modal,.alert")) return;
      reveal(el, "class");
    });
    return shown;
  }

  function undo_hidden_menus() {
    document.querySelectorAll("[data-zte-unhidden]").forEach(function (el) {
      if (el.dataset.zteUnhidden === "class") el.classList.add("hide"); else el.style.display = "none";
      el.classList.remove("zte_unhidden");
      el.removeAttribute("title");
      delete el.dataset.zteUnhidden;
    });
  }

  function update_hidden_btn() {
    var b = zel("zte_hidden_btn");
    if (!b) return;
    var on = hidden_on();
    b.classList.toggle("ok", on);
    b.textContent = on ? "👁 Hidden Menus: ON" : "👁 Hidden Menus: OFF";
  }

  function hidden_watch_start() {
    if (S.hidden_timer) return;
    S.hidden_timer = setInterval(apply_hidden_menus, 2000);
  }
  function hidden_watch_stop() {
    if (!S.hidden_timer) return;
    clearInterval(S.hidden_timer);
    S.hidden_timer = null;
  }
  window.zte_hidden_toggle = function () {
    var on = !hidden_on();
    try { if (on) localStorage.setItem(LS.HIDDEN, "1"); else localStorage.removeItem(LS.HIDDEN); } catch (e) { }
    update_hidden_btn();
    if (on) {
      hidden_watch_start();
      var n = apply_hidden_menus();
      toast("Hidden menus: ON" + (n ? " — " + n + " hidden item(s) shown on this page (dashed outline)" : " — nothing hidden on this page"), "ok");
    } else {
      hidden_watch_stop();
      undo_hidden_menus();
      toast("Hidden menus: OFF", "info");
    }
  };

  var force_page_gen = 0;
  function force_open_page(path) {
    var gen = ++force_page_gen, hash0 = location.hash;
    return new Promise(function (resolve) {
      var req = window.requirejs || window.require;
      var c = document.getElementById("container");
      if (!req || !c || !path) { resolve(false); return; }
      var done = false;
      function superseded() { return gen !== force_page_gen || location.hash !== hash0; }
      function fin(v) { if (!done) { done = true; resolve(superseded() ? null : v); } }
      try {
        req(["text!tmpl/" + path + ".html", path], function (tmpl, mod) {
          if (done || superseded()) { fin(null); return; }
          try {
            try { if (window.$) window.$("body").removeClass().addClass("page_" + path.replace(/\//g, "_")); } catch (e) { }
            c.innerHTML = tmpl;
            try { if (mod && typeof mod.init === "function") mod.init(); } catch (e) { console.warn("[ZTE] forced page init:", e && e.message); }
            try { if (window.$ && window.$("#container").translate) window.$("#container").translate(); } catch (e) { }
            try { if (window.$) window.$("form").attr("autocomplete", "off"); } catch (e) { }
            fin(true);
          } catch (e) { fin(false); }
        }, function () { fin(false); });
      } catch (e) { fin(false); }
      setTimeout(function () { fin(false); }, 8000);
    });
  }

  var PAGE_DIRS = ["auth/adm/", "auth/firewall/", "auth/network/", "auth/wifi/", "auth/voip/",
    "auth/sms/", "auth/status/", "auth/update/", "auth/mesh/", "auth/nfc/", "auth/"];

  var MENU_PATHMAP = null;
  function menu_path_map() {
    if (MENU_PATHMAP) return MENU_PATHMAP;
    MENU_PATHMAP = {};
    var mods = ui_modules();
    if (mods) Object.keys(mods).forEach(function (k) {
      if (!/(^|\/)menu(_\w+)?$/.test(k) || !Array.isArray(mods[k])) return;
      (function walk(arr) {
        arr.forEach(function (e) {
          if (!e) return;
          if (e.hash && e.path) MENU_PATHMAP[e.hash] = e.path;
          ["child", "children", "subMenu"].forEach(function (c) { if (Array.isArray(e[c])) walk(e[c]); });
        });
      })(mods[k]);
    });
    return MENU_PATHMAP;
  }

  async function resolve_hidden_path(hash, knownPath) {
    if (knownPath) return knownPath;
    var mapped = menu_path_map()[hash];
    if (mapped) return mapped;
    try {
      var mods = ui_modules(), menu = mods && mods["config/menu"];
      if (menu && typeof menu.findMenu === "function") {
        var r = menu.findMenu(hash);
        if (r && r[0] && r[0].path) return r[0].path;
      }
    } catch (e) { }
    var name = String(hash).replace(/^#/, "");
    if (!/^[\w-]+$/.test(name)) return null;
    for (var i = 0; i < PAGE_DIRS.length; i++) {
      try { var res = await fetch("/tmpl/" + PAGE_DIRS[i] + name + ".html", { cache: "force-cache" }); if (res.ok) return PAGE_DIRS[i] + name; } catch (e) { }
    }
    return null;
  }

  function hidden_page_list() {
    var out = [], seen = {};
    function add(hash, path, label) {
      if (!hash || hash === "#" || seen[hash] || HIDDEN_SKIP.indexOf(hash) !== -1) return;
      seen[hash] = true;
      out.push({ hash: hash, path: path || "", label: (label || hash.slice(1)).trim() });
    }
    ui_pages().forEach(function (p) {
      var links = document.querySelectorAll('a[href="' + p.hash + '"]'), vis = false;
      for (var i = 0; i < links.length; i++) if (!in_panel(links[i]) && links[i].offsetParent !== null) vis = true;
      if (!vis) add(p.hash, p.path, p.hash.slice(1));
    });
    document.querySelectorAll("#leftMenu li, #sidebarMenu li").forEach(function (li) {
      if (in_panel(li)) return;
      var hiddenByFw = li.classList.contains("hide") || li.style.display === "none" || li.classList.contains("zte_unhidden");
      if (!hiddenByFw) return;
      var a = li.querySelector('a[href^="#"]');
      if (a) add(a.getAttribute("href"), "", a.textContent || a.getAttribute("href").slice(1));
    });
    return out;
  }

  var EXTRA_PAGES = [
    { path: "hide/debug_page", form: true }, { path: "hide/network_debug" }, { path: "developer/network_debug" },
    { path: "hide/slice_setting", form: true }, { path: "hide/rf_mmw", form: true },
    { path: "hide/temperature_control_settings", form: true }, { path: "hide/ant_switch" },
    { path: "adm/developer_options" }, { path: "stk/stk" }, { path: "phonebook/phonebook" },
    { path: "sms/smslist" }, { path: "sms/sim_messages" }, { path: "sms/sms_setting" },
  ];
  var extra_found = null;
  async function extra_pages() {
    if (extra_found) return extra_found;
    var rq = window.requirejs || window.require;
    if (!rq || typeof rq.toUrl !== "function") return [];
    var inMenu = {};
    Object.keys(menu_path_map()).forEach(function (h) { inMenu[menu_path_map()[h]] = true; });
    ui_pages().forEach(function (p) { if (p.path) inMenu[p.path] = true; });
    var ok = async function (url, html) {
      try {
        var r = await fetch(url, { cache: "force-cache" });
        if (!r.ok) return false;
        var t = await r.text();
        return t.length > 20 && !/^\s*<!doctype html|^\s*<html/i.test(t) && (html || !/<html/i.test(t.slice(0, 300)));
      } catch (e) { return false; }
    };
    var found = [];
    for (var i = 0; i < EXTRA_PAGES.length; i++) {
      var e = EXTRA_PAGES[i];
      if (inMenu[e.path]) continue;
      if ((await ok(rq.toUrl("tmpl/" + e.path + ".html"), true)) && (await ok(rq.toUrl(e.path + ".js"), false))) found.push(e);
    }
    extra_found = found;
    return found;
  }
  var EXTRA_FORM_NOTE = "This firmware page fills some of its fields with fixed starting values, not with the router's settings " +
    "(on debug_page the 4G band list starts at Band 1 and no 5G band is ticked). Each section's Apply writes what that section shows — " +
    "change only the section you mean to change.";

  window.zte_hidden_pages = async function () {
    var pages = hidden_page_list();
    var extras = [];
    try { extras = await extra_pages(); } catch (e) { extras = []; }
    var html = pages.length
      ? '<div class="zte_sec" style="font-size:11px;color:#78909C;line-height:1.55;">' +
        "<b>What this list is.</b> The web interface ships more pages than its menu shows. Two kinds end up here: pages that exist in the firmware's page list but have no menu link, " +
        "and sidebar entries the firmware marks hidden (CSS <i>display:none</i> / a hidden class) so you never see them — TR-069 (ACS) config and Developer options are the usual ones.<br><br>" +
        "<b>How opening works.</b> This interface is a single-page app: to show a page it loads that page's HTML template and its code module and runs them. The firmware does this with no check that the page is in the menu, " +
        "so the panel calls the same loader directly with the page's own path. The page renders exactly as the router draws it — this is not a copy or a mock-up.<br><br>" +
        "<b>What to expect.</b> Click a page to open it (use the normal menu to go back). Some pages belong to features this model does not have and come up empty or half-filled; " +
        "a few ask for a developer login or a licence code first. Opening a page only shows it — the router's own access rules still decide what any control on it is allowed to change.</div>" +
        '<div class="zte_sec"><div class="zte_btn_grid">' +
        pages.map(function (p) {
          return '<button class="zte_btn" data-hash="' + esc(p.hash) + '" data-path="' + esc(p.path) + '" title="' + esc(p.hash) + '">' + esc(p.label) + "</button>";
        }).join("") + "</div></div>"
      : '<div class="zte_sec" style="font-size:12px;color:#78909C;">No hidden pages found on this firmware.</div>';
    if (extras.length) {
      if (!pages.length) html = "";
      html += '<div class="zte_sec"><div style="font-size:11px;color:#78909C;line-height:1.55;margin-bottom:6px;">' +
        "<b>Not in this router's menu.</b> Pages this firmware has but none of its menus lists (found by name). " +
        "⚠ marks pages whose fields can start with fixed values instead of the router's settings — see the note when one opens.</div>" +
        '<div class="zte_btn_grid">' +
        extras.map(function (e) {
          var name = e.path.split("/").pop();
          return '<button class="zte_btn" data-extra="' + esc(e.path) + '" data-form="' + (e.form ? "1" : "") + '" title="' + esc(e.path) + '">' +
            (e.form ? "⚠ " : "") + esc(name) + "</button>";
        }).join("") + "</div></div>";
    }
    var ov = show_modal("Hidden pages", html);
    ov.querySelectorAll("button[data-hash]").forEach(function (b) {
      b.onclick = async function () {
        var hash = b.getAttribute("data-hash"), known = b.getAttribute("data-path");
        b.textContent = "…";
        var path = await resolve_hidden_path(hash, known);
        ov.remove();
        var ok = path ? await force_open_page(path) : false;
        if (ok === null) return;
        if (ok) toast("Opened " + hash.slice(1) + " (forced past the menu). Use the menu to go back.", "ok", 7000);
        else if (path) location.hash = hash;
        else toast("Couldn't locate the page file for " + hash + " on this firmware.", "warn", 7000);
      };
    });
    ov.querySelectorAll("button[data-extra]").forEach(function (b) {
      b.onclick = async function () {
        var path = b.getAttribute("data-extra"), form = b.getAttribute("data-form") === "1", name = path.split("/").pop();
        b.textContent = "…";
        ov.remove();
        var ok = await force_open_page(path);
        if (ok === null) return;
        if (!ok) { toast("Couldn't open " + name + " on this firmware.", "warn", 7000); return; }
        toast("Opened " + name + " (not in this router's menu). Use the menu to go back." + (form ? "\n\n⚠ " + EXTRA_FORM_NOTE : ""),
          form ? "warn" : "ok", form ? 20000 : 7000);
      };
    });
  };

  function start_hidden_menus() {
    update_hidden_btn();
    window.addEventListener("hashchange", function () {
      if (!hidden_on()) return;
      setTimeout(apply_hidden_menus, 600);
      setTimeout(apply_hidden_menus, 1500);
    });
    if (hidden_on()) {
      hidden_watch_start();
      apply_hidden_menus();
    }
  }

  function fmt_bytes(v) {
    var b = Number(v);
    if (v === undefined || v === null || v === "" || isNaN(b)) return "—";
    var u = ["B", "KB", "MB", "GB", "TB"], i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return b.toFixed(i ? 2 : 0) + " " + u[i];
  }
  function fmt_mbit(v) {
    var b = Number(v);
    if (v === undefined || v === null || v === "" || isNaN(b)) return "—";
    return ((b * 8) / 1e6).toFixed(2) + " Mbit/s";
  }
  function fmt_time(secs) {
    var s = parseInt(secs, 10) || 0;
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
      .map(function (x) { return String(x).padStart(2, "0"); }).join(":");
  }
  function fmt_duration(secs) {
    var s = parseInt(secs, 10);
    if (!s || isNaN(s)) return "—";
    var d = Math.floor(s / 86400); s %= 86400;
    var h = Math.floor(s / 3600); s %= 3600;
    var m = Math.floor(s / 60); s %= 60;
    var p = [];
    if (d) p.push(d + "d");
    if (h) p.push(h + "h");
    if (m) p.push(m + "m");
    if (s || !p.length) p.push(s + "s");
    return p.join(" ");
  }

  var POLL_FAST = [
    { service: "zte_nwinfo_api", method: "nwinfo_get_netinfo" },
    { service: "zwrt_data", method: "get_wwandst", params: { source_module: "web", cid: 1, type: 4 } },
  ];
  var POLL_SLOW = [
    { service: "zwrt_bsp.thermal", method: "get_cpu_temp" },
    { service: "zwrt_mc.device.manager", method: "get_device_info" },
    { service: "zwrt_router.api", method: "router_get_status" },
    UCI_ANT, UCI_ANT_EN,
  ];

  function ubus_cell_dec(v) {
    if (typeof v !== "string") return v;
    var s = v.trim();
    if (!/^(0x)?[0-9a-f]+$/i.test(s)) return v;
    var n = parseInt(s.replace(/^0x/i, ""), 16);
    return isNaN(n) ? v : String(n);
  }
  function ubus_net(d) {
    var o = Object.assign({}, d || {});
    if (o.cell_id !== undefined) o.cell_id = ubus_cell_dec(o.cell_id);
    if (o.nr5g_cell_id !== undefined) o.nr5g_cell_id = ubus_cell_dec(o.nr5g_cell_id);
    return o;
  }

  function poll_once(fastOnly) {
    if (S.poll_inflight) {
      if (!fastOnly) S.poll_follow = "full";
      else if (!S.poll_follow) S.poll_follow = "fast";
      return S.poll_inflight;
    }
    S.poll_inflight = poll_once_now(fastOnly).finally(function () {
      S.poll_inflight = null;
      var follow = S.poll_follow;
      S.poll_follow = null;
      if (follow) return poll_once(follow === "fast");
    });
    return S.poll_inflight;
  }
  async function poll_once_now(fastOnly) {
    var gen = (S.poll_gen = (S.poll_gen || 0) + 1);
    try {
      var res = await ubusRetry(fastOnly ? POLL_FAST : POLL_FAST.concat(POLL_SLOW), { quiet: true }, 2);
      if (gen !== S.poll_gen) return;
      if (res[0].success) S.net = ubus_net(res[0].data);
      if (res[1].success) S.traffic = res[1].data || {};
      if (!fastOnly) {
        if (res[2].success) S.thermal = res[2].data || {};
        if (res[3].success) { S.devinfo = res[3].data || {}; note_router_boot(S.devinfo.device_uptime, ub_rebooting()); }
        if (res[4].success) S.wan = res[4].data || {};
        var v;
        if ((v = uci_values(res[5])) && !S.ant_busy) { S.ant = v; S.ant_err = null; }
        else if (!v && res[5] && !res[5].accessDenied) S.ant_err = res[5].error || "no data";
        if ((v = uci_values(res[6]))) S.ant_en = v;
      }

      var rest = res.length > 1 ? res.slice(1) : res;
      var denied = rest.some(function (r) { return r.accessDenied; }) && rest.every(function (r) { return !r.success; });
      if (denied) {
        set_dot("error");
        if (!(await check_login())) { S.session_lost = true; S.lost_checks = 0; }
        return;
      }
      set_dot(res.every(function (r) { return r.success; }) ? "ok" : "warn");
      schedule_ui();
    } catch (e) {
      set_dot("error");
    }
  }

  async function wait_for_session() {
    if (await check_login()) {
      await wait_page_settled();
      if (S.expired_warned) toast("Logged in again — panel resumed", "ok");
      try { localStorage.removeItem(LS.USER_LOGOUT); } catch (e) { }
      resetSessionFlags();
      S.poll_tick = 0;
      onSessionRestored();
      return;
    }
    S.lost_checks++;
    if (S.lost_checks === 1) S.lost_at = Date.now();
    var userLogout = false;
    try { userLogout = localStorage.getItem(LS.USER_LOGOUT) !== null; } catch (e) { userLogout = false; }
    if (userLogout && Date.now() - ms_since(localStorage, LS.USER_LOGOUT) < (S.lost_at || Date.now()) - LOGOUT_CONFIRM_WINDOW) userLogout = false;
    if (S.lost_checks === 2 && !S.expired_warned && !userLogout) {
      S.expired_warned = true;
      if (reconnect_get())
        toast("Reconnecting mobile data — the session dropped as expected and will come back by itself.", "info", 7000);
      else if (ub_rebooting())
        toast("The router is restarting, as asked — " + (saved_hash() ? "the panel logs in again by itself when it is back." : "log in again once it is back."), "info", 9000);
      else
        toast("Router session ended — log in again on the router page.", "warn");
    }
    if (!S.self_heal_tried && S.lost_checks >= 3 && saved_hash() && !userLogout &&
        (ms_since(sessionStorage, LS.TRIED) > 90000 || job_extra_login(false))) {
      S.self_heal_tried = true;
      if (reconnect_get())
        toast("Reconnecting mobile data — the page may refresh once or twice to log back in. This is normal on this router.", "info", 7000);
      else
        toast("Session lost — reloading to log back in automatically…", "info", 6000);
      setTimeout(function () { location.reload(); }, 1500);
    }
  }

  async function poll_loop() {
    if (S.session_lost) {
      await wait_for_session();
    } else if (!S.pause_poll) {
      await poll_once(S.poll_tick % CFG.slowPollEvery !== 0);
      S.poll_tick++;
    }
    setTimeout(poll_loop, S.session_lost ? CFG.loginWaitInterval : CFG.pollInterval);
  }

  function set_dot(st) {
    var e = zel("zte_status_dot");
    if (!e) return;
    e.style.background = { ok: "#4CAF50", error: "#D32F2F", warn: "#F57C00" }[st] || "#78909C";
    if (st === "ok") e.title = "Connected — " + new Date().toLocaleTimeString();
  }

  function row(label, value, cls) {
    return '<div class="zte_row"><span class="zte_label">' + label + '</span><span class="zte_value' +
      (cls ? " " + cls : "") + '">' + esc(dash(value)) + "</span></div>";
  }

  function cell_card(kind, c, idx, total) {
    var isNr = kind === "nr";
    var title = (isNr ? "5G " : "LTE ") + (idx === 0 ? "PCell" : "SCell #" + idx) + " — " +
      (c.band ? (isNr ? "n" : "B") + c.band : "??");
    var flags =
      '<span style="font-size:10px;font-weight:400;color:#78909C;margin-left:6px;">UL ' + (c.ul ? "✓" : "✗") +
      " · " + (c.active ? '<span style="color:#2E7D32">active</span>' : '<span style="color:#C62828">inactive</span>') +
      "</span>";
    var cls = "zte_cell_card " + kind + (isNr && idx > 0 ? " nr_ca_scell" : "") + (isNr && idx === 0 && total > 1 ? " nr_ca_pcell" : "");
    return (
      '<div class="' + cls + '"><h4>' + esc(title) + flags + "</h4>" +
      '<div class="zte_grid2"><div>' +
      row("RSRP", c.rsrp === null ? null : c.rsrp + " dBm", rsrp_cls(c.rsrp)) +
      row("RSRQ", c.rsrq === null ? null : c.rsrq + " dB") +
      row("SINR", c.sinr === null ? null : c.sinr + " dB", sinr_cls(c.sinr)) +
      row("RSSI", c.rssi === null ? null : c.rssi + " dBm") +
      "</div><div>" +
      row(isNr ? "ARFCN" : "EARFCN", isNaN(isNr ? c.arfcn : c.earfcn) ? null : isNr ? c.arfcn : c.earfcn) +
      row("PCI", isNaN(c.pci) ? null : c.pci) +
      row("BW", c.bandwidth ? c.bandwidth + " MHz" : null) +
      row("Freq", c.freq ? c.freq + " MHz" : null) +
      "</div></div></div>"
    );
  }

  var _ui_raf = 0;
  function schedule_ui() {
    if (_ui_raf) return;
    _ui_raf = requestAnimationFrame(function () {
      _ui_raf = 0;
      update_ui();
    });
  }

  function update_ui() {
    var d = S.net;
    var f = net_flags(d.network_type);
    S.lte = parse_lte_cells(d);
    S.nr = parse_nr_cells(d);
    var lte = f.is_lte ? S.lte : [];
    var nr = f.show_nr ? S.nr : [];

    var nt = d.network_type || "—";
    zset("network_type", f.is_sa ? "5G SA" : f.is_nsa ? "5G NSA" + (nt === "LTE-NSA" ? " (LTE-NSA)" : " (EN-DC)") : nt);
    zset("network_provider_fullname", d.network_provider_fullname || "—");
    zset("__bandinfo", band_info(lte, nr) || "—");
    var bw = 0;
    lte.concat(nr).forEach(function (c) { if (c.bandwidth) bw += c.bandwidth; });
    zset("zte_total_bw", bw ? bw + " MHz" : "—");

    ztoggle("lte_ca_active_tr", f.is_lte);
    zhtml("ca_active", lte.length > 1
      ? '<span style="color:#1976D2;font-weight:700">&#10003; ' + lte.length + "× LTE</span>"
      : '<span style="color:#78909C">&#10005;</span>');
    ztoggle("nr_ca_active_tr", f.show_nr);
    var nrb = function (c) { return c && c.band ? "n" + c.band : "?"; };
    zhtml("nr_ca_active", nr.length > 1
      ? '<span style="color:#7B1FA2;font-weight:700">&#10003; ' + nr.length + "× NR (" +
        esc(nr.map(nrb).join(" + ")) + ")</span>"
      : '<span style="color:#78909C">&#10005; (' + esc(nr[0] && nr[0].band ? nrb(nr[0]) : "—") + ")</span>");

    var enb = f.is_lte ? split_cell_id(d.cell_id) : null;
    ztoggle("zte_enodeb_row", !!enb);
    if (enb) zhtml("zte_enodeb_val", esc(enb.node) + ' <span style="font-size:10px;color:#78909C;font-weight:400">(0x' +
      enb.node.toString(16).toUpperCase() + ") · sector " + enb.sector + "</span>");
    var gnb = split_cell_id(d.nr5g_cell_id);
    ztoggle("zte_gnodeb_row", !!gnb && f.show_nr);
    if (gnb) zhtml("zte_gnodeb_val", esc(gnb.node) + ' <span style="font-size:10px;color:#78909C;font-weight:400">(0x' +
      gnb.node.toString(16).toUpperCase() + ") · sector " + gnb.sector + "</span>");

    var cid = parse_cell_id(d.cell_id) !== null ? d.cell_id : "", ncid = parse_cell_id(d.nr5g_cell_id) !== null ? d.nr5g_cell_id : "";
    zset("cell_id", cid || "—");
    ztoggle("cell", !!cid && f.is_lte);
    zset("nr5g_cell_id", ncid || "—");
    ztoggle("5g_cell", !!ncid && f.show_nr);
    zset("wan_ipaddr", S.wan.mwan_wanlan1_wan_ipaddr || "—");
    ztoggle("wanipinfo", !!S.wan.mwan_wanlan1_wan_ipaddr);

    var mcc = d.rmcc || d.mcc, mnc = d.rmnc || d.mnc;
    ztoggle("zte_mccmnc_row", !!(mcc && mnc));
    if (mcc && mnc) zset("zte_mccmnc", mcc + "-" + mnc);

    var t = S.thermal && S.thermal.cpuss_temp;
    var hasT = t !== undefined && t !== null && t !== "";
    ztoggle("temperature", hasT);
    zset("temps", hasT ? "CPU: " + t + "°C" : "—");

    update_session_info();

    Object.keys(NET_MODES).forEach(function (m) {
      var b = zel("zte_mode_" + m);
      if (b) b.classList.toggle("active", d.net_select === m);
    });

    var ll = d.lock_lte_cell && d.lock_lte_cell.trim() !== "" && d.lock_lte_cell !== "0,0";
    var nl = !nr_cell_unlocked(d.lock_nr_cell);
    ztoggle("zte_lock_row", ll || nl);
    zhtml("zte_lock_status", '<span style="color:#D32F2F;">' +
      [ll ? "🔒 LTE " + esc(d.lock_lte_cell) : "", nl ? "🔒 5G " + esc(d.lock_nr_cell) : ""].filter(Boolean).join("<br>") + "</span>");
    zhtml("zte_cell_lock_state",
      "LTE: " + (ll ? '<b style="color:#D32F2F">' + esc(d.lock_lte_cell) + "</b>" : '<span style="color:#78909C">unlocked</span>') +
      " &nbsp;·&nbsp; 5G: " + (nl ? '<b style="color:#D32F2F">' + esc(d.lock_nr_cell) + "</b>" : '<span style="color:#78909C">unlocked</span>'));

    var bandsWait = !S.bands_loaded && !S.bands_gave_up;
    var lb = d.lte_band_lock ? lte_bands_from_mask(d.lte_band_lock) : null;
    var allLte = lte_avail_in_mask().every(function (b) { return lb && lb.indexOf(Number(b)) > -1; });
    var ll2 = band_list(d.lte_band).map(Number);
    if (ll2.length && lb && lte_sets_equal(ll2.filter(function (b) { return b <= LTE_MASK_MAX_BAND; }).map(String), lb.map(String))) {
      lb = ll2;
      allLte = lte_avail().every(function (b) { return lb.indexOf(Number(b)) > -1; });
    }
    if (bandsWait) allLte = true;
    zhtml("zte_lte_band_lock_status", bandsWait
      ? '<span style="color:#78909C;">reading…</span>'
      : !lb || !lb.length || allLte
      ? '<span style="color:#78909C;">Unlocked</span>'
      : '<span style="color:#E65100;">🔒 B' + lb.join(" + B") + "</span>");

    var nrFields = nr_lock_fields(d);
    var nrTip = Object.keys(nrFields).map(function (k) { return k + "=" + (nrFields[k] || "(empty)"); }).join("\n");
    var saL = nr_locked_list(d.nr5g_sa_band_lock, "sa"), nsaL = nr_locked_list(d.nr5g_nsa_band_lock, "nsa");
    var nrTxt = "";
    if (saL && nsaL && saL.join() === nsaL.join()) nrTxt = "n" + saL.join(" + n");
    else nrTxt = [saL ? "SA n" + saL.join(" + n") : "", nsaL ? "NSA n" + nsaL.join(" + n") : ""].filter(Boolean).join(" · ");
    if (nrTxt && !S.bands_loaded && !S.bands_gave_up) nrTxt = "";
    var nrWait = !S.bands_loaded && !S.bands_gave_up;
    zhtml("zte_nr_band_lock_status", nrWait
      ? '<span style="color:#78909C;" title="' + esc(nrTip) + '">reading…</span>'
      : nrTxt
      ? '<span style="color:#E65100;" title="' + esc(nrTip) + '">🔒 ' + esc(nrTxt) + "</span>"
      : '<span style="color:#78909C;" title="' + esc(nrTip) + '">Unlocked</span>');

    var sumBands = [];
    if (lb && lb.length && !allLte) sumBands.push("B" + lb.join("+B"));
    if (nrTxt) sumBands.push(nrTxt.replace(/ \+ /g, "+"));
    var sumCells = [ll ? "LTE" : "", nl ? "5G" : ""].filter(Boolean);
    var sumParts = [];
    if (sumBands.length) sumParts.push('<span style="color:#E65100;">' + esc(sumBands.join(" · ")) + "</span>");
    if (sumCells.length) sumParts.push('<span style="color:#D32F2F;">cell ' + sumCells.join("+") + "</span>");
    zhtml("zte_rf_sum", sumParts.length
      ? "🔒 " + sumParts.join(' <span style="color:#90A4AE;">·</span> ')
      : nrWait ? '<span style="color:#78909C;">reading…</span>'
      : '<span style="color:#78909C;">Unlocked</span>');
    var sumEl = zel("zte_rf_sum");
    if (sumEl && sumEl.title !== sumEl.textContent) sumEl.title = sumEl.textContent;

    zhtml("zte_lte_cards", lte.length
      ? lte.map(function (c, i) { return cell_card("lte", c, i, lte.length); }).join("")
      : '<div style="color:#78909C;font-size:11px;margin-bottom:6px;">No LTE cells</div>');
    zhtml("zte_nr_cards", nr.length
      ? nr.map(function (c, i) { return cell_card("nr", c, i, nr.length); }).join("")
      : '<div style="color:#78909C;font-size:11px;margin-bottom:6px;">No 5G cells</div>');

    update_traffic();
    update_device();
    render_antenna();
    render_gnss();
    if (S.qos_ok || S.tr069_ok) render_dev_sec();
  }

  function update_session_info() {
    zset("zte_session_info", fmt_time(parseInt(S.traffic.real_time, 10) || 0));
  }

  function update_traffic() {
    var t = S.traffic;
    zset("zte_rx_speed", fmt_mbit(t.real_rx_speed));
    zset("zte_tx_speed", fmt_mbit(t.real_tx_speed));
    zset("zte_sess_time", fmt_time(t.real_time));
    zset("zte_sess_rx", fmt_bytes(t.real_rx_bytes));
    zset("zte_sess_tx", fmt_bytes(t.real_tx_bytes));
    zset("zte_sess_total", fmt_bytes((Number(t.real_rx_bytes) || 0) + (Number(t.real_tx_bytes) || 0)));
    zset("zte_month_rx", fmt_bytes(t.month_rx_bytes));
    zset("zte_month_tx", fmt_bytes(t.month_tx_bytes));
    zset("zte_month_total", fmt_bytes((Number(t.month_rx_bytes) || 0) + (Number(t.month_tx_bytes) || 0)));
    zset("zte_month_time", fmt_duration(t.month_time));
    zset("zte_total_rx", fmt_bytes(t.total_rx_bytes));
    zset("zte_total_tx", fmt_bytes(t.total_tx_bytes));
    zset("zte_total_time", fmt_duration(t.total_time));
  }

  var BOOT_NOTICE_MAX = 600;
  function note_router_boot(up, quiet) {
    up = parseInt(up, 10);
    if (isNaN(up) || up < 0) return;
    var boot = Date.now() - up * 1000;
    if (!S.boot_logged) { S.boot_logged = true; }
    var seen = 0;
    try { seen = Number(localStorage.getItem(LS.BOOT_SEEN)) || 0; } catch (e) { }
    if (Math.abs(boot - seen) < 90000) return;
    try { localStorage.setItem(LS.BOOT_SEEN, String(boot)); } catch (e) { }
    if (up <= BOOT_NOTICE_MAX && !quiet) {
      toast("The router restarted " + fmt_duration(up) + " ago.", "warn", 9000);
    }
  }

  function update_device() {
    var dv = S.devinfo, w = S.wan, h = "";
    var t = S.thermal && S.thermal.cpuss_temp;
    h += row("CPU Temp", t !== undefined && t !== null && t !== "" ? t + " °C" : null);
    if (Array.isArray(dv.cpuinfo)) {
      var loads = dv.cpuinfo.filter(function (c) { return c.name !== "all"; }).map(function (c) {
        return Math.round(100 - (parseFloat(c.idle) || 0)) + "%";
      });
      if (loads.length) h += row("CPU Load (per core)", loads.join(" · "));
    }
    if (dv.meminfo) {
      var tot = parseInt(dv.meminfo.total, 10), av = parseInt(dv.meminfo.avaliable, 10);
      if (tot > 0 && !isNaN(av)) {
        var used = tot - av;
        h += row("Memory", (used / 1024).toFixed(0) + " / " + (tot / 1024).toFixed(0) + " MB (" + Math.round((used / tot) * 100) + "%)");
      }
    }
    if (dv.device_uptime) h += row("Uptime", fmt_duration(dv.device_uptime));
    zhtml("zte_dev_system", h);

    var wh = "";
    if (w.opms_wan_mode) wh += row("Operation mode", (OP_MODES[w.opms_wan_mode] || w.opms_wan_mode) + " (" + w.opms_wan_mode + ")");
    zset("zte_opmode", w.opms_wan_mode ? (OP_MODES[w.opms_wan_mode] || w.opms_wan_mode) : "unknown");
    wh += row("Mode", w.mwan_wanlan1_link_mode);
    wh += row("Status", w.mwan_wanlan1_status);
    wh += row("IPv4", w.mwan_wanlan1_wan_ipaddr);
    wh += row("Netmask", w.mwan_wanlan1_wan_netmask);
    wh += row("Gateway", w.mwan_wanlan1_wan_gateway);
    wh += row("DNS", [w.mwan_wanlan1_prefer_dns_auto, w.mwan_wanlan1_standby_dns_auto].filter(Boolean).join(", "));
    if (w.mwan_wanlan1_ipv6_wan_ipaddr && w.mwan_wanlan1_ipv6_wan_ipaddr !== "0::0") {
      wh += row("IPv6", w.mwan_wanlan1_ipv6_wan_ipaddr);
      wh += row("IPv6 Gateway", w.mwan_wanlan1_ipv6_wan_gateway);
      wh += row("IPv6 DNS", [w.mwan_wanlan1_ipv6_prefer_dns_auto, w.mwan_wanlan1_ipv6_standby_dns_auto].filter(Boolean).join(", "));
    }
    zhtml("zte_dev_wan", wh);
  }

  function inject_css() {
    if (zel("zte_tm_style")) return;
    var s = document.createElement("style");
    s.id = "zte_tm_style";
    s.textContent = [
      "#zte_panel{position:fixed;top:12px;left:12px;z-index:2147483646;width:454px;max-width:calc(100vw - 24px);max-height:94vh;",
      "background:#FFFFFF;color:#37474F;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);",
      'font-family:"Segoe UI",Verdana,sans-serif;font-size:12px;border:1px solid #B0BEC5;display:flex;flex-direction:column;}',
      "#zte_panel *,#zte_modal *{box-sizing:border-box;}",
      "@media (max-width:480px){#zte_panel{left:8px !important;right:8px !important;width:auto !important;max-width:none !important;max-height:90vh !important;} #zte_panel.minimized{left:auto !important; width:max-content !important;} #zte_panel.minimized #zte_hdr{gap:8px;} #zte_panel.minimized .zte_hdr_btns button:not(#zte_min_btn){display:none;} #zte_hdr h2{font-size:12px;}}",
      ".zte_unhidden{outline:1px dashed #F9A825 !important;outline-offset:-1px;}",
      "#zte_hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;",
      "background:linear-gradient(135deg,#1976D2,#1565C0);border-radius:12px 12px 0 0;cursor:move;user-select:none;flex-shrink:0;}",
      "#zte_hdr h2{margin:0;font-size:13px;font-weight:700;color:#FFFFFF;letter-spacing:.5px;}",
      "#zte_status_dot{width:10px;height:10px;border-radius:50%;background:#78909C;display:inline-block;margin-right:6px;transition:background .5s;}",
      ".zte_hdr_btns{display:flex;gap:4px;}",
      ".zte_icon_btn{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#FFFFFF;cursor:pointer;font-size:13px;",
      "padding:2px 7px;border-radius:5px;line-height:1;font-family:inherit;}",
      ".zte_icon_btn:hover{background:rgba(255,255,255,.3);}",
      "#zte_body{padding:8px;background:#FAFAFA;overflow-y:auto;flex:1;scrollbar-width:thin;scrollbar-color:#90A4AE #E3F2FD;}",
      "#zte_panel .zte_value,#zte_panel td,#zte_panel .zte_label,#zte_modal .zte_value{user-select:text;-webkit-user-select:text;}",
      ".zte_sec{background:#FFFFFF;border-radius:8px;padding:8px 10px;margin-bottom:8px;border:1px solid #E0E0E0;box-shadow:0 1px 3px rgba(0,0,0,.05);}",
      ".zte_sec_title{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#1976D2;margin-bottom:6px;font-weight:700;}",
      ".zte_grp{background:#F1F7FE;border:1px solid #BBDEFB;border-radius:10px;overflow:hidden;margin-bottom:10px;}",
      ".zte_grp_title{display:flex;align-items:center;gap:12px;position:relative;background:#E3F2FD;border-bottom:1px solid #BBDEFB;color:#0D47A1;" +
        "font-size:11px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;padding:8px 30px 8px 11px;}",
      ".zte_grp_name{flex:none;}",
      ".zte_grp_body{padding:8px 8px 0;}",
      ".zte_grp_fold > .zte_grp_title{cursor:pointer;}",
      ".zte_grp_fold > .zte_grp_title::after{content:'\\25BE';position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#1976D2;font-size:11px;}",
      ".zte_grp_closed > .zte_grp_title::after{content:'\\25B8';}",
      ".zte_grp_closed > .zte_grp_title{border-bottom:none;}",
      ".zte_grp_closed > .zte_grp_body{display:none;}",
      ".zte_grp_sum{flex:1;min-width:0;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px;font-weight:700;letter-spacing:0;text-transform:none;}",
      ".zte_grp:not(.zte_grp_closed) .zte_grp_sum{display:none;}",
      ".zte_sec.zte_collapsible > :first-child{cursor:pointer;position:relative;padding-right:16px;}",
      ".zte_sec.zte_collapsible > :first-child::after{content:'\\25BE';position:absolute;right:0;top:50%;transform:translateY(-50%);color:#90A4AE;font-size:10px;font-weight:700;}",
      ".zte_sec.zte_collapsed > :first-child::after{content:'\\25B8';}",
      ".zte_sec.zte_collapsed > :first-child{margin-bottom:0;}",
      ".zte_sec.zte_collapsed > :not(:first-child){display:none !important;}",
      ".zte_sub{font-size:10px;color:#1976D2;font-weight:700;margin:6px 0 3px;}",
      ".zte_row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid #ECEFF1;}",
      ".zte_row:last-child{border-bottom:none;}",
      ".zte_label{color:#78909C;font-size:11px;flex-shrink:0;}",
      ".zte_value{color:#37474F;font-weight:600;font-size:11px;text-align:right;word-break:break-all;}",
      ".zte_value.good{color:#2E7D32!important;}.zte_value.warn{color:#F57C00!important;}.zte_value.bad{color:#C62828!important;}",
      ".zte_enodeb{color:#7B1FA2!important;font-size:14px!important;font-weight:900!important;}",
      ".zte_cell_card{background:#F5F5F5;border-radius:6px;padding:7px 9px;margin-bottom:6px;border-left:3px solid #1976D2;}",
      ".zte_cell_card.nr{border-left-color:#2E7D32;}",
      ".zte_cell_card.nr.nr_ca_pcell{border-left-color:#7B1FA2;}",
      ".zte_cell_card.nr.nr_ca_scell{border-left-color:#9C27B0;}",
      ".zte_cell_card h4{margin:0 0 5px;font-size:11px;color:#1565C0;font-weight:700;}",
      ".zte_grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 10px;}",
      ".zte_btn_grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:5px;}",
      ".zte_btn{background:#FFFFFF;border:1px solid #B0BEC5;color:#37474F;border-radius:6px;padding:6px 8px;",
      "cursor:pointer;font-size:11px;text-align:center;transition:background .2s,border-color .2s;font-family:inherit;}",
      ".zte_btn:hover{background:#E3F2FD;border-color:#1976D2;color:#1976D2;}",
      "#zte_panel .zte_btn.active{background:#1976D2 !important;border-color:#1976D2 !important;color:#FFFFFF !important;font-weight:700;}",
      ".zte_btn.danger:hover{border-color:#C62828;color:#C62828;background:#FFEBEE;}",
      ".zte_btn.ok:hover{border-color:#2E7D32;color:#2E7D32;background:#E8F5E9;}",
      ".zte_btn.warn:hover{border-color:#E65100;color:#E65100;background:#FFF3E0;}",
      ".zte_btn.full{grid-column:1/-1;}",
      ".zte_bandrow{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;}",
      ".zte_chip{background:#E3F2FD;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;",
      "border:1px solid #BBDEFB;transition:all .2s;color:#1565C0;}",
      ".zte_chip:hover{background:#1976D2;border-color:#1976D2;color:#FFFFFF;}",
      "#zte_scan_panel table{width:100%;border-collapse:collapse;font-size:11px;}",
      "#zte_scan_panel th{color:#78909C;font-size:10px;font-weight:600;padding:3px 5px;border-bottom:1px solid #E0E0E0;text-align:left;}",
      "#zte_scan_panel td{padding:3px 5px;border-bottom:1px solid #ECEFF1;}",
      "#zte_scan_panel tr:hover td{background:#E3F2FD;}",
      "#zte_footer{text-align:center;color:#90A4AE;font-size:10px;padding:6px 12px 5px;background:#FAFAFA;flex-shrink:0;border-radius:0 0 12px 12px;}",
      "#zte_modal{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483647;display:flex;align-items:center;justify-content:center;",
      'font-family:"Segoe UI",Verdana,sans-serif;font-size:12px;color:#37474F;}',
      ".zte_modal_box{background:#FAFAFA;border-radius:12px;width:560px;max-width:94vw;max-height:84vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.3);}",
      ".zte_modal_hdr{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;color:#fff;font-weight:700;font-size:13px;",
      "background:linear-gradient(135deg,#1976D2,#1565C0);border-radius:12px 12px 0 0;}",
      ".zte_modal_body{padding:10px;overflow-y:auto;}",
      ".zte_select{max-width:62%;padding:3px 6px;border:1px solid #B0BEC5;border-radius:6px;font-size:11px;background:#fff;color:#37474F;font-family:inherit;cursor:pointer;}",
    ].join("");
    document.head.appendChild(s);
  }

  function btn(label, fn, cls) {
    return '<button class="zte_btn' + (cls ? " " + cls : "") + '" onclick="' + fn + '">' + label + "</button>";
  }
  function grp_open(name, foldable, extra) {
    return '<div class="zte_grp' + (foldable ? " zte_grp_fold" : "") + '"><div class="zte_grp_title"><span class="zte_grp_name">' + name + "</span>" +
      (extra || "") + '</div><div class="zte_grp_body">';
  }
  var GRP_CLOSE = "</div></div>";
  function chip(label, fn) {
    return '<span class="zte_chip" onclick="' + fn + '">' + label + "</span>";
  }
  function vrow(label, id, extraCls, rowId, hidden) {
    return '<div class="zte_row"' + (rowId ? ' id="' + rowId + '"' : "") + (hidden ? ' style="display:none"' : "") +
      '><span class="zte_label">' + label + '</span><span class="zte_value' + (extraCls ? " " + extraCls : "") +
      '" id="' + id + '">—</span></div>';
  }

  function inject_html() {
    if (zel("zte_panel")) return;
    inject_css();
    copy_fix_install();

    var panel = document.createElement("div");
    panel.id = "zte_panel";
    panel.innerHTML =
      '<div id="zte_hdr">' +
      '<h2><span id="zte_status_dot"></span>ZTE Advanced Router Panel NG Lite</h2>' +
      '<div class="zte_hdr_btns">' +
      '<button class="zte_icon_btn" onclick="window.zte_test_connection()" title="Test connection">⚡</button>' +
      '<button class="zte_icon_btn" id="zte_min_btn" title="Minimize">−</button>' +
      "</div></div>" +
      '<div id="zte_body">' +
      grp_open("Dashboard", false) +
      '<div class="zte_sec zte_fixed"><div class="zte_sec_title">Network</div>' +
      vrow("Provider", "network_provider_fullname") +
      vrow("Type", "network_type") +
      vrow("Bands", "__bandinfo") +
      vrow("Total BW", "zte_total_bw") +
      vrow("LTE CA", "ca_active", "", "lte_ca_active_tr", true) +
      vrow("5G NR CA", "nr_ca_active", "", "nr_ca_active_tr", true) +
      vrow("eNodeB (BTS)", "zte_enodeb_val", "zte_enodeb", "zte_enodeb_row", true) +
      vrow("gNodeB (5G)", "zte_gnodeb_val", "zte_enodeb", "zte_gnodeb_row", true) +
      vrow("Cell ID", "cell_id", "", "cell", true) +
      vrow("5G Cell ID", "nr5g_cell_id", "", "5g_cell", true) +
      vrow("WAN IP", "wan_ipaddr", "", "wanipinfo", true) +
      vrow("Temp", "temps", "", "temperature", true) +
      vrow("MCC-MNC", "zte_mccmnc", "", "zte_mccmnc_row", true) +
      vrow("Session", "zte_session_info") +
      vrow("Cell Lock", "zte_lock_status", "", "zte_lock_row", true) +
      "</div>" +
      '<div class="zte_sec zte_fixed"><div class="zte_sec_title">Signal</div>' +
      '<div id="zte_lte_cards"></div><div id="zte_nr_cards"></div>' +
      '<div class="zte_btn_grid" style="margin-top:6px;">' + btn("📋 Copy Signal", "window.zte_copy_signal()", "ok full") + "</div>" +
      "</div>" +
      '<div class="zte_sec"><div class="zte_sec_title">Traffic Statistics</div>' +
      vrow("⬇ Download", "zte_rx_speed") +
      vrow("⬆ Upload", "zte_tx_speed") +
      '<div class="zte_sub">Current Session</div>' +
      vrow("Duration", "zte_sess_time") +
      vrow("Received", "zte_sess_rx") +
      vrow("Sent", "zte_sess_tx") +
      vrow("Total session", "zte_sess_total") +
      '<div class="zte_sub">Monthly</div>' +
      vrow("Received", "zte_month_rx") +
      vrow("Sent", "zte_month_tx") +
      vrow("Total month", "zte_month_total") +
      vrow("Connected time", "zte_month_time") +
      '<div class="zte_sub">All Time</div>' +
      vrow("Received", "zte_total_rx") +
      vrow("Sent", "zte_total_tx") +
      vrow("Connected time", "zte_total_time") +
      '<div class="zte_btn_grid" style="margin-top:8px;">' +
      btn("↺ Reset monthly counters", "window.zte_reset_traffic()", "danger") +
      btn("📅 Auto reset day…", "window.zte_traffic_clearday()") +
      "</div>" +
      "</div>" +
      '<div class="zte_sec"><div class="zte_sec_title">Device Info</div>' +
      '<div class="zte_sub" style="margin-top:0">System</div><div id="zte_dev_system"></div>' +
      '<div class="zte_sub">WAN</div><div id="zte_dev_wan"></div>' +
      '<div class="zte_btn_grid">' +
      btn("📶 SIM Info", "window.zte_sim_info()") +
      btn("ℹ️ HW / SW Version", "window.zte_hw_sw_info()") +
      btn("✉ SMS Storage", "window.zte_wms_info()") +
      btn("📡 APN", "window.zte_apn_info()") +
      "</div></div>" +
      '<div class="zte_sec" id="zte_gnss_wrap"><div class="zte_sec_title">GPS</div>' +
      vrow("GPS", "zte_gnss_status") +
      '<div id="zte_gnss_data" style="display:none;">' +
      '<div id="zte_dev_gps_wrap" style="display:none;"><div class="zte_sub">Position</div><div id="zte_dev_gps"></div></div>' +
      "</div>" +
      '<div class="zte_btn_grid">' +
      '<button class="zte_btn full" id="zte_gnss_refresh_btn" onclick="window.zte_gps_refresh()">🛰 Refresh position</button>' +
      "</div></div>" +
      GRP_CLOSE +
      grp_open("RF Tuning &amp; Locks", true, '<span class="zte_grp_sum" id="zte_rf_sum"></span>') +
      '<div class="zte_sec"><div class="zte_sec_title">Network Mode</div><div class="zte_btn_grid">' +
      Object.keys(NET_MODES).map(function (m) {
        return '<button class="zte_btn" id="zte_mode_' + m + "\" onclick=\"window.zte_set_net_mode('" + m + "')\">" + NET_MODES[m] + "</button>";
      }).join("") +
      "</div></div>" +
      '<div class="zte_sec" id="zte_ant_sec" style="display:none;"><div class="zte_sec_title">ODU Antenna Selection</div>' +
      '<div class="zte_row"><span class="zte_label">Method</span>' +
      '<select id="zte_ant_sel" class="zte_select" onchange="window.zte_set_antenna(this.value)">' +
      ANT_MODES.map(function (m) { return '<option value="' + esc(m.v) + '">' + esc(ant_text(m)) + "</option>"; }).join("") +
      "</select></div>" +
      '<div id="zte_ant_src" style="font-size:9px;color:#B0BEC5;text-align:right;margin-top:-2px;">—</div>' +
      vrow("In use", "zte_ant_cur") +
      vrow("Auto-selection switch", "zte_ant_sw") +
      '<div style="font-size:10px;color:#78909C;margin-top:5px;">ZTE: for debugging; in normal use keep <b>Automatic switching</b>. ' +
      "A change may ask for the router password (developer session) and lasts until reboot.</div>" +
      '<div class="zte_btn_grid">' + btn("↻ Refresh antenna", "window.zte_antenna_refresh()", "full") + "</div>" +
      "</div>" +
      '<div class="zte_sec">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
      '<span class="zte_sec_title" style="margin-bottom:0;white-space:nowrap;flex-shrink:0;">LTE Bands</span>' +
      '<span style="font-size:10px;text-align:right;min-width:0;margin-left:10px;overflow-wrap:anywhere;">Lock: <span id="zte_lte_band_lock_status" style="font-weight:700">—</span></span></div>' +
      '<div id="zte_lte_chips">' + band_chips("lte") + "</div>" +
      '<button class="zte_btn danger" style="width:100%;margin-top:7px;" onclick="window.zte_lte_band_unlock()">🔓 Remove LTE Band Lock</button>' +
      '<div style="font-size:10px;color:#78909C;margin-top:6px;overflow-wrap:anywhere;">Supported bands: <span id="zte_lte_supported">reading…</span></div>' +
      "</div>" +
      '<div class="zte_sec">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
      '<span class="zte_sec_title" style="margin-bottom:0;white-space:nowrap;flex-shrink:0;">5G Bands (NR)</span>' +
      '<span style="font-size:10px;text-align:right;min-width:0;margin-left:10px;overflow-wrap:anywhere;">Lock: <span id="zte_nr_band_lock_status" style="font-weight:700">—</span></span></div>' +
      '<div id="zte_nr_chips">' + band_chips("nr") + "</div>" +
      '<button class="zte_btn danger" style="width:100%;margin-top:7px;" onclick="window.zte_nr_band_unlock()">🔓 Remove NR Band Lock</button>' +
      '<div style="font-size:10px;color:#78909C;margin-top:6px;overflow-wrap:anywhere;">Supported bands: <span id="zte_nr_supported">reading…</span></div>' +
      "</div>" +
      '<div class="zte_sec"><div class="zte_sec_title">Band Lock — Global Reset</div>' +
      '<button class="zte_btn danger" style="width:100%;" onclick="window.zte_unlock_all_bands()">🔓 Remove ALL Band Locks (LTE + NR)</button></div>' +
      '<div class="zte_sec"><div class="zte_sec_title">Neighbor Scan &amp; Force Connect</div>' +
      '<div style="font-size:10px;color:#78909C;margin-bottom:6px;">Uses the router\'s built-in scan (~30 s). ' +
      'Mobile data is off while it scans; the panel turns it back on. "Lock" applies a cell lock on that PCI + EARFCN.</div>' +
      '<button class="zte_btn ok" style="width:100%;" onclick="window.zte_nbr_scan()">🔍 Start Scan</button>' +
      '<div id="zte_scan_panel" style="display:none;margin-top:8px;">' +
      '<div id="zte_scan_status" style="color:#1976D2;font-size:11px;margin-bottom:6px;">—</div>' +
      '<div style="overflow-x:auto;"><table><thead><tr>' +
      "<th>Type</th><th>Band</th><th>RSRP</th><th>RSRQ</th><th>SINR</th><th>PCI</th><th>(E)ARFCN</th><th></th>" +
      '</tr></thead><tbody id="zte_scan_tbody"></tbody></table></div>' +
      "</div></div>" +
      '<div class="zte_sec"><div class="zte_sec_title">Cell Lock</div>' +
      '<div style="font-size:10px;color:#78909C;margin-bottom:4px;" id="zte_cell_lock_state">—</div>' +
      '<div style="font-size:10px;color:#78909C;margin-bottom:6px;">Prompts are prefilled with the current cell. The panel says when a lock needs a network-mode switch or a restart to apply.</div>' +
      '<div class="zte_btn_grid">' +
      btn("🔒 LTE Lock", "window.zte_lte_cell_lock(false)") +
      btn("🔓 LTE Unlock", "window.zte_lte_cell_lock(true)", "danger") +
      btn("🔒 5G Lock", "window.zte_nr_cell_lock(false)") +
      btn("🔓 5G Unlock", "window.zte_nr_cell_lock(true)", "danger") +
      btn("♻ Reset ALL band & cell locks (firmware)", "window.zte_reset_band_cell()", "danger full") +
      "</div></div>" +
      GRP_CLOSE +
      grp_open("Router Settings", true) +
      '<div class="zte_sec"><div class="zte_sec_title">Connection</div><div class="zte_btn_grid">' +
      btn("🔀 Reconnect data (off/on)", "window.zte_wan_reconnect()", "warn") +
      btn("🌐 DNS settings", "window.zte_dns()") +
      btn("🌉 Bridge mode ON", "window.zte_bridge_mode(true)", "warn") +
      btn("📶 Router mode (bridge OFF)", "window.zte_bridge_mode(false)") +
      '<div style="grid-column:1/-1;font-size:10px;color:#78909C;text-align:center;">Operation mode: <b id="zte_opmode">—</b></div>' +
      btn("🧩 ARP Proxy ON", "window.zte_arp_proxy(true)") +
      btn("🧩 ARP Proxy OFF", "window.zte_arp_proxy(false)", "danger") +
      '<div style="grid-column:1/-1;font-size:10px;color:#78909C;text-align:center;">ARP proxy: <b id="zte_arp_state">—</b> <span style="color:#B0BEC5;">(default: off)</span></div>' +
      btn("🔄 Reboot Router", "window.zte_reboot()", "danger full") +
      "</div></div>" +
      '<div class="zte_sec" id="zte_dev_sec" style="display:none;"><div class="zte_sec_title">Remote Management &amp; QoS</div>' +
      '<div class="zte_row" id="zte_qos_row" style="display:none;"><span class="zte_label">QoS (speed limit)</span>' +
      '<span class="zte_value" id="zte_qos_state">\u2014</span></div>' +
      '<div class="zte_btn_grid" id="zte_qos_btns" style="display:none;margin-bottom:6px;">' +
      '<button class="zte_btn ok" id="zte_qos_on_btn" onclick="window.zte_qos(true)">\u2191\u2193 On\u2026</button>' +
      '<button class="zte_btn danger" id="zte_qos_off_btn" onclick="window.zte_qos(false)">\u2191\u2193 Off</button>' +
      '<div style="grid-column:1/-1;font-size:10px;color:#78909C;">Global upload/download cap. "On" asks for the limits.</div></div>' +
      '<div class="zte_row" id="zte_qos_prof_row" style="display:none;"><span class="zte_label">QoS profile</span>' +
      '<span class="zte_value"><select id="zte_qos_profile" onchange="window.zte_qos_profile(this.value)" ' +
      'style="font-size:11px;padding:2px 4px;border:1px solid #B0BEC5;border-radius:4px;background:#fff;color:#37474F;"></select></span></div>' +
      '<div class="zte_row" id="zte_tr069_row" style="display:none;"><span class="zte_label">TR-069 (remote mgmt)</span>' +
      '<span class="zte_value" id="zte_tr069_state">\u2014</span></div>' +
      '<div id="zte_tr069_btns" style="display:none;">' +
      '<div style="font-size:10px;color:#78909C;margin:2px 0;">TR-069 / CWMP (master)</div>' +
      '<div class="zte_btn_grid">' +
      '<button class="zte_btn ok" id="zte_tr069_on_btn" onclick="window.zte_tr069(true)">\ud83c\udf10 On</button>' +
      '<button class="zte_btn danger" id="zte_tr069_off_btn" onclick="window.zte_tr069(false)">\ud83c\udf10 Off</button>' +
      "</div>" +
      '<div style="font-size:10px;color:#78909C;margin:6px 0 2px;">Periodic inform (reports to the ACS)</div>' +
      '<div class="zte_btn_grid">' +
      '<button class="zte_btn ok" id="zte_tr069_inform_on_btn" onclick="window.zte_tr069_inform(true)">\ud83d\udd14 On</button>' +
      '<button class="zte_btn danger" id="zte_tr069_inform_off_btn" onclick="window.zte_tr069_inform(false)">\ud83d\udd14 Off</button>' +
      "</div>" +
      '<div style="font-size:10px;color:#78909C;margin-top:6px;">Remote management (ACS). Works even where the router hides the TR-069 page. A change sends the ACS settings back exactly as the router gave them (passwords included, never shown or stored). Periodic inform only matters while CWMP is on.</div></div>' +
      "</div>" +
      '<div class="zte_sec" id="zte_wifi_sec"><div class="zte_sec_title">WiFi</div><div class="zte_btn_grid">' +
      btn("ℹ️ WiFi Info", "window.zte_wifi_info()", "full") +
      btn("📡 Set TX Power", "window.zte_wifi_txpower()") +
      btn("🌍 Set Country", "window.zte_wifi_country()", "warn") +
      "</div></div>" +
      GRP_CLOSE +
      grp_open("Advanced Tools", true) +
      '<div class="zte_sec"><div class="zte_sec_title">Login</div><div class="zte_btn_grid">' +
      btn("🔑 Auto Login", "window.zte_enable_auto_login()") +
      btn("🗑 Forget Password", "window.zte_forget_password()", "danger") +
      '<div style="grid-column:1/-1;font-size:10px;color:#78909C;text-align:center;">Auto login: <b id="zte_autologin_state">—</b></div>' +
      btn("🛠 Developer Login", "window.zte_developer_login()", "full") +
      "</div>" +
      '<div class="zte_row" id="zte_sys_timeout_row" style="display:none;margin-top:6px;"><span class="zte_label">Session timeout</span>' +
      '<span class="zte_value" id="zte_sys_timeout">\u2014</span></div>' +
      '<div class="zte_btn_grid" id="zte_sys_timeout_btns" style="display:none;">' +
      btn("\u270f Change session timeout\u2026", "window.zte_set_login_timeout()", "full") + "</div>" +
      "</div>" +
      '<div class="zte_sec" id="zte_thermal_sec" style="display:none;"><div class="zte_sec_title">Temperature Control</div>' +
      '<div class="zte_row" id="zte_sys_thermal_row"><span class="zte_label" id="zte_thermal_label">Temperature control</span>' +
      '<span class="zte_value" id="zte_sys_thermal">\u2014</span></div>' +
      '<div class="zte_btn_grid">' +
      '<button class="zte_btn ok" id="zte_thermal_on_btn" onclick="window.zte_thermal(true)">\ud83c\udf21 On</button>' +
      '<button class="zte_btn danger" id="zte_thermal_off_btn" onclick="window.zte_thermal(false)">\ud83c\udf21 Off</button>' +
      '<div id="zte_thermal_note" style="grid-column:1/-1;font-size:10px;color:#78909C;">Keep it on.</div>' +
      "</div></div>" +
      '<div class="zte_sec"><div class="zte_sec_title">Hidden Menus &amp; Pages</div><div class="zte_btn_grid">' +
      '<button class="zte_btn" id="zte_hidden_btn" onclick="window.zte_hidden_toggle()">👁 Hidden Menus: OFF</button>' +
      btn("📄 Hidden pages…", "window.zte_hidden_pages()") +
      "</div></div>" +
      GRP_CLOSE +
      (CFG.bmac
        ? '<div class="zte_sec" style="text-align:center;background:#FFF8E1;border-color:#FFE082;">' +
          '<div style="font-size:11px;color:#546E7A;margin-bottom:8px;">If this fork saves you time, a small tip is appreciated 🙂<br>It builds on the work of Cerix and Thomas Pöchtrager — tips to them too.</div>' +
          '<div style="margin-bottom:6px;"><a href="https://paypal.me/skaranik" target="_blank" rel="noopener noreferrer" ' +
          'style="display:inline-block;width:310px;max-width:100%;box-sizing:border-box;white-space:nowrap;background:#0070BA;color:#FFFFFF;font-weight:700;font-size:12px;padding:6px 10px;' +
          'border-radius:8px;text-decoration:none;border:2px solid #005EA6;">Tip via PayPal — papatsonis (this fork)</a></div>' +
          '<div><a href="https://buymeacoffee.com/cerix" target="_blank" rel="noopener noreferrer" ' +
          'style="display:inline-block;width:310px;max-width:100%;box-sizing:border-box;white-space:nowrap;background:#FFDD00;color:#000;font-weight:700;font-size:12px;padding:6px 10px;' +
          'border-radius:8px;text-decoration:none;border:2px solid #F0C800;">☕ Buy Me a Coffee — Cerix</a></div>' +
          '<div style="font-size:10px;color:#90A4AE;margin-top:8px;">ZTE-Script-NG (ubus API) by Thomas Pöchtrager — PayPal tips: t.poechtrager@gmail.com</div>' +
          "</div>"
        : "") +
      "</div>" +
      '<div id="zte_footer">ZTE Panel NG Lite v' + CFG.version + " · by papatsonis · based on Cerix's panel and ZTE-Script-NG · AGPLv3 · drag header to move</div>";

    document.body.appendChild(panel);
    make_draggable(panel);
    make_minimizable(panel);
    setup_collapsers(panel);
  }

  var GROUPS_CLOSED = ["RF Tuning & Locks", "Router Settings", "Advanced Tools"];
  function load_collapse() { try { return JSON.parse(localStorage.getItem(collapse_ls_key()) || "{}") || {}; } catch (e) { return {}; } }
  function save_collapse(m) { try { localStorage.setItem(collapse_ls_key(), JSON.stringify(m)); } catch (e) { } }
  function sec_title_text(sec) { var t = sec.querySelector(".zte_sec_title"); return t ? t.textContent.trim() : ""; }
  function grp_name_text(grp) { var t = grp.querySelector(".zte_grp_name"); return t ? t.textContent.trim() : ""; }

  function setup_collapsers(panel) {
    var saved = load_collapse();
    var has = function (k) { return Object.prototype.hasOwnProperty.call(saved, k); };
    panel.querySelectorAll(".zte_sec").forEach(function (sec) {
      var t = sec.querySelector(".zte_sec_title");
      if (!t) return;
      if (sec.classList.contains("zte_fixed")) return;
      if (!sec.firstElementChild || !sec.firstElementChild.contains(t)) return;
      sec.classList.add("zte_collapsible");
      var key = t.textContent.trim();
      sec.classList.toggle("zte_collapsed", has(key) ? !!saved[key] : true);
    });
    panel.querySelectorAll(".zte_grp.zte_grp_fold").forEach(function (grp) {
      var key = "grp:" + grp_name_text(grp);
      grp.classList.toggle("zte_grp_closed", has(key) ? !!saved[key] : GROUPS_CLOSED.indexOf(grp_name_text(grp)) > -1);
    });
    panel.addEventListener("click", function (e) {
      if (e.target.closest("button,select,a,input,textarea")) return;
      var bar = e.target.closest(".zte_grp_fold > .zte_grp_title");
      if (bar) {
        var grp = bar.parentElement;
        grp.classList.toggle("zte_grp_closed");
        var mg = load_collapse();
        mg["grp:" + grp_name_text(grp)] = grp.classList.contains("zte_grp_closed");
        save_collapse(mg);
        return;
      }
      var sec = e.target.closest(".zte_sec.zte_collapsible");
      if (!sec || !sec.firstElementChild || !sec.firstElementChild.contains(e.target)) return;
      sec.classList.toggle("zte_collapsed");
      var m = load_collapse();
      m[sec_title_text(sec)] = sec.classList.contains("zte_collapsed");
      save_collapse(m);
    });
  }

  function setup_debug_toggle() {
    var foot = zel("zte_footer");
    if (!foot || foot.dataset.zteDebugBound) return;
    foot.dataset.zteDebugBound = "1";
    var clicks = 0, timer = null;
    foot.style.cursor = "pointer";
    foot.title = "Click 5× to toggle debug logging";
    foot.addEventListener("click", function () {
      clicks++;
      clearTimeout(timer);
      timer = setTimeout(function () { clicks = 0; }, 2000);
      if (clicks < 5) return;
      clicks = 0;
      CFG.debug = !CFG.debug;
      try {
        if (CFG.debug) localStorage.setItem(LS.DEBUG, "1");
        else localStorage.removeItem(LS.DEBUG);
      } catch (e) { }
      toast("Debug logging " + (CFG.debug ? "ON" : "OFF"), CFG.debug ? "ok" : "info");
      console.info("[ZTE] debug logging " + (CFG.debug ? "ON" : "OFF"));
    });
  }

  function make_draggable(panel) {
    var h = panel.querySelector("#zte_hdr");
    var mx = 0, my = 0;
    h.addEventListener("mousedown", function (e) {
      if (e.target.tagName === "BUTTON") return;
      e.preventDefault();
      mx = e.clientX; my = e.clientY;
      document.addEventListener("mousemove", mv);
      document.addEventListener("mouseup", mu);
    });
    function mv(e) {
      panel.style.top = panel.offsetTop - (my - e.clientY) + "px";
      panel.style.left = panel.offsetLeft - (mx - e.clientX) + "px";
      mx = e.clientX; my = e.clientY;
    }
    function mu() {
      document.removeEventListener("mousemove", mv);
      document.removeEventListener("mouseup", mu);
    }
  }

  function make_minimizable(panel) {
    var b = panel.querySelector("#zte_min_btn");
    var body = panel.querySelector("#zte_body");
    var foot = panel.querySelector("#zte_footer");
    var hdr = panel.querySelector("#zte_hdr");
    var col = false;
    b.addEventListener("click", function () {
      col = !col;
      
      if (col) {
        panel.classList.add("minimized");
      } else {
        panel.classList.remove("minimized");
      }
      
      body.style.display = col ? "none" : "";
      foot.style.display = col ? "none" : "";
      b.textContent = col ? "+" : "−";
      hdr.style.borderRadius = col ? "12px" : "12px 12px 0 0";
    });
  }

  var GF_GET = "/goform/goform_get_cmd_process";
  var GF_BACKEND_KEY = "ZtePanelBackend";
  function gf_seen_before() { try { return localStorage.getItem(GF_BACKEND_KEY) === "goform"; } catch (e) { return false; } }
  var GF_BOOT_WAIT_MS = 180000, GF_BOOT_SLOW_MS = 15000;
  function gf_boot_left(slow, end) { return slow ? CFG.ajaxTimeout : Math.min(CFG.ajaxTimeout, Math.max(1, end - Date.now())); }
  async function goform_wait_boot(everyMiss) {
    var ok = 0, n = 0, end = Date.now() + GF_BOOT_WAIT_MS, slow = false;
    for (;;) {
      if (await goform_present(gf_boot_left(slow, end))) {
        if (++ok >= 2) return "goform";
        await sleep(1500);
        continue;
      }
      ok = 0;
      n++;
      if ((slow || everyMiss || n % 4 === 0) && (await ubus_present(gf_boot_left(slow, end))) === true) return "ubus";
      if (!slow && Date.now() >= end) {
        slow = true;
      }
      await sleep(slow ? GF_BOOT_SLOW_MS : Math.min(3000, Math.max(0, end - Date.now())));
    }
  }
  var GF_CHUNK = 25;

  async function gf_fetch(url, opts, ms, read) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null, to = null;
    var limit = new Promise(function (_, rej) {
      to = setTimeout(function () { if (ctrl) ctrl.abort(); rej(new Error("timeout")); }, Math.max(1, ms || CFG.ajaxTimeout));
    });
    try {
      return await Promise.race([limit, (async function () {
        var r = await fetch(url, Object.assign({}, opts || {}, ctrl ? { signal: ctrl.signal } : {}));
        return read ? await read(r) : r;
      })()]);
    } finally {
      clearTimeout(to);
    }
  }
  async function gf_get(fields, ms) {
    var out = {}, end = Date.now() + (ms || CFG.ajaxTimeout);
    for (var i = 0; i < fields.length; i += GF_CHUNK) {
      var part = fields.slice(i, i + GF_CHUNK), left = end - Date.now();
      if (left <= 0) throw new Error("timeout");
      var j = await gf_fetch(GF_GET + "?isTest=false&multi_data=1&cmd=" + encodeURIComponent(part.join(",")) + "&_=" + Date.now(),
        { credentials: "same-origin", cache: "no-store" }, left, function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        });
      part.forEach(function (k) { out[k] = j && j[k] !== undefined && j[k] !== null ? String(j[k]).trim() : ""; });
    }
    return out;
  }
  async function goform_present(ms) {
    try { await gf_get(["loginfo"], ms); return true; } catch (e) { return false; }
  }
  async function gf_logged_in() {
    try { return (await gf_get(["loginfo"])).loginfo === "ok"; } catch (e) { return false; }
  }

  function gf_lte_lock_field(g) {
    if (!g) return "";
    return gf_has("set4GBandEXSelect") ? gf_first(g.lte_band_ext_1_64, g.lte_band_lock) : gf_first(g.lte_band_lock, g.lte_band_ext_1_64);
  }
  function gf_first() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  }
  function gf_hex(v) {
    v = String(v || "").trim();
    if (!v || !/^(0x)?[0-9a-f]+$/i.test(v)) return "";
    var n = parseInt(v.replace(/^0x/i, ""), 16);
    return isNaN(n) ? "" : String(n);
  }
  function gf_int(v) { var n = parseFloat(v); return isNaN(n) ? "" : String(Math.round(n)); }
  function gf_nettype(t) {
    var u = String(t || "").trim().toUpperCase();
    if (u === "ENDC" || u === "EN-DC") return "ENDC";
    if (u === "LTE-NSA" || u === "SA" || u === "LTE") return u;
    if (/^LTE[_+-]?(CA|A)$|^LTE\+$/.test(u)) return "LTE";
    return String(t || "").trim();
  }
  function gf_ca_state(g) { return g.wan_lte_ca === "ca_activated" || g.wan_lte_ca === "ca_deactivated"; }
  function gf_pcell_earfcn(g) {
    return gf_ca_state(g) ? gf_first(g.lte_ca_pcell_freq, g.wan_active_channel) : gf_first(g.wan_active_channel, g.lte_ca_pcell_freq);
  }
  function gf_lte_ca(g, pci) {
    var rows = [], sig = [];
    var ca = gf_ca_state(g);
    var earfcn = gf_pcell_earfcn(g);
    if (!earfcn) return { lteca: "", ltecasig: "" };
    rows.push([pci, "", "", earfcn, gf_int(ca ? gf_first(g.lte_ca_pcell_bandwidth, g.bandwidth) : gf_first(g.bandwidth, g.lte_ca_pcell_bandwidth))].join(","));
    if (!ca) return { lteca: rows.join(";"), ltecasig: "" };
    var sc = String(g.lte_multi_ca_scell_info || "").split(";");
    var ss = String(g.lte_multi_ca_scell_sig_info || "").split(";");
    sc.forEach(function (e, i) {
      var p = e.split(",").map(function (x) { return x.trim(); });
      if (p.length < 6 || p[4] === earfcn) return;
      var s = (ss[i] || "").split(",").map(function (x) { return x.trim(); });
      if (/^-44(\.0+)?$/.test(s[0] || "")) s[0] = "";
      var active = p[2] === "2" || s[5] === "2";
      rows.push([p[1], p[3], "", p[4], gf_int(p[5])].join(","));
      sig.push(s.length >= 5 ? s.slice(0, 5).concat([active ? "2" : "1"]).join(",") : ["", "", "", "", "", active ? "2" : "1"].join(","));
    });
    return { lteca: rows.join(";"), ltecasig: sig.join(";") };
  }
  function gf_nr_ca(g, pcellArfcn, sa) {
    if (!pcellArfcn) return "";
    var allowed = band_list(sa ? g.nr5g_sa_band_lock : g.nr5g_nsa_band_lock);
    return String(g.nr_multi_ca_scell_info || "").split(";").map(function (e) {
      var p = e.split(",").map(function (x) { return x.trim(); });
      if (p.length < 10 || p[4] === pcellArfcn) return "";
      if (allowed.length && allowed.indexOf(strip_n(p[3])) === -1) return "";
      return [p[6], p[1], p[2] === "2" ? "2" : "1", p[3], p[4], gf_int(p[5]), "", p[7], p[8], p[9], p[10] || ""].join(",");
    }).filter(Boolean).join(";");
  }
  function gf_nr_active_band(g, sa) {
    return sa ? gf_first(g.nr5g_action_band, g.nr5g_action_nsa_band) : gf_first(g.nr5g_action_nsa_band, g.nr5g_action_band);
  }
  function gf_nr_snr(g) {
    var v = gf_first(g.nr5g_snr, g.Z5g_SINR, g.Z5g_snr), n = parseFloat(v);
    return n === -20 || Math.abs(n + 3276.8) < 0.05 ? "" : v;
  }
  function gf_netinfo(g) {
    var lpci = gf_hex(g.lte_pci);
    var ca = gf_lte_ca(g, lpci);
    var n = {
      network_type: gf_nettype(g.network_type),
      network_provider_fullname: g.network_provider_fullname,
      rmcc: g.rmcc, rmnc: g.rmnc,
      net_select: g.net_select,
      cell_id: gf_hex(g.cell_id),
      lte_pci: lpci,
      gf_pcell_earfcn: gf_pcell_earfcn(g),
      wan_active_channel: g.wan_active_channel, wan_active_band: g.wan_active_band,
      lte_rsrp: g.lte_rsrp, lte_rsrq: g.lte_rsrq, lte_snr: g.lte_snr, lte_rssi: g.lte_rssi,
      lteca: ca.lteca, ltecasig: ca.ltecasig,
      lte_band_lock: gf_lte_lock_field(g),
      nr5g_sa_band_lock: g.nr5g_sa_band_lock, nr5g_nsa_band_lock: g.nr5g_nsa_band_lock,
    };
    var rsrp = gf_first(g.nr5g_rsrp, g.Z5g_rsrp);
    if (g.nr5g_action_channel && rsrp !== "") {
      n.nr5g_action_channel = g.nr5g_action_channel;
      var sa = n.network_type === "SA";
      n.nr5g_action_band = gf_nr_active_band(g, sa);
      n.nr5g_pci = gf_hex(gf_first(g.network_Z5g_PCI, g.nr5g_pci));
      n.nr5g_bandwidth = gf_int(sa ? gf_first(g.nr5g_bandwidth, g.bandwidth, g.nr5g_nsa_bandwidth) : gf_first(g.nr5g_nsa_bandwidth, g.nr5g_bandwidth));
      n.nr5g_rsrp = rsrp;
      n.nr5g_rsrq = gf_first(g.nr5g_rsrq, g.Z5g_rsrq);
      n.nr5g_snr = gf_nr_snr(g);
      n.nr5g_rssi = gf_first(g.nr5g_rssi, g.Z5g_rssi);
      n.nr5g_cell_id = gf_hex(gf_first(g.nr5g_cell_id, g.network_Z5g_CELL_ID));
    }
    n.nrca = gf_nr_ca(g, n.nr5g_action_channel, n.network_type === "SA");
    var lp = gf_first(g.lte_lockcell_pci, g.lte_pci_lock), le = gf_first(g.lte_lockcell_earfcn, g.lte_earfcn_lock);
    var lu = lp + "," + le;
    n.lock_lte_cell = lp && le && lu !== "1,1" && lu !== "0,0" ? lu : "";
    var nc = String(g.nr5g_cell_lock || "").replace(/\s/g, "");
    n.lock_nr_cell = !nc || /^([01],)*[01]$/.test(nc) ? "" : nc;
    return n;
  }
  function gf_traffic(g) {
    return {
      real_rx_speed: gf_first(g.flux_realtime_rx_thrpt, g.realtime_rx_thrpt),
      real_tx_speed: gf_first(g.flux_realtime_tx_thrpt, g.realtime_tx_thrpt),
      real_time: gf_first(g.flux_realtime_time, g.realtime_time),
      real_rx_bytes: gf_first(g.flux_realtime_rx_bytes, g.realtime_rx_bytes),
      real_tx_bytes: gf_first(g.flux_realtime_tx_bytes, g.realtime_tx_bytes),
      month_rx_bytes: gf_first(g.flux_monthly_rx_bytes, g.monthly_rx_bytes),
      month_tx_bytes: gf_first(g.flux_monthly_tx_bytes, g.monthly_tx_bytes),
      month_time: gf_first(g.flux_monthly_time, g.monthly_time),
    };
  }
  function gf_wan(g) {
    var w = { opms_wan_mode: g.opms_wan_mode, mwan_wanlan1_status: g.ppp_status, mwan_wanlan1_wan_ipaddr: g.wan_ipaddr,
      mwan_wanlan1_wan_gateway: g.wan_gateway, mwan_wanlan1_prefer_dns_auto: g.prefer_dns_auto, mwan_wanlan1_standby_dns_auto: g.standby_dns_auto };
    if (g.ipv6_wan_ipaddr) {
      w.mwan_wanlan1_ipv6_wan_ipaddr = g.ipv6_wan_ipaddr;
      w.mwan_wanlan1_ipv6_wan_gateway = g.ipv6_wan_gateway;
      w.mwan_wanlan1_ipv6_prefer_dns_auto = g.ipv6_prefer_dns_auto;
      w.mwan_wanlan1_ipv6_standby_dns_auto = g.ipv6_standby_dns_auto;
    }
    return w;
  }

  var GF_FAST = ["loginfo", "network_type", "lte_pci", "lte_rsrp", "lte_rsrq", "lte_snr", "lte_rssi",
    "wan_active_channel", "wan_active_band", "lte_ca_pcell_freq", "lte_ca_pcell_bandwidth", "bandwidth",
    "lte_multi_ca_scell_info", "lte_multi_ca_scell_sig_info", "wan_lte_ca", "cell_id",
    "nr5g_action_channel", "nr5g_action_band", "nr5g_action_nsa_band", "nr5g_pci", "network_Z5g_PCI",
    "nr5g_bandwidth", "nr5g_nsa_bandwidth", "nr5g_rsrp", "nr5g_rsrq", "nr5g_snr", "nr5g_rssi",
    "Z5g_rsrp", "Z5g_rsrq", "Z5g_SINR", "Z5g_snr", "Z5g_rssi", "nr5g_cell_id", "network_Z5g_CELL_ID", "nr_multi_ca_scell_info",
    "flux_realtime_rx_thrpt", "flux_realtime_tx_thrpt", "flux_realtime_rx_bytes", "flux_realtime_tx_bytes", "flux_realtime_time",
    "realtime_rx_thrpt", "realtime_tx_thrpt", "realtime_rx_bytes", "realtime_tx_bytes", "realtime_time"];
  var GF_SLOW = ["model_name", "wa_inner_version", "network_provider_fullname", "rmcc", "rmnc", "net_select",
    "lte_band_lock", "lte_band_ext_1_64", "nr5g_sa_band_lock", "nr5g_nsa_band_lock",
    "lte_pci_lock", "lte_earfcn_lock", "lte_lockcell_pci", "lte_lockcell_earfcn", "nr5g_cell_lock",
    "ant_switch_enable", "ant_switch_idx", "ant_switch_state",
    "gps_lat", "gps_lon",
    "opms_wan_mode", "ppp_status", "wan_ipaddr", "ipv6_wan_ipaddr",
    "flux_monthly_rx_bytes", "flux_monthly_tx_bytes", "flux_monthly_time", "monthly_rx_bytes", "monthly_tx_bytes", "monthly_time",
    "system_uptime", "wan_gateway", "prefer_dns_auto", "standby_dns_auto",
    "ipv6_wan_gateway", "ipv6_prefer_dns_auto", "ipv6_standby_dns_auto",
    "pm_sensor_ambient", "pm_sensor_mdm", "pm_sensor_5g", "pm_sensor_pa1", "wifi_chip_temp"];

  var GF_TEMPS = [["pm_sensor_ambient", "A", "Ambient"], ["pm_sensor_mdm", "M", "Modem"], ["pm_sensor_5g", "5G", "5G modem"],
    ["pm_sensor_pa1", "P", "Power amplifier"], ["wifi_chip_temp", "W", "WiFi chip"]];
  function gf_temps(g) {
    return GF_TEMPS.map(function (t) { var v = parseFloat(g[t[0]]); return isNaN(v) || v <= -40 ? null : { k: t[1], name: t[2], v: v }; }).filter(Boolean);
  }

  var GF_HOLD = 3000;
  var GF_HOLD_KEYS = ["lte_multi_ca_scell_info", "lte_multi_ca_scell_sig_info", "nr_multi_ca_scell_info",
    "lte_ca_pcell_freq", "lte_ca_pcell_bandwidth"];
  function gf_hold_lists(g) {
    var now = Date.now(), h = S.gf_hold = S.gf_hold || {};
    var cell = (g.lte_pci || "") + "/" + (g.cell_id || "");
    GF_HOLD_KEYS.forEach(function (k) {
      if (g[k]) h[k] = { v: g[k], t: now, cell: cell };
      else if (h[k] && now - h[k].t <= GF_HOLD && h[k].cell === cell && g.lte_pci) g[k] = h[k].v;
    });
  }

  async function gf_poll_once(full) {
    var id = S.gf_poll_seq = (S.gf_poll_seq || 0) + 1;
    try {
      var g = await gf_get(full ? GF_FAST.concat(GF_SLOW) : GF_FAST);
      if (id < (S.gf_poll_shown || 0)) {
        if (!full || g.loginfo !== "ok" || !S.gf_raw || S.session_lost || id < (S.gf_slow_shown || 0)) return;
        S.gf_slow_shown = id;
        var slow = {};
        GF_SLOW.forEach(function (k) { if (GF_FAST.indexOf(k) < 0 && Object.prototype.hasOwnProperty.call(g, k)) slow[k] = g[k]; });
        g = Object.assign({}, S.gf_raw, slow);
      } else {
        S.gf_poll_shown = id;
        if (full) S.gf_slow_shown = id;
      }
      if (g.loginfo !== "ok") { set_dot("error"); S.session_lost = true; S.lost_checks = 0; return; }
      if (full && g.model_name && !S.gf_model) {
        S.gf_model = g.model_name;
      }
      if (full && g.wa_inner_version && !S.gf_fw) {
        S.gf_fw = g.wa_inner_version;
      }
      gf_hold_lists(g);
      g = S.gf_raw = Object.assign({}, S.gf_raw || {}, g);
      S.net = gf_netinfo(g);
      S.traffic = gf_traffic(g);
      S.wan = gf_wan(g);
      S.gf_temps = gf_temps(g);
      if (g.system_uptime) {
        S.devinfo = { device_uptime: g.system_uptime };
        if (full) note_router_boot(g.system_uptime, gf_rebooting());
      }
      set_dot("ok");
      update_ui();
      gf_after_ui();
    } catch (e) {
      set_dot("error");
    }
  }
  async function gf_poll_loop() {
    if (S.session_lost) {
      if (await gf_logged_in()) {
        S.session_lost = false;
        S.poll_tick = 0;
        if (S.expired_warned) toast("Logged in again — panel resumed", "ok");
        S.expired_warned = false;
        S.reboot_noted = false;
        setTimeout(gf_reconnect_resume, 1500);
      } else if (gf_rebooting()) {
        if (!S.reboot_noted) {
          S.reboot_noted = S.expired_warned = true;
          toast("Router restarting — " + (gf_saved() ? "the panel logs in again by itself" : "log in again on the router page") + " when it is back (about 1–2 min).", "info", 10000);
        }
        if (gf_saved() && (await goform_present()) && (await gf_try_auto_login("reboot"))) return;
      } else if (++S.lost_checks === 2 && !S.expired_warned) {
        S.expired_warned = true;
        if (await gf_try_auto_login("lost")) return;
        toast("Router session ended — log in again on the router page.", "warn");
      }
    } else {
      await gf_poll_once(S.poll_tick % CFG.slowPollEvery === 0);
      S.poll_tick++;
    }
    setTimeout(gf_poll_loop, S.session_lost ? CFG.loginWaitInterval : CFG.pollInterval);
  }

  function gf_load_band_caps() {
    var c = gf_ui_config();
    if (!c) try { c = window.require && window.require("config/config"); } catch (e) { c = null; }
    var all = c && Array.isArray(c.FREQUENCY_TYPE_4G) && c.FREQUENCY_TYPE_4G.filter(function (x) { return x && x.name === "all"; })[0];
    if (!c || !Array.isArray(c.FREQUENCY_TYPE_4G) || (all && !Array.isArray(c.FREQUENCY_TYPE_SA) && !Array.isArray(c.FREQUENCY_TYPE_NSA))) {
      S.gf_nolist = true;
      S.gf_all_lte = all ? lte_bands_from_mask(all.value) || [] : CFG.lte_all_bands.map(Number);
      S.bands = { lte: [], nr_sa: [], nr_nsa: [] };
      S.bands_loaded = true;
      render_band_chips();
      return;
    }
    var lte = band_list(c.FREQUENCY_TYPE_4G.map(function (x) { return x && x.name; }).join(","));
    var list = function (a) { return Array.isArray(a) ? band_list(a.join(",")) : []; };
    S.bands = { lte: lte, nr_sa: list(c.FREQUENCY_TYPE_SA), nr_nsa: list(c.FREQUENCY_TYPE_NSA) };
    S.bands_loaded = true;
    render_band_chips();
  }

  var GF_HIDE_GROUPS = ["Router Settings", "Advanced Tools"];
  var GF_HIDE_SECTIONS = ["Network Mode", "Band Lock — Global Reset", "Neighbor Scan & Force Connect"];
  function gf_readonly_ui() {
    var p = zel("zte_panel");
    if (!p) return;
    p.classList.add("zte_gf");
    var st = document.createElement("style");
    st.textContent = "#zte_panel.zte_gf .zte_btn:not(.zte_gf_keep),#zte_panel.zte_gf .zte_chip,#zte_panel.zte_gf .zte_bandrow," +
      "#zte_panel.zte_gf select:not(.zte_gf_keep){display:none !important}";
    document.head.appendChild(st);
    p.querySelectorAll(".zte_btn").forEach(function (b) {
      if (/zte_copy_signal/.test(b.getAttribute("onclick") || "")) b.classList.add("zte_gf_keep");
    });
    window.zte_test_connection = gf_test_connection;
    p.querySelectorAll(".zte_grp").forEach(function (g) {
      var n = g.querySelector(".zte_grp_name");
      if (n && GF_HIDE_GROUPS.indexOf(n.textContent.trim()) > -1) g.style.display = "none";
    });
    p.querySelectorAll(".zte_sec").forEach(function (s) {
      var t = s.querySelector(".zte_sec_title");
      if (t && GF_HIDE_SECTIONS.indexOf(t.textContent.trim()) > -1) s.style.display = "none";
    });
    var gn = zel("zte_gnss_wrap");
    if (gn) gn.style.display = "none";
    p.querySelectorAll(".zte_sub").forEach(function (s) {
      var t = s.textContent.trim();
      if (t === "System") { s.id = "zte_gf_sys_sub"; s.style.display = "none"; }
      if (t === "All Time") {
        s.style.display = "none";
        for (var e = s.nextElementSibling, k = 0; e && k < 3; e = e.nextElementSibling, k++) e.style.display = "none";
      }
    });
    var nt = zel("zte_nr_lock_type");
    if (nt && nt.parentElement) nt.parentElement.style.display = "none";
    var cl = zel("zte_cell_lock_state");
    if (cl && cl.nextElementSibling) cl.nextElementSibling.style.display = "none";
    var f = zel("zte_footer");
    if (f && CFG.dev_ui) f.insertAdjacentHTML("afterbegin", '<b style="color:#E65100" id="zte_gf_mode">goform · read-only</b> · ');
  }

  function gf_after_ui() {
    var t = S.gf_temps || [];
    ztoggle("temperature", t.length > 0);
    zset("temps", t.map(function (x) { return x.k + ": " + x.v + "°C"; }).join(" · "));
    var h = t.map(function (x) { return row(x.name, x.v + " °C"); }).join("");
    if (S.devinfo && S.devinfo.device_uptime) h += row("Uptime", fmt_duration(S.devinfo.device_uptime));
    zhtml("zte_dev_system", h);
    ztoggle("zte_gf_sys_sub", !!h);
    if (S.gf_nolist) gf_neutral_bands();
    if (!S.gf_gps_enabled && gf_gps_valid(S.gf_raw)) gf_gps_enable();
    if (S.gf_gps_enabled) gf_after_gps();
    gf_antenna_paint(S.gf_raw);
    gf_cell_lock_in_force();
  }
  function gf_cell_lock_in_force() {
    var d = S.net || {}, l = d.lock_lte_cell;
    if (!l || !d.lte_pci || !d.gf_pcell_earfcn) return;
    var cur = d.lte_pci + "," + d.gf_pcell_earfcn;
    if (cur === l) return;
    var note = "stored, not in force — router on " + cur.replace(",", "/");
    var nl = !nr_cell_unlocked(d.lock_nr_cell);
    zhtml("zte_lock_status", '<span style="color:#D32F2F;">🔒 LTE ' + esc(l) + '</span> <span style="color:#78909C;">(' + esc(note) + ")</span>" +
      (nl ? '<br><span style="color:#D32F2F;">🔒 5G ' + esc(d.lock_nr_cell) + "</span>" : ""));
    zhtml("zte_cell_lock_state",
      'LTE: <b style="color:#D32F2F">' + esc(l) + '</b> <span style="color:#78909C">(' + esc(note) + ")</span>" +
      " &nbsp;·&nbsp; 5G: " + (nl ? '<b style="color:#D32F2F">' + esc(d.lock_nr_cell) + "</b>" : '<span style="color:#78909C">unlocked</span>'));
  }
  function gf_gps_encrypted(g) {
    var la = String((g && g.gps_lat) || "").trim(), lo = String((g && g.gps_lon) || "").trim();
    return (!!la && gps_num(la) === null) || (!!lo && gps_num(lo) === null);
  }
  function gf_gps_coords(g) {
    var src = gf_gps_encrypted(g) ? (S.gf_gps_dec || {}) : g || {};
    var lat = gps_num(src.gps_lat), lon = gps_num(src.gps_lon);
    return lat === null || lon === null || (lat === 0 && lon === 0) ? null : { lat: lat, lon: lon };
  }
  function gf_gps_decode(force) {
    if (!gf_has("getDeviceInfo")) return Promise.resolve();
    if (S.gf_gps_dec_p) return S.gf_gps_dec_p;
    if (!force && S.gf_gps_dec_at && Date.now() - S.gf_gps_dec_at < 60000) return Promise.resolve();
    S.gf_gps_dec_p = (async function () {
      try {
        var d = await gf_devinfo();
        S.gf_gps_dec = { gps_lat: d.gps_lat, gps_lon: d.gps_lon };
        S.gf_gps_dec_at = Date.now();
      } finally { S.gf_gps_dec_p = null; }
    })();
    return S.gf_gps_dec_p;
  }
  function gf_gps_valid(g) {
    if (gf_gps_encrypted(g) && !S.gf_gps_enabled) gf_gps_decode();
    return !!gf_gps_coords(g);
  }
  function gf_after_gps(manual) {
    var g = S.gf_raw || {};
    if (gf_gps_encrypted(g)) gf_gps_decode();
    var c = gf_gps_coords(g);
    if (!c) {
      S.gps = { state: "nofix" };
      render_gnss();
      render_gps(null, null, "no GPS fix right now");
      if (manual) toast("The router has no GPS position right now. Try again later.", "warn");
      return;
    }
    S.gps = { state: "pos" };
    S.gps_last = { lat: c.lat.toFixed(6), lon: c.lon.toFixed(6) };
    render_gnss();
    render_gps(S.gps_last.lat, S.gps_last.lon);
    if (manual) toast("GPS position updated ✓", "ok");
  }
  function gf_mine_key() { return "ZtePanelGfMyBands:" + (S.gf_model || "?"); }
  function gf_mine() { try { return JSON.parse(localStorage.getItem(gf_mine_key()) || "{}") || {}; } catch (e) { return {}; } }
  function gf_mine_set(k, v) {
    var m = gf_mine();
    if (v === null) delete m[k]; else m[k] = v;
    try { localStorage.setItem(gf_mine_key(), JSON.stringify(m)); } catch (e) { }
  }
  function gf_neutral_bands() {
    var d = S.net;
    var TIP = "This firmware does not report which bands the router supports, so these may be the router's " +
      "(operator's) default bands rather than a lock.";
    var grey = function (txt, tip) { return '<span style="color:#78909C;"' + (tip ? ' title="' + esc(tip) + '"' : "") + ">" + esc(txt) + "</span>"; };
    var lb = d.lte_band_lock ? lte_bands_from_mask(d.lte_band_lock) : null;
    var has = function (all) { return all.length && all.every(function (b) { return lb.indexOf(+b) > -1; }); };
    var lteFull = !lb || !lb.length || has(S.gf_all_lte) || has((S.bands && S.bands.lte) || []);
    var lteTxt = lteFull ? "" : "B" + lb.join(" + B");
    var sa = band_list(d.nr5g_sa_band_lock), nsa = band_list(d.nr5g_nsa_band_lock);
    var nrFull = function (l, page) {
      var all = function (want) { return want.length > 0 && want.every(function (b) { return l.indexOf(String(b)) > -1; }); };
      page = (page || []).map(String);
      var common = page.filter(function (b) { return CFG.nr_all_bands.indexOf(b) > -1; });
      return !l.length || all(CFG.nr_all_bands) || all(page) || all(common);
    };
    var saFull = nrFull(sa, S.bands && S.bands.nr_sa), nsaFull = nrFull(nsa, S.bands && S.bands.nr_nsa);
    var nrTxt = !saFull && !nsaFull && sa.join() === nsa.join() ? "n" + sa.join(" + n")
      : [saFull ? "" : "SA n" + sa.join(" + n"), nsaFull ? "" : "NSA n" + nsa.join(" + n")].filter(Boolean).join(" · ");
    var mine = gf_mine();
    var realLte = !!lteTxt && mine.lte === lb.join(","), realNr = !!nrTxt && mine.sa === sa.join(",") && mine.nsa === nsa.join(",");
    var lock = function (txt) { return '<span style="color:#E65100;">🔒 ' + esc(txt) + "</span>"; };
    zhtml("zte_lte_band_lock_status", !lteTxt ? grey("Unlocked") : realLte ? lock(lteTxt) : grey(lteTxt + " (set on the router)", TIP));
    zhtml("zte_nr_band_lock_status", !nrTxt ? grey("Unlocked") : realNr ? lock(nrTxt) : grey(nrTxt + " (set on the router)", TIP));
    var parts = [];
    [[lteTxt, realLte], [nrTxt, realNr]].forEach(function (x) {
      if (!x[0]) return;
      var t = x[0].replace(/ \+ /g, "+");
      parts.push(x[1] ? '<span style="color:#E65100;">' + esc(t) + "</span>" : grey(t, TIP));
    });
    var cells = [d.lock_lte_cell ? "LTE" : "", d.lock_nr_cell ? "5G" : ""].filter(Boolean);
    if (cells.length) parts.push('<span style="color:#D32F2F;">🔒 cell ' + cells.join("+") + "</span>");
    zhtml("zte_rf_sum", parts.length ? parts.join(' <span style="color:#90A4AE;">·</span> ') : grey("Unlocked"));
    var sumEl = zel("zte_rf_sum");
    if (sumEl) sumEl.title = sumEl.textContent;
  }

  function gf_page_ready() { return !!gf_svc() && gf_routes().length > 0; }
  function gf_when_page_ready(fn) {
    var t0 = Date.now();
    (function check() {
      var routes = gf_routes().length > 0, waited = Date.now() - t0;
      if (gf_page_ready() || (routes && waited >= 2000) || (gf_svc() && waited >= 30000)) { fn(); return; }
      if (waited < 30000) { setTimeout(check, 500); return; }
      console.warn("[ZTE] the router page's own modules did not load");
      if (!gf_reload_broken_page()) fn();
    })();
  }
  function gf_start_panel() {
    if (S.init_done) return;
    if (zel("zte_panel")) {
      toast("Another ZTE panel script is already running on this page.\nKeep only one enabled in your userscript manager.", "warn");
      return;
    }
    S.init_done = true;
    S.started_at = Date.now();
    try { sessionStorage.removeItem(GF_RETRY_KEY); } catch (e) { }
    inject_html();
    gf_readonly_ui();
    try { sessionStorage.removeItem(LS.TRIED); } catch (e) { }
    try { localStorage.removeItem(LS.USER_LOGOUT); } catch (e) { }
    watch_logout_click();
    gf_when_page_ready(function () { gf_wait_config(10000).then(gf_setup_controls); });
    gf_poll_loop();
    setup_debug_toggle();
    toast("ZTE Panel NG Lite v" + CFG.version + " active", "ok");
  }
  async function gf_wait_config(ms) {
    var end = Date.now() + ms;
    while (!gf_ui_config() && Date.now() < end) await sleep(500);
  }
  function gf_setup_controls() {
    gf_load_band_caps();
    gf_actions_setup();
    gf_advtools_setup();
    setTimeout(gf_reconnect_resume, 1500);
    gf_bands_setup();
    gf_bands_from_page().catch(function (e) { });
    gf_netmode_setup();
    gf_cells_setup().catch(function (e) { });
    gf_antenna_setup().catch(function (e) { });
    gf_gps_setup().catch(function (e) { });
    gf_device_setup();
  }

  var GF_RETRY_WINDOW = 300000;
  async function goform_bootstrap() {
    try { localStorage.setItem(GF_BACKEND_KEY, "goform"); } catch (e) { }
    if (!(await gf_logged_in())) {
      if (await gf_try_auto_login("start")) return;
      await new Promise(function (resolve) {
        var busy = false;
        var t = setInterval(async function () {
          if (busy) return;
          busy = true;
          try {
            if (await gf_logged_in()) { clearInterval(t); resolve(); return; }
            var tries = 0, logout = null;
            try { tries = Number(sessionStorage.getItem(GF_RETRY_KEY)) || 0; } catch (e) { tries = 0; }
            try { logout = localStorage.getItem(LS.USER_LOGOUT); } catch (e) { logout = null; }
            var since = ms_since(sessionStorage, LS.TRIED);
            if (gf_saved() && tries < 2 && logout === null && since >= 60000 && since < GF_RETRY_WINDOW) {
              try { sessionStorage.setItem(GF_RETRY_KEY, String(tries + 1)); } catch (e) { }
              if (await gf_try_auto_login("retry")) { clearInterval(t); return; }
            }
          } catch (e) {
          } finally {
            busy = false;
          }
        }, CFG.loginWaitInterval);
      });
      await wait_page_settled();
    }
    gf_start_panel();
  }

  var GF_ALLOWED = ["restart", "connect", "disconnect", "setDnsSettings",
    "set4GBandEXSelect", "setBandSelect", "setNr5gSaOrNsaBandSelect", "setNr5gBandSelect",
    "setBearerPreference"];

  function gf_svc() {
    try {
      var rq = window.requirejs || window.require;
      var s = rq && rq.s && rq.s.contexts && rq.s.contexts._ && rq.s.contexts._.defined.service;
      return s && typeof s === "object" ? s : null;
    } catch (e) {
      return null;
    }
  }
  function gf_has(m) {
    var s = gf_svc();
    return GF_ALLOWED.indexOf(m) > -1 && !!s && typeof s[m] === "function";
  }
  function gf_call(m, params, ms) {
    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      if (!gf_has(m)) { fin({ error: "not available" }); return; }
      try {
        gf_svc()[m](params || {}, function (r) { fin(r || {}); },
          function (e) {
            var et = (e && (e.errorType || e.result)) || "error";
            fin(/timeout|timed?\s*out/i.test(String(et)) ? { error: et, timeout: true } : { error: et });
          });
      } catch (e) {
        fin({ error: e.message });
      }
      setTimeout(function () { fin({ timeout: true }); }, ms || 8000);
    });
  }

  async function gf_read_back(fields) {
    var g = null;
    try { g = await gf_get(fields.concat(["loginfo"])); } catch (e) { g = null; }
    return g && g.loginfo === "ok" ? g : null;
  }
  function gf_unknown_msg(what) {
    return what + " — the router did not confirm it and could not be read back (it may have ended the web session), so the result is unknown.\n" +
      (gf_saved() ? "The panel logs in again by itself; check it then." : "Log in again and check it.");
  }

  var GF_REBOOT_KEY = "ZtePanelGfRebootAt", GF_REBOOT_MS = 360000;
  function gf_rebooting() { return ms_since(sessionStorage, GF_REBOOT_KEY) < GF_REBOOT_MS; }
  function gf_reboot_sent(what) {
    stamp(sessionStorage, GF_REBOOT_KEY);
    toast((what || "Router rebooting…") + " (about 1–2 min) — " +
      (gf_saved() ? "the panel logs in again by itself when it is back." : "log in again once it is back."), "warn", 12000);
  }
  async function gf_reboot() {
    if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    if (!confirm("Reboot the router?")) return;
    S.gf_busy = true;
    try {
      var r = await gf_call("restart", {}, 6000);
      if (r.timeout) { gf_reboot_sent("No answer — the router is probably restarting"); return; }
      if (r.error || (r.result && r.result !== "success")) {
        toast("The router refused the reboot (" + (r.error || r.result) + ").", "error");
        return;
      }
      gf_reboot_sent();
    } finally {
      S.gf_busy = false;
    }
  }

  function gf_ppp_up(s) { return /connected$/.test(s) && !/disconnected$/.test(s); }
  function gf_ppp_down(s) { return /disconnected$/.test(s); }
  async function gf_wait_ppp(test, ms) {
    var end = Date.now() + ms, s = "";
    while (Date.now() < end) {
      try { s = (await gf_get(["ppp_status"], Math.min(CFG.ajaxTimeout, end - Date.now()))).ppp_status || ""; } catch (e) { s = ""; }
      if (s && test(s)) return s;
      await sleep(1000);
    }
    return null;
  }
  var GF_RC_KEY = "ZtePanelGfReconnect", GF_RC_MAX_AGE = 600000, GF_RC_ASK_AGE = 43200000, GF_RC_MAX_TRIES = 3;
  function gf_rc_get() {
    try {
      var v = JSON.parse(localStorage.getItem(GF_RC_KEY) || "null");
      if (v && Date.now() - v.at < GF_RC_ASK_AGE) { v.stale = Date.now() - v.at >= GF_RC_MAX_AGE; return v; }
      localStorage.removeItem(GF_RC_KEY);
    } catch (e) { }
    return null;
  }
  function gf_rc_set(v) { try { localStorage.setItem(GF_RC_KEY, JSON.stringify(v)); } catch (e) { } }
  function gf_rc_clear() { try { localStorage.removeItem(GF_RC_KEY); } catch (e) { } }
  async function gf_reconnect() {
    if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    if (!confirm("Reconnect mobile data (off → on)?\nThe internet connection drops for a few seconds.")) return;
    S.gf_busy = true;
    gf_rc_set({ at: Date.now(), tries: 0 });
    try {
      toast("Mobile data off…", "info", 4000);
      gf_call("disconnect", {}, 3000);
      var off = await gf_wait_ppp(gf_ppp_down, 25000);
      if (!off) toast("The router did not report the data connection as off — switching it on again anyway.", "warn", 6000);
      if (!(await gf_logged_in())) {
        toast("The router ended the web session with the disconnect.\nLog in again on the router page — the panel then turns mobile data back on.", "warn", 20000);
        return;
      }
      toast("Mobile data on…", "info", 4000);
      gf_call("connect", {}, 3000);
      var on = await gf_wait_ppp(gf_ppp_up, 45000);
      if (on) { gf_rc_clear(); toast(off ? "Mobile data reconnected ✓" : "Mobile data is on — the router did not report it off, so it may not have reconnected.", off ? "ok" : "warn", off ? undefined : 10000); }
      else if (!(await gf_logged_in())) toast("The router ended the web session.\nLog in again on the router page — the panel then turns mobile data back on.", "warn", 20000);
      else toast("Mobile data is not back yet — the panel tries again after the next page load.\nOr turn it on in the router's own page.", "warn", 15000);
    } finally {
      S.gf_busy = false;
    }
  }
  function gf_reconnect_later(n) {
    n = (n || 0) + 1;
    if (n <= 12) setTimeout(function () { gf_reconnect_resume(n); }, 5000);
  }
  async function gf_reconnect_resume(n) {
    n = typeof n === "number" ? n : 0;
    var st = gf_rc_get();
    if (!st || !gf_has("connect")) return;
    if (S.gf_busy) { gf_reconnect_later(n); return; }
    S.gf_busy = true;
    try {
      var s = "";
      try { s = (await gf_get(["ppp_status", "loginfo"])); } catch (e) { s = null; }
      if (!s || s.loginfo !== "ok" || !s.ppp_status) { gf_reconnect_later(n); return; }
      s = s.ppp_status;
      var connecting = function (x) { return /connecting$/.test(x) && !/disconnecting$/.test(x); };
      if (connecting(s)) {
        if (!(await gf_wait_ppp(gf_ppp_up, 30000))) {
          var f = null;
          try { f = await gf_get(["ppp_status", "loginfo"]); } catch (e) { f = null; }
          if (!f || f.loginfo !== "ok" || !f.ppp_status || connecting(f.ppp_status)) { gf_reconnect_later(n); return; }
          s = f.ppp_status;
        } else s = "ppp_connected";
      }
      if (gf_ppp_up(s) && Date.now() - st.at < 30000) {
        var down = await gf_wait_ppp(function (x) { return !gf_ppp_up(x); }, 10000);
        if (down) s = down;
        else {
          var f2 = null;
          try { f2 = await gf_get(["ppp_status", "loginfo"]); } catch (e) { f2 = null; }
          if (!f2 || f2.loginfo !== "ok" || !f2.ppp_status) { gf_reconnect_later(n); return; }
          s = f2.ppp_status;
        }
      }
      if (gf_ppp_up(s)) { gf_rc_clear(); toast("Mobile data is back — reconnect finished ✓", "ok"); return; }
      if (!gf_ppp_down(s)) { gf_reconnect_later(n); return; }
      if (st.stale) {
        var at = new Date(st.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        if (!confirm("Mobile data is off.\n\nThe mobile-data reconnect started at " + at + " did not finish — the router ended " +
          "the web session before data was turned on again.\n\nTurn mobile data on now?")) {
          gf_rc_clear();
          toast("Mobile data stays off. Turn it on in the router's own page when you want it.", "info", 8000);
          return;
        }
      }
      st.tries = (st.tries || 0) + 1;
      if (st.tries > GF_RC_MAX_TRIES) {
        gf_rc_clear();
        toast("Could not finish the mobile-data reconnect.\nTurn mobile data on in the router's own page.", "warn", 15000);
        return;
      }
      gf_rc_set(st);
      toast("Finishing the mobile-data reconnect after the page reload — turning data on…", "info", 6000);
      gf_call("connect", {}, 3000);
      var on = await gf_wait_ppp(gf_ppp_up, 45000);
      if (on) { gf_rc_clear(); toast("Mobile data reconnected ✓", "ok"); }
      else toast("Mobile data is not back yet — the panel tries again the next time it starts.\nOr turn it on in the router's own page.", "warn", 15000);
    } finally {
      S.gf_busy = false;
    }
  }

  var GF_DNS_FIELD = /<(?:input|select)\b[^>]*\b(?:id|name|data-bind)="[^"]*(?<!d)dns/i;
  var GF_LAN_DNS_FIELD = /<input\b[^>]*\b(?:id|name|data-bind)="[^"]*manual_lan_dns/i;
  function gf_ui_config() {
    try {
      var rq = window.requirejs || window.require;
      return rq.s.contexts._.defined["config/config"] || null;
    } catch (e) {
      return null;
    }
  }
  function gf_routes() {
    var out = [];
    try {
      var rq = window.requirejs || window.require, mods = rq.s.contexts._.defined, seen = {};
      Object.keys(mods).forEach(function (k) {
        var v = mods[k];
        if (!/(^|\/)menu(_\w+)?$/.test(k) || !Array.isArray(v)) return;
        v.forEach(function (e) {
          if (e && typeof e.hash === "string" && e.path && !seen[e.hash]) { seen[e.hash] = true; out.push({ hash: e.hash, path: String(e.path) }); }
        });
      });
    } catch (e) { }
    return out;
  }
  async function gf_text(url) {
    try {
      return await gf_fetch(url, { credentials: "same-origin" }, 0, function (r) { return r.ok ? r.text() : ""; });
    } catch (e) {
      return "";
    }
  }
  async function gf_find_dns_page() {
    if (S.gf_dns !== undefined) return S.gf_dns;
    S.gf_dns = null;
    if (gf_has("setDnsSettings")) {
      S.gf_dns = { hash: null, kind: "router" };
      return S.gf_dns;
    }
    var cfg = gf_ui_config(), rq = window.requirejs || window.require, lan = null;
    if (!cfg || !rq || typeof rq.toUrl !== "function") return null;
    var apnFlag = "SHOW_APN_DNS" in cfg;
    var routes = gf_routes().sort(function (a, b) {
      return (/apn|mobile|network|lan/i.test(b.path) ? 1 : 0) - (/apn|mobile|network|lan/i.test(a.path) ? 1 : 0);
    });
    for (var i = 0; i < routes.length; i++) {
      var t = await gf_text(rq.toUrl("tmpl/" + routes[i].path + ".html"));
      if (!t) continue;
      if (apnFlag && GF_DNS_FIELD.test(t) && /SHOW_APN_DNS/.test(await gf_text(rq.toUrl(routes[i].path + ".js")))) {
        S.gf_dns = { hash: routes[i].hash, kind: "apn" };
        break;
      }
      if (!lan && GF_LAN_DNS_FIELD.test(t)) lan = { hash: routes[i].hash, kind: "lan" };
    }
    S.gf_dns = S.gf_dns || lan;
    return S.gf_dns;
  }
  async function gf_dns() {
    var d = await gf_find_dns_page(), cfg = gf_ui_config();
    if (!d) { toast("This firmware has no page with DNS settings.", "warn"); return; }
    if (d.kind === "router") { await gf_dns_router(); return; }
    if (d.kind === "apn") {
      cfg.SHOW_APN_DNS = true;
      toast("Opening the router's APN page with its DNS fields shown (IPv4, and IPv6 where the APN has it).\n" +
        "Set the DNS there and save on that page — the router writes it itself.", "info", 12000);
    } else {
      toast("Opening the router's LAN settings.\nSet \"DNS proxy\" to Disable, enter the DNS servers (IPv4, and IPv6 if you use it) " +
        "and apply on that page.\nThe router hands these servers to your devices; a device picks them up when it reconnects " +
        "(Wi-Fi / cable) or renews its address.", "info", 15000);
    }
    if (location.hash === d.hash) { location.hash = "#home"; await sleep(400); }
    location.hash = d.hash;
  }

  var GF_DNS_FIELDS = ["dns_mode", "prefer_dns_manual", "standby_dns_manual", "ipv6_prefer_dns_manual", "ipv6_standby_dns_manual"];
  var GF_IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  async function gf_dns_router() {
    var d = null;
    try { d = await gf_get(GF_DNS_FIELDS); } catch (e) { d = null; }
    if (!d || !d.dns_mode) { toast("Could not read the router's DNS settings.", "error"); return; }
    var w = S.wan || {}, inUse = {};
    var v4 = [w.mwan_wanlan1_prefer_dns_auto, w.mwan_wanlan1_standby_dns_auto].filter(Boolean);
    var v6 = [w.mwan_wanlan1_ipv6_prefer_dns_auto, w.mwan_wanlan1_ipv6_standby_dns_auto].filter(Boolean);
    if (v4.length) inUse["IPv4 DNS"] = v4.join(", ");
    if (v6.length) inUse["IPv6 DNS"] = v6.join(", ");
    var ov = show_modal(
      "DNS",
      info_table("Current DNS settings", d, { rawKeys: true }) +
        (Object.keys(inUse).length ? info_table("DNS in use now (WAN)", inUse) : "") +
        '<div class="zte_btn_grid">' +
        '<button class="zte_btn ok" id="zte_dns_manual">✏ Set manual DNS…</button>' +
        '<button class="zte_btn" id="zte_dns_auto">↺ Use operator DNS (auto)</button>' +
        "</div>",
    );
    ov.querySelector("#zte_dns_manual").onclick = async function () {
      var def = [d.prefer_dns_manual, d.standby_dns_manual].filter(Boolean).join(",") || "1.1.1.1,8.8.8.8";
      var inp = prompt("Manual DNS — primary,secondary (IPv4):", def);
      if (!inp) return;
      var p = inp.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      if (!p.length || p.length > 2 || !p.every(function (x) { return GF_IPV4.test(x); })) { toast("Invalid IPv4 address(es)", "error"); return; }
      var def6 = [d.ipv6_prefer_dns_manual, d.ipv6_standby_dns_manual].filter(Boolean).join(",");
      var inp6 = prompt("IPv6 DNS (optional) — primary,secondary\ne.g. 2606:4700:4700::1111,2001:4860:4860::8888\n" +
        "Empty = no IPv6 DNS.", def6);
      if (inp6 === null) return;
      var q = inp6.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      if (q.length > 2 || !q.every(function (x) { return norm6(x) !== null; })) { toast("Invalid IPv6 address(es)", "error"); return; }
      ov.remove();
      await gf_dns_apply({ dns_mode: "manual", prefer_dns_manual: p[0], standby_dns_manual: p[1] || "",
        ipv6_prefer_dns_manual: q[0] || "", ipv6_standby_dns_manual: q[1] || "" });
    };
    ov.querySelector("#zte_dns_auto").onclick = async function () {
      ov.remove();
      await gf_dns_apply({ dns_mode: "auto" });
    };
  }
  async function gf_dns_apply(p) {
    if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    S.gf_busy = true;
    try {
      var r = await gf_call("setDnsSettings", p, 8000);
      var st = gf_write_state(r);
      if (st === "refused") {
        toast("The router did not apply the DNS change (" + (r.error || r.result) + ").", "error");
        return;
      }
      await sleep(1500);
      var d = await gf_read_back(GF_DNS_FIELDS);
      if (!d) { toast(gf_unknown_msg("DNS change sent"), "warn", 14000); return; }
      var diff = Object.keys(p).filter(function (k) {
        var a = String(p[k] || "").trim(), b = String(d[k] || "").trim();
        if (/ipv6/.test(k) && a && b) return norm6(a) !== norm6(b);
        return a !== b;
      });
      if (diff.length) {
        toast((st === "ok" ? "The router answered, but" : "The router did not answer the DNS change, and") + " the DNS settings read back differ (" +
          diff.map(function (k) { return k + " = " + (d[k] || "empty"); }).join(", ") + ") — check the router.", "warn", 12000);
        return;
      }
      if (p.dns_mode === "auto") { toast("DNS: operator (auto).", "ok"); return; }
      var v6 = [d.ipv6_prefer_dns_manual, d.ipv6_standby_dns_manual].filter(Boolean);
      toast("DNS set: " + [d.prefer_dns_manual, d.standby_dns_manual].filter(Boolean).join(", ") +
        " · IPv6 " + (v6.length ? v6.join(", ") : "none"), "ok", 7000);
    } finally {
      S.gf_busy = false;
    }
  }

  function gf_keep_btn(fn) {
    var p = zel("zte_panel"), found = null, pat = "window." + fn + (fn.indexOf("(") > -1 ? "" : "(");
    if (!p) return null;
    p.querySelectorAll(".zte_btn").forEach(function (b) {
      if ((b.getAttribute("onclick") || "").indexOf(pat) > -1) { b.classList.add("zte_gf_keep"); found = b; }
    });
    return found;
  }
  function gf_actions_setup() {
    var p = zel("zte_panel");
    if (!p) return;
    var have = [];
    if (gf_has("restart")) { window.zte_reboot = gf_reboot; if (gf_keep_btn("zte_reboot")) have.push("reboot"); }
    if (gf_has("connect") && gf_has("disconnect")) { window.zte_wan_reconnect = gf_reconnect; if (gf_keep_btn("zte_wan_reconnect")) have.push("reconnect"); }
    window.zte_dns = gf_dns;
    S.gf_actions = have;
    var grp = null;
    p.querySelectorAll(".zte_grp").forEach(function (g) {
      var n = g.querySelector(".zte_grp_name");
      if (n && n.textContent.trim() === "Router Settings") grp = g;
    });
    if (!grp) return;
    grp.querySelectorAll(".zte_sec").forEach(function (s) {
      var t = s.querySelector(".zte_sec_title");
      if (!t || t.textContent.trim() !== "Connection") s.style.display = "none";
    });
    ["zte_opmode", "zte_arp_state"].forEach(function (id) {
      var e = zel(id);
      if (e && e.parentElement) e.parentElement.style.display = "none";
    });
    if (have.length) grp.style.display = "";
    gf_find_dns_page().then(function (d) {
      if (!d) return;
      gf_keep_btn("zte_dns");
      have.push("DNS");
      grp.style.display = "";
      gf_mode_text();
    });
    gf_mode_text();
  }
  function gf_mode_text() {
    var m = zel("zte_gf_mode");
    if (m) m.textContent = "goform · " + ((S.gf_actions || []).length ? (S.gf_actions || []).join(", ") : "read-only");
  }

  var GF_PW_KEY = "ZtePanelGfPw";
  var GF_RETRY_KEY = "ZtePanelGfLoginRetry";

  function gf_saved() {
    try {
      var v = JSON.parse(localStorage.getItem(GF_PW_KEY) || "null");
      return v && v.h ? v : null;
    } catch (e) {
      return null;
    }
  }
  function gf_login_info() {
    var c = gf_ui_config();
    if (!c) return { ok: false, broken: true, why: "the router page did not load completely" };
    if (String(c.WEB_ATTR_IF_SUPPORT_SHA256) !== "2")
      return { ok: false, why: "this firmware sends the password only Base64-encoded, so a saved copy would be as good as the password" };
    if (typeof window.paswordAlgorithmsCookie !== "function") return { ok: false, why: "the router page has no password hash function" };
    var svc = gf_svc(), src = "";
    try { src = svc && typeof svc.login === "function" ? String(svc.login) : ""; } catch (e) { src = ""; }
    if (/LOGIN_MULTI_USER/.test(src)) return { ok: true, multi: true };
    if (/goformId\s*:\s*"LOGIN"/.test(src)) return { ok: true, multi: false };
    return { ok: false, why: "the router page's own login could not be found" };
  }

  function gf_login_ready() {
    var c = gf_ui_config();
    if (!c) return false;
    if (String(c.WEB_ATTR_IF_SUPPORT_SHA256) !== "2") return true;
    var svc = gf_svc();
    return typeof window.paswordAlgorithmsCookie === "function" && !!svc && typeof svc.login === "function";
  }
  async function gf_wait_login_ready(ms) {
    var end = Date.now() + ms;
    while (!gf_login_ready() && Date.now() < end) await sleep(500);
    return gf_login_ready();
  }

  async function gf_router_login(sv, goformId) {
    var li = gf_login_info();
    if (!li.ok) return "unsupported";
    var g;
    try { g = await gf_get(["LD", "RD", "wa_inner_version", "cr_version"]); } catch (e) { return "error"; }
    if (!g.LD) return "error";
    var dev = goformId === "DEVELOPER_OPTION_LOGIN";
    var body = { isTest: "false", goformId: dev ? goformId : li.multi ? "LOGIN_MULTI_USER" : "LOGIN", password: window.paswordAlgorithmsCookie(sv.h + g.LD) };
    if (li.multi && !dev) body.user = sv.user || "admin";
    if (typeof window.cookWithRequest === "function" && g.RD)
      body.AD = window.cookWithRequest(window.cookWithRequest(g.wa_inner_version + g.cr_version) + g.RD);
    var j = null;
    try {
      j = JSON.parse(await gf_fetch("/goform/goform_set_cmd_process", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
        body: new URLSearchParams(body).toString(),
      }, 0, function (r) { return r.text(); }));
    } catch (e) {
      return "error";
    }
    var res = j && j.result !== undefined ? String(j.result) : "";
    if (dev) return res === "0" ? "ok" : res === "3" ? "rejected" : res ? "refused" : "error";
    if (res === "0" || res === "4") return "ok";
    if (res === "3") return "rejected";
    if (res === "5") return "locked";
    return "error";
  }

  async function gf_try_auto_login(why) {
    var sv = gf_saved();
    if (!sv) return false;
    if (just_logged_out()) {
      if (why === "start") toast("Logged out. Auto login waits 1 minute after a Logout —\nreload the page after that to log in automatically (or log in on the router page).", "info", 8000);
      return false;
    }
    await gf_wait_login_ready(10000);
    var li = gf_login_info();
    if (li.broken) return gf_reload_broken_page();
    if (ms_since(sessionStorage, LS.TRIED) < 60000) return false;
    if (!li.ok) {
      toast("Auto login is not available on this router's firmware (" + li.why + ").", "warn", 12000);
      return false;
    }
    stamp(sessionStorage, LS.TRIED);
    var res = "error";
    try { res = await gf_router_login(sv); } catch (e) { res = "error"; }
    if (res === "ok") {
      toast("Logged in with the saved password — reloading…", "ok", 3000);
      setTimeout(function () { location.reload(); }, 400);
      return true;
    }
    if ((why === "reboot" || why === "retry") && res !== "rejected" && res !== "locked") return false;
    if (res === "rejected") {
      try { localStorage.removeItem(GF_PW_KEY); } catch (e) { }
      toast("Auto login failed — the router rejected the saved password, so it was removed.\nLog in on the router page, then save it again with 🔑 Auto Login.", "error", 15000);
    } else if (res === "locked") {
      toast("The router has locked logins for a few minutes (too many wrong passwords).\nAuto login waits; log in on the router page later.", "warn", 15000);
    } else if (res === "unsupported") {
      toast("Auto login is not available on this router's firmware.", "warn", 10000);
    } else {
      toast("Auto login did not go through. Log in on the router page.", "warn", 10000);
    }
    return false;
  }

  var GF_PAGE_RELOAD_KEY = "ZtePanelGfPageReload";
  function gf_reload_broken_page() {
    var st = null;
    try { st = JSON.parse(sessionStorage.getItem(GF_PAGE_RELOAD_KEY) || "null"); } catch (e) { st = null; }
    if (!st || Date.now() - st.first > 300000) st = { first: Date.now(), n: 0, at: 0 };
    if (st.n >= 3) {
      toast("The router page did not load completely — reload the page once the router has finished starting.", "warn", 15000);
      return false;
    }
    var wait = Math.max(3000, 20000 - (Date.now() - st.at));
    st.n++; st.at = Date.now() + wait;
    try { sessionStorage.setItem(GF_PAGE_RELOAD_KEY, JSON.stringify(st)); } catch (e) { }
    toast("The router page did not load completely (the router is probably still starting) — reloading it…", "info", wait + 2000);
    setTimeout(function () { location.reload(); }, wait);
    return true;
  }

  function gf_autologin_state() {
    var sv = gf_saved();
    zset("zte_autologin_state", sv ? "on (password saved" + (sv.user ? ", user " + sv.user : "") + ")" : "off");
  }
  function gf_enable_auto_login() {
    var li = gf_login_info();
    if (!li.ok) { toast("Auto login is not available here: " + li.why + ".", "warn", 12000); return; }
    var inStyle = 'style="flex:1;min-width:0;padding:6px 9px;border:1px solid #B0BEC5;border-radius:6px;font-size:12px;background:#fff;color:#37474F;"';
    var ov = show_modal("Auto Login",
      '<div class="zte_sec" style="font-size:12px;line-height:1.5;">' +
      "Save the router password so that the panel logs in by itself when the router page is logged out.<br>" +
      '<span style="color:#78909C;">Only the router\'s own hash of it is stored in this browser. Anyone who can use this browser profile ' +
      "can log in to the router with it. Nothing is changed right now; it is used the next time the page is logged out.</span>" +
      (gf_saved() ? '<br><b style="color:#2E7D32;">A password is already saved</b> <span style="color:#78909C;">(the field stays empty: the password itself is never stored or shown).</span>' : "") +
      (li.multi ? '<div style="display:flex;gap:6px;margin-top:10px;"><input type="text" id="zte_user_in" placeholder="user name" value="' +
        esc((gf_saved() || {}).user || "admin") + '" autocomplete="off" ' + inStyle + "></div>" : "") +
      '<div style="display:flex;gap:6px;margin-top:' + (li.multi ? 6 : 10) + 'px;">' +
      '<input type="password" id="zte_pw_in" placeholder="' + (gf_saved() ? "saved — type a new one to replace it" : "router password") + '" autocomplete="off" ' + inStyle + ">" +
      '<button class="zte_btn ok" id="zte_pw_save">Save</button></div></div>');
    var inp = ov.querySelector("#zte_pw_in"), usr = ov.querySelector("#zte_user_in");
    function save() {
      if (!inp.value) { toast("Type the router password first", "warn"); return; }
      if (usr && !usr.value.trim()) { toast("Type the user name first", "warn"); return; }
      var v = { h: window.paswordAlgorithmsCookie(inp.value) };
      if (usr) v.user = usr.value.trim();
      inp.value = "";
      try { localStorage.setItem(GF_PW_KEY, JSON.stringify(v)); } catch (e) { }
      ov.remove();
      gf_autologin_state();
      toast("Password saved.\nIt is used the next time the router page is logged out.", "ok");
    }
    ov.querySelector("#zte_pw_save").onclick = save;
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") save(); });
    inp.focus();
  }
  function gf_forget_password() {
    if (!gf_saved()) { toast("No saved password to remove.", "info"); return; }
    if (!confirm("Forget the saved router password?\n\nAuto login will stop working until you turn it on again (🔑 Auto Login).")) return;
    try { localStorage.removeItem(GF_PW_KEY); } catch (e) { }
    gf_autologin_state();
    toast("Saved password removed", "info");
  }

  if (GF_ALLOWED.indexOf("developerOptionsLogin") < 0) GF_ALLOWED.push("developerOptionsLogin");
  function gf_has_dev_login() { return gf_has("developerOptionsLogin"); }
  function gf_dev_session_on() {
    if (S.gf_bands) { S.gf_bands.nrGate = null; S.gf_bands.lteGate = null; }
  }
  async function gf_dev_login_saved() {
    var sv = gf_saved();
    if (!sv || S.gf_dev_saved_bad || !gf_login_info().ok || !gf_has_dev_login()) return "none";
    var res = "error";
    try { res = await gf_router_login(sv, "DEVELOPER_OPTION_LOGIN"); } catch (e) { res = "error"; }
    if (res === "ok") gf_dev_session_on();
    else if (res !== "unsupported") S.gf_dev_saved_bad = true;
    return res;
  }
  if (GF_ALLOWED.indexOf("login") < 0) GF_ALLOWED.push("login");
  function gf_sup_possible() { var li = gf_login_info(); return gf_has("login") && li.ok && !li.multi; }
  function gf_higher_login(opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    var dev = opts.dev !== false && gf_has_dev_login(), sup = !!opts.sup && gf_sup_possible();
    if (!dev && !sup) { toast("This router has no developer login.", "warn"); return false; }
    var inStyle = 'style="flex:1;min-width:0;padding:6px 9px;border:1px solid #B0BEC5;border-radius:6px;font-size:12px;background:#fff;color:#37474F;"';
    var field = function (k, ph, btn) {
      return '<div style="display:flex;gap:6px;margin-top:8px;"><input type="password" id="zte_' + k + 'pw_in" placeholder="' + ph + '" autocomplete="off" ' + inStyle + ">" +
        '<button class="zte_btn ok" id="zte_' + k + 'pw_go">' + btn + "</button></div>";
    };
    var ov = show_modal(dev && !sup ? "Developer Login" : "Login with more rights",
      '<div class="zte_sec" style="font-size:12px;line-height:1.5;">' +
      (opts.why ? '<div style="margin-bottom:8px;">' + esc(opts.why) + "</div>" : "") +
      "The password goes to the router's own login function for this session only — it is never stored or shown." +
      (dev ? " The developer password is the login password on most routers." + field("dev", "developer password", "Developer login") : "") +
      (sup ? '<div style="margin-top:10px;color:#546E7A;">Or, on routers with a super admin account (MC888):</div>' + field("sup", "super admin password", "Super admin login") : "") +
      "</div>");
    async function go(kind) {
      var inp = ov.querySelector(kind === "dev" ? "#zte_devpw_in" : "#zte_suppw_in");
      if (!inp.value) { toast("Type the password first", "warn"); return; }
      if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
      var pw = inp.value, name = kind === "dev" ? "Developer" : "Super admin";
      inp.value = "";
      ov.remove();
      S.gf_busy = true;
      try {
        var r = await gf_call(kind === "dev" ? "developerOptionsLogin" : "login", { password: pw }, 8000);
        pw = "";
        var ok = !!r && r.result === true;
        if (ok) gf_dev_session_on();
        if (ok) toast(name + " session active ✓", "ok");
        if (ok && typeof opts.after === "function") setTimeout(opts.after, 300);
        else if (!ok && r && r.timeout) toast(name + " login: no answer from the router — the result is unknown. Try again, or log in again.", "warn", 10000);
        else if (!ok) toast(name + " login failed" + (r && r.error ? " (" + r.error + ")" : " — wrong password?") + ".", "error");
      } finally {
        S.gf_busy = false;
      }
    }
    ["dev", "sup"].forEach(function (k) {
      var inp = ov.querySelector(k === "dev" ? "#zte_devpw_in" : "#zte_suppw_in");
      if (!inp) return;
      ov.querySelector("#zte_" + k + "pw_go").onclick = function () { go(k); };
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(k); });
    });
    var first = ov.querySelector("#zte_devpw_in") || ov.querySelector("#zte_suppw_in");
    if (first) first.focus();
    return true;
  }
  function gf_developer_login() { return gf_higher_login({ dev: true }); }

  function gf_login_retry(retry, why, sup) {
    var dev = gf_has_dev_login(), canSup = !!sup && gf_sup_possible();
    if (!dev && !canSup) return false;
    setTimeout(async function () {
      var res = "none";
      if (dev && !S.gf_busy) {
        S.gf_busy = true;
        try { res = await gf_dev_login_saved(); } finally { S.gf_busy = false; }
      }
      if (res === "ok") {
        toast("Developer session active ✓ (saved password) — sending the change again…", "ok", 5000);
        retry();
        return;
      }
      gf_higher_login({
        dev: dev, sup: canSup, after: retry,
        why: why + (res === "rejected" || res === "refused" ? " The saved login password did not work as the developer password." : "") +
          " Log in with more rights and the change is sent again.",
      });
    }, 0);
    return true;
  }

  var GF_ADV_KEEP = ["Hidden Menus & Pages"];
  function gf_advtools_setup() {
    var p = zel("zte_panel");
    if (!p) return;
    var loginOk = gf_login_info().ok, keep = GF_ADV_KEEP.slice();
    gf_keep_btn("zte_hidden_toggle"); gf_keep_btn("zte_hidden_pages");
    if (gf_has_dev_login()) { window.zte_developer_login = gf_developer_login; if (gf_keep_btn("zte_developer_login")) keep.push("Login"); }
    if (loginOk) {
      window.zte_enable_auto_login = gf_enable_auto_login;
      window.zte_forget_password = gf_forget_password;
      if (gf_keep_btn("zte_enable_auto_login") && gf_keep_btn("zte_forget_password")) keep.push("Login");
    }
    p.querySelectorAll(".zte_grp").forEach(function (g) {
      var n = g.querySelector(".zte_grp_name");
      if (!n || n.textContent.trim() !== "Advanced Tools") return;
      g.querySelectorAll(".zte_sec").forEach(function (s) {
        var t = s.querySelector(".zte_sec_title");
        if (!t || keep.indexOf(t.textContent.trim()) === -1) s.style.display = "none";
      });
      ["zte_sys_timeout_row", "zte_sys_timeout_btns"].forEach(function (id) { var e = zel(id); if (e) e.style.display = "none"; });
      g.style.display = "";
    });
    if (loginOk) gf_autologin_state();
    start_hidden_menus();
  }

  function gf_band_caps() {
    var hasBE = gf_has("set4GBandEXSelect");
    var hasBS = gf_has("setBandSelect");
    var hasSANSA = gf_has("setNr5gSaOrNsaBandSelect");
    var hasOne = gf_has("setNr5gBandSelect");
    return {
      lte: (hasBE || hasBS) && lte_from_router(),
      nr: (hasSANSA || hasOne) && nr_from_router(),
      hasBE: hasBE, hasBS: hasBS, hasSANSA: hasSANSA, hasOne: hasOne,
      lteGate: null, nrGate: null,
      lteMaskLen: null
    };
  }

  function gf_lte_mask_len_for(d) {
    var v = (d && d.lte_band_lock) || "";
    var m = /^0x([0-9a-fA-F]+)$/.exec(String(v).trim());
    if (!m) return null;
    var l = Math.max(m[1].length, S.gf_page_mask_len || 0);
    if (l <= 9) return 9;
    if (l <= 11) return 11;
    if (l === 12) return 12;
    if (l <= 13) return 13;
    return 19;
  }
  function gf_lte_mask(list, digits) {
    var h = lte_mask_from_bands(list).toString(16);
    if (h.length > digits) return null;
    var pad = "0000000000000000000".slice(0, Math.max(0, digits - h.length));
    return "0x" + pad + h;
  }
  function gf_lte_ext_mask(list) { return gf_lte_mask(list, 19); }

  function gf_write_ok(r) { return !!r && !r.error && !r.timeout && r.result === "success"; }
  function gf_write_state(r) {
    if (gf_write_ok(r)) return "ok";
    if (!r || r.timeout || (!r.error && !r.result)) return "unknown";
    return "refused";
  }

  async function gf_read_band_mask_len(tries) {
    var c = S.gf_bands;
    for (var i = 0; i < (tries || 3); i++) {
      if (i) await sleep(1500);
      var g = null;
      try { g = await gf_get(["lte_band_lock", "lte_band_ext_1_64"]); } catch (e) { g = null; }
      var len = g ? gf_lte_mask_len_for(g) : null;
      if (len) { if (c) c.lteMaskLen = len; return len; }
    }
    return null;
  }

  async function gf_net_mode(mode) {
    if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    if (!mode) return;
    var label = "Network mode → " + (NET_MODES[mode] || mode);
    if (!/^[A-Za-z0-9_]{2,40}$/.test(mode)) {
      toast("“" + mode + "” is not a network-mode name (letters, digits and _ only) — nothing was sent.", "error", 9000);
      return;
    }
    if (!confirm("Switch network mode to " + (NET_MODES[mode] || mode) + "?\n\nMobile data drops for a few seconds while the modem re-attaches.")) return;
    S.gf_busy = true;
    try {
      var typeBefore = S.net && S.net.network_type;
      toast(label + "…", "info", 4000);
      var r = await gf_call("setBearerPreference", { strBearerPreference: mode }, 8000);
      var st = gf_write_state(r);
      if (st === "refused") { toast(label + " failed (" + (r.error || r.result) + ").", "error"); return; }
      var d = null, got = null, nt = "", out = false;
      for (var i = 0; i < 8; i++) {
        await sleep(1500);
        try { d = await gf_get(["net_select", "network_type", "loginfo"]); } catch (e) { d = null; }
        if (!d) continue;
        if (d.loginfo !== "ok") { out = true; break; }
        got = d.net_select || "";
        nt = gf_nettype(d.network_type);
        if (got === mode && has_service({ network_type: nt }) && type_fits_mode(mode, nt) &&
          (nt !== typeBefore || i >= 5)) break;
      }
      if (out) {
        toast(label + " sent — the router ended the web session with the change (this model does that), so it could not be read back.\n" +
          (gf_saved() ? "The panel logs in again by itself; check the mode then." : "Log in again to check the mode."), "warn", 12000);
        return;
      }
      if (got === null) { toast(gf_unknown_msg(label + " sent"), "warn", 12000); return; }
      if (got !== mode) {
        toast(label + " — " + (st === "ok" ? "the router accepted it, but" : "no answer to the command, and the router") +
          " still reports " + (NET_MODES[got] || got || "?") + ".", "warn", 10000);
        return;
      }
      var svc = has_service({ network_type: nt });
      if (svc && !type_fits_mode(mode, nt)) {
        toast(label + " stored ✓ — the router still reports " + nt + ".\nThe switch can take a few seconds; check the network type.", "warn", 10000);
        return;
      }
      toast(label + " ✓" + (svc ? " (" + nt + ")" : " — stored; no service yet (" + (nt || "?") + ")"), svc ? "ok" : "warn", svc ? 5000 : 9000);
    } finally {
      S.gf_busy = false;
    }
  }

  function gf_dev_retry(retry, why) { return gf_login_retry(retry, why, false); }
  function gf_lte_alt() { return gf_cells_lte() ? " (Without it: lock an LTE cell of that band — Neighbor Cells → Lock — then restart the router.)" : ""; }
  async function gf_send_lte(list, label, all, inReset, held, retried) {
    if (!held && S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    var retry = function () { gf_send_lte(list, label, all, false, false, true); };
    if (list.some(function (b) { return +b > 64; })) { toast("Bands above 64 are not supported here.", "error"); return; }
    var c = S.gf_bands || gf_band_caps();
    S.gf_busy = true;
    try {
      toast(label + "…", "info", 4000);
      var r;
      if (c.hasBE) {
        r = await gf_call("set4GBandEXSelect", { lte_band_ext_1_64: gf_lte_ext_mask(list) }, 8000);
      } else if (c.hasBS) {
        if (c.lteGate === false) {
          if (!inReset && !held && !retried && gf_dev_retry(retry, "This router takes LTE band changes only with a developer login." + gf_lte_alt())) return;
          toast(inReset ? "LTE band lock not reset: this router takes LTE band changes only with a Developer Options login." :
            "LTE band lock is developer-gated on this router. Log in to Developer Options first" +
            (gf_cells_lte() ? " — or lock an LTE cell of that band (Neighbor Cells → Lock), then restart the router." : "."), "warn", 12000);
          return;
        }
        var len = c.lteMaskLen || (await gf_read_band_mask_len(2));
        if (!len) {
          toast("LTE band lock: couldn't read this router's band-mask format (lte_band_lock is empty) — nothing was sent. Try again in a moment.", "warn", 12000);
          return;
        }
        if (all) list = list.filter(function (b) { return +b <= len * 4; });
        var mask = gf_lte_mask(list, len);
        if (!mask) {
          toast("LTE band lock: this firmware's band mask holds B1–B" + (len * 4) + " only — B" +
            list.filter(function (b) { return +b > len * 4; }).join(", B") + " cannot be set here. Nothing was sent.", "error", 12000);
          return;
        }
        r = await gf_call("setBandSelect", { is_gw_band: "0", gw_band_mask: "0", is_lte_band: "1", lte_band_mask: mask }, 8000);
      } else {
        toast("This router's firmware does not expose any LTE band-lock command.", "warn"); return;
      }
      if (gf_write_state(r) === "refused") {
        c.lteGate = false;
        if (!inReset && !held && !retried && gf_dev_retry(retry, "The router refused the LTE band change without a developer login." + gf_lte_alt())) return;
        if (inReset) toast("LTE band lock not reset: the router refused it (" + (r.error || r.result) + ")." +
          "\nOn this firmware LTE band changes may need a Developer Options login.", "error");
        else if (retried) toast("The router refused the LTE band change with the developer session too (" + (r.error || r.result) + ").", "error");
        else toast("The router did not apply the LTE band change (" + (r.error || r.result) + ")." +
          "\nIt may need a Developer Options login" + (gf_cells_lte() ? " — or lock an LTE cell of that band (Neighbor Cells → Lock), then restart the router." : "."), "error");
        return;
      }
      await sleep(1500);
      var g = await gf_read_back(["lte_band_lock", "lte_band_ext_1_64"]);
      if (!g) { toast(gf_unknown_msg(label + " sent"), "warn", 14000); return; }
      var now = lte_bands_from_mask(gf_lte_lock_field(g)) || [];
      var ok = now.length === list.length && list.every(function (b) { return now.indexOf(+b) > -1; });
      if (ok) gf_mine_set("lte", all ? null : now.join(","));
      gf_poll_once(true);
      toast(ok ? label + " ✓" : label + " — sent, but the router reads back B" + (now.join(", B") || "?") + ".", ok ? "ok" : "warn", ok ? 5000 : 10000);
    } finally {
      if (!held) S.gf_busy = false;
    }
  }

  async function gf_send_nr(sa, label, nsa, unlock, held, retried) {
    if (!held && S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    var c = S.gf_bands || gf_band_caps();
    var saAvail = nr_avail("sa"), nsaAvail = nr_avail("nsa");
    var want = sa.concat([]), wantNsa = (nsa || want).concat([]);
    sa = want.filter(function (b) { return saAvail.indexOf(String(b)) > -1; });
    nsa = wantNsa.filter(function (b) { return nsaAvail.indexOf(String(b)) > -1; });
    if (!sa.length && !nsa.length) { toast("None of these bands is in the router's 5G lists.", "error"); return; }

    S.gf_busy = true;
    try {
      toast(label + "…", "info", 4000);
      var errs = [], unk = [], tried = 0;
      var mark = function (r, what) { var st = gf_write_state(r); if (st === "refused") errs.push(what); else if (st === "unknown") unk.push(what); };
      if (c.hasSANSA && c.nrGate !== false) {
        if (sa.length) {
          tried++;
          var r1 = await gf_call("setNr5gSaOrNsaBandSelect", { nr5g_band_mask: sa.join(","), type: "0" }, 8000);
          mark(r1, "SA");
        }
        if (nsa.length) {
          tried++;
          var r2 = await gf_call("setNr5gSaOrNsaBandSelect", { nr5g_band_mask: nsa.join(","), type: "1" }, 8000);
          mark(r2, "NSA");
        }
        if (tried > 0 && errs.length === tried && c.hasOne) { c.nrGate = false; errs = []; }
      }
      if (errs.length === 0 && unk.length === 0 && (c.nrGate === false || !c.hasSANSA) && c.hasOne) {
        var union = {};
        sa.forEach(function (b) { union[String(b)] = true; });
        nsa.forEach(function (b) { union[String(b)] = true; });
        var list = Object.keys(union).sort(function (a, b) { return +a - +b; });
        if (!list.length) { toast("No 5G bands to send.", "error"); return; }
        if (sa.join() !== nsa.join()) {
          var saStr = sa.map(String), nsaStr = nsa.map(String);
          var saMiss = list.filter(function (b) { return saStr.indexOf(String(b)) < 0; });
          var nsaMiss = list.filter(function (b) { return nsaStr.indexOf(String(b)) < 0; });
          var note = "This router takes 5G band locks only as one list for 5G SA and 5G NSA together.\n\n" +
            "Sending n" + list.join(",n") + " to both.\n" +
            (saMiss.length ? "  · bands likely dropped by SA: n" + saMiss.join(",n") + "\n" : "") +
            (nsaMiss.length ? "  · bands likely dropped by NSA: n" + nsaMiss.join(",n") + "\n" : "") +
            "\nContinue?";
          if (!confirm(note)) { toast("5G band lock cancelled.", "info"); return; }
        }
        var r3 = await gf_call("setNr5gBandSelect", { nr5g_band_mask: list.join(",") }, 8000);
        mark(r3, "one-list");
      }
      var refusedTxt = "The router did not apply the 5G band change (" + errs.join(" + ") + ")" +
        (c.nrGate === false ? " — 5G band lock may need Developer Options login on this firmware" : "");
      if (errs.length && !unk.length) {
        if (!held && !retried && gf_dev_retry(function () { gf_send_nr(want, label, wantNsa, unlock, false, true); },
          "The router refused the 5G band change without a developer login.")) return;
        toast(retried ? "The router refused the 5G band change with the developer session too (" + errs.join(" + ") + ")." : refusedTxt + ".", "error", 10000);
        return;
      }
      await sleep(1500);
      var g = await gf_read_back(["nr5g_sa_band_lock", "nr5g_nsa_band_lock"]);
      if (!g) { toast(gf_unknown_msg(label + " sent") + (errs.length ? "\n" + refusedTxt + "." : ""), "warn", 14000); return; }
      var same = function (want, got) {
        var l = band_list(got), w = want.map(String);
        if (unlock) return l.length > 0 && l.every(function (b) { return w.indexOf(b) > -1; }) &&
          CFG.nr_all_bands.filter(function (b) { return w.indexOf(String(b)) > -1; }).every(function (b) { return l.indexOf(String(b)) > -1; });
        return w.length === l.length && w.every(function (b) { return l.indexOf(b) > -1; });
      };
      var ok = !errs.length && (!sa.length || same(sa, g.nr5g_sa_band_lock)) && (!nsa.length || same(nsa, g.nr5g_nsa_band_lock));
      if (ok) { gf_mine_set("sa", unlock ? null : band_list(g.nr5g_sa_band_lock).join(",")); gf_mine_set("nsa", unlock ? null : band_list(g.nr5g_nsa_band_lock).join(",")); }
      gf_poll_once(true);
      toast(ok ? label + " ✓" : (errs.length ? refusedTxt + "; " : label + " — sent, but ") + "the router reads back SA n" + (band_list(g.nr5g_sa_band_lock).join(",n") || "?") +
        " · NSA n" + (band_list(g.nr5g_nsa_band_lock).join(",n") || "?") + ".", ok ? "ok" : "warn", ok ? 5000 : 10000);
    } finally {
      if (!held) S.gf_busy = false;
    }
  }

  async function gf_lte_band(bands) {
    if (!bands) bands = prompt("LTE bands (e.g. 1+3+20)\nThis router has: B" + lte_avail().join(", B") + "\nType AUTO to remove the LTE band lock.", "AUTO");
    if (!bands) return;
    if (bands.trim().toUpperCase() === "AUTO") return gf_lte_band_unlock(true);
    var list = parse_band_input(bands);
    if (!list) { toast("Invalid band input — use e.g. 1+3+7 or AUTO", "error"); return; }
    var missing = bands_missing(list, lte_avail(), true);
    if (missing.length) { toast("This router does not have B" + missing.join(", B") + ".\nIt has: B" + lte_avail().join(", B"), "error", 9000); return; }
    return gf_send_lte(list, "LTE bands B" + list.join("+B"));
  }
  async function gf_lte_band_unlock(skipConfirm, inReset, held) {
    var all = S.gf_nolist && (S.gf_all_lte || []).length ? S.gf_all_lte.map(String) : lte_avail_in_mask();
    if (!skipConfirm && !confirm("Remove LTE band lock?\n\nLocks to all bands of this router: B" + all.join(", B"))) return;
    return gf_send_lte(all, "LTE band lock removed", true, inReset, held);
  }
  function gf_lte_all_set(g) {
    var lb = lte_bands_from_mask(gf_lte_lock_field(g || {}));
    if (!lb || !lb.length) return null;
    var want = S.gf_nolist && (S.gf_all_lte || []).length ? S.gf_all_lte : lte_avail_in_mask();
    if (!want.length) return null;
    return want.every(function (b) { return lb.indexOf(+b) > -1; });
  }
  function gf_nr_all_set(g) {
    var axis = function (want, got) {
      var l = band_list(got);
      if (!want.length) return true;
      if (!l.length) return null;
      var has = function (w) { return w.length > 0 && w.every(function (b) { return l.indexOf(String(b)) > -1; }); };
      return has(want.map(String)) || has(want.map(String).filter(function (b) { return CFG.nr_all_bands.indexOf(b) > -1; }));
    };
    var a = axis(nr_avail("sa"), (g || {}).nr5g_sa_band_lock), b = axis(nr_avail("nsa"), (g || {}).nr5g_nsa_band_lock);
    if (a === false || b === false) return false;
    return a === null || b === null ? null : true;
  }
  async function gf_nr_band(bands) {
    if (!bands) bands = prompt("5G NR bands (e.g. 78+28)\nThis router has: n" + nr_avail().join(", n") + "\nType AUTO to remove the NR band lock.", "AUTO");
    if (!bands) return;
    if (bands.trim().toUpperCase() === "AUTO") return gf_nr_band_unlock(true);
    var list = parse_band_input(bands);
    if (!list) { toast("Invalid band input — use e.g. 78+28 or AUTO", "error"); return; }
    var missing = bands_missing(list, nr_avail(), true);
    if (missing.length) { toast("This router does not have n" + missing.join(", n") + ".\nIt has: n" + nr_avail().join(", n"), "error", 9000); return; }
    return gf_send_nr(list, "5G bands n" + list.join("+n"));
  }
  async function gf_nr_band_unlock(skipConfirm, held) {
    if (!skipConfirm && !confirm("Remove NR (5G) band lock?\n\nLocks to all bands of this router: n" + nr_avail().join(", n"))) return;
    return gf_send_nr(nr_avail("sa"), "NR band lock removed", nr_avail("nsa"), true, held);
  }
  async function gf_unlock_all_bands() {
    if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    if (!confirm("Remove ALL band locks (LTE + 5G NR)?")) return;
    var c = gf_band_caps();
    S.gf_busy = true;
    try {
      if (c.lte) await gf_lte_band_unlock(true, false, true);
      if (c.lte && c.nr && (await gf_seq_session_gone("Remove ALL band locks"))) return;
      if (c.nr) await gf_nr_band_unlock(true, true);
    } finally {
      S.gf_busy = false;
    }
  }

  async function gf_bands_from_page() {
    var rq = window.requirejs || window.require;
    if (!S.gf_nolist || !rq || typeof rq.toUrl !== "function" || typeof DOMParser !== "function") return false;
    var routes = gf_routes().sort(function (a, b) { return (/develop|debug|band/i.test(b.path) ? 1 : 0) - (/develop|debug|band/i.test(a.path) ? 1 : 0); });
    var cfg = gf_ui_config() || {};
    for (var i = 0; i < routes.length; i++) {
      var t = await gf_text(rq.toUrl("tmpl/" + routes[i].path + ".html"));
      if (!t || !/id="lteBand\d+Enable"|id="nr5gSaDiv"|id="nr5gNsaDiv"|id="nr5gBand\d+"|id="frequencyType"/.test(t)) continue;
      var js = await gf_text(rq.toUrl(routes[i].path + ".js"));
      var doc = new DOMParser().parseFromString(t, "text/html");
      var lteJs = /\.setBandSelect\(/.test(js), nrJs = /\.setNr5gSaOrNsaBandSelect\(|\.setNr5gBandSelect\(/.test(js);
      var lte = lteJs ? [].map.call(doc.querySelectorAll("input[id^=lteBand]"), function (x) {
        var m = /^lteBand(\d+)Enable$/.exec(x.id); return m ? m[1] : null; }).filter(Boolean) : [];
      var ftype = Array.isArray(cfg.FREQUENCY_TYPE_4G) ? cfg.FREQUENCY_TYPE_4G : [];
      if (lteJs && !lte.length && doc.getElementById("frequencyType") && ftype.length) {
        lte = ftype.map(function (x) { return x && /^\d+$/.test(String(x.name)) ? String(x.name) : null; }).filter(Boolean);
        var w = Math.max.apply(null, ftype.map(function (x) { var m = /^0x([0-9a-fA-F]+)$/.exec(String((x && x.value) || "")); return m ? m[1].length : 0; }));
        if (w >= 9 && w <= 19) S.gf_page_mask_len = w;
      }
      var nrl = function (sel) {
        return nrJs ? [].map.call(doc.querySelectorAll(sel), function (x) { return /^\d+$/.test(x.value) ? x.value : null; }).filter(Boolean) : [];
      };
      var sa = nrl("#nr5gSaDiv input"), nsa = nrl("#nr5gNsaDiv input");
      if (!sa.length && !nsa.length) sa = nsa = nrl("input[id^=nr5gBand]");
      if (!lte.length && !sa.length && !nsa.length) continue;
      var pad = /padLeft\(\s*\w+\s*,\s*(\d+)\s*-/.exec(js);
      if (pad && +pad[1] >= 9 && +pad[1] <= 19) S.gf_page_mask_len = +pad[1];
      var def = await gf_nr_defaults();
      var num = function (a, b) { return +a - +b; };
      var uni = function (a, b) { var o = {}; a.concat(b).forEach(function (x) { o[String(x)] = 1; }); return Object.keys(o).sort(num); };
      S.bands = { lte: lte.sort(num), nr_sa: sa.length ? uni(sa, def.sa) : [], nr_nsa: nsa.length ? uni(nsa, def.nsa) : [] };
      render_band_chips();
      gf_bands_setup();
      return true;
    }
    return false;
  }
  async function gf_nr_defaults() {
    var key = "ZtePanelGfNrDefaults:" + (S.gf_model || "?"), have = null;
    try { have = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { have = null; }
    var g = null;
    try { g = await gf_get(["nr5g_sa_band_lock", "nr5g_nsa_band_lock", "model_name"]); } catch (e) { g = null; }
    if (g && g.model_name && !S.gf_model) { S.gf_model = g.model_name; key = "ZtePanelGfNrDefaults:" + g.model_name; try { have = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { have = null; } }
    var full = function (l) { return l.length && CFG.nr_all_bands.every(function (b) { return l.indexOf(String(b)) > -1; }); };
    if (!have && g) {
      var sa = band_list(g.nr5g_sa_band_lock), nsa = band_list(g.nr5g_nsa_band_lock);
      if (full(sa) || full(nsa)) {
        have = { sa: full(sa) ? sa : [], nsa: full(nsa) ? nsa : [] };
        try { localStorage.setItem(key, JSON.stringify(have)); } catch (e) { }
      }
    }
    return { sa: (have && have.sa) || [], nsa: (have && have.nsa) || [] };
  }

  function gf_bands_setup() {
    var p = zel("zte_panel"), c = gf_band_caps();
    if (!p || (!c.lte && !c.nr)) return;
    if (!zel("zte_gf_band_css")) {
      var st = document.createElement("style");
      st.id = "zte_gf_band_css";
      st.textContent = "#zte_panel.zte_gf .zte_gf_bands_on .zte_bandrow{display:flex !important}" +
        "#zte_panel.zte_gf .zte_gf_bands_on .zte_chip{display:inline-block !important}";
      document.head.appendChild(st);
    }
    if (c.lte) {
      window.zte_lte_band = gf_lte_band;
      window.zte_lte_band_unlock = gf_lte_band_unlock;
      var lc = zel("zte_lte_chips");
      if (lc) lc.classList.add("zte_gf_bands_on");
      gf_keep_btn("zte_lte_band_unlock");
    }
    if (c.nr) {
      window.zte_nr_band = gf_nr_band;
      window.zte_nr_band_unlock = gf_nr_band_unlock;
      var nc = zel("zte_nr_chips");
      if (nc) nc.classList.add("zte_gf_bands_on");
      gf_keep_btn("zte_nr_band_unlock");
    }
    if (c.lte && c.nr) {
      window.zte_unlock_all_bands = gf_unlock_all_bands;
      if (gf_keep_btn("zte_unlock_all_bands")) {
        p.querySelectorAll(".zte_sec").forEach(function (s) {
          var t = s.querySelector(".zte_sec_title");
          if (t && t.textContent.trim() === "Band Lock — Global Reset") s.style.display = "";
        });
      }
    }
    S.gf_bands = c;
    gf_read_band_mask_len().catch(function (e) { });
  }

  function gf_netmode_setup() {
    var p = zel("zte_panel");
    if (!p || !gf_has("setBearerPreference")) return;
    window.zte_set_net_mode = gf_net_mode;
    gf_keep_btn("zte_set_net_mode");
    p.querySelectorAll(".zte_sec").forEach(function (s) {
      var t = s.querySelector(".zte_sec_title");
      if (t && t.textContent.trim() === "Network Mode") s.style.display = "";
    });
  }

  var GF_IDS = { setCellLockSetting: "LTE_LOCK_CELL_SET", setCellLock5gSetting: "NR5G_LOCK_CELL_SET",
    setNetworkUnlock: "RESET_BAND_CELL_SETTING", SetOperationMode: "OPERATION_MODE" };
  ["setCellLockSetting", "setCellLock5gSetting", "setNetworkUnlock", "SetOperationMode"].forEach(function (m) { if (GF_ALLOWED.indexOf(m) < 0) GF_ALLOWED.push(m); });
  if (GF_ALLOWED.indexOf("setTR069Configuration") < 0) GF_ALLOWED.push("setTR069Configuration");
  var GF_PASS_NO_KEY = "ZtePanelGfNoPassLock:", GF_PASS_FAIL_KEY = "ZtePanelGfPassLockFail:";
  function gf_pass_ok() {
    if (!gf_has("setTR069Configuration")) return false;
    try {
      var src = String(gf_svc().setTR069Configuration);
      return /extend\(\s*\{\s*isTest/.test(src) && !/goformId/.test(src);
    } catch (e) { return false; }
  }
  function gf_nr_lock_write(val) {
    if (gf_has_id("setCellLock5gSetting")) return gf_call("setCellLock5gSetting", { nr5g_cell_lock: val }, 10000);
    if (S.gf_cells && S.gf_cells.nrPass) return gf_call("setTR069Configuration", { goformId: "NR5G_LOCK_CELL_SET", nr5g_cell_lock: val }, 10000);
    return Promise.resolve({ error: "not available" });
  }
  function gf_pass_refused(kind) {
    var id = kind + ":" + (S.gf_model || "?"), n = 0;
    try { n = (Number(localStorage.getItem(GF_PASS_FAIL_KEY + id)) || 0) + 1; localStorage.setItem(GF_PASS_FAIL_KEY + id, String(n)); } catch (e) { n = 1; }
    if (n < 2) return "\nThis router has no cell lock page, so the panel sends it through the router's own save function — if the next try is not saved either, " +
      "the panel stops offering this lock on this model.";
    try { localStorage.setItem(GF_PASS_NO_KEY + id, "1"); localStorage.removeItem(GF_PASS_FAIL_KEY + id); } catch (e) { }
    return "\nNot saved twice through the router's own save function: this firmware does not keep that lock, so the panel no longer offers it on this model.";
  }
  function gf_pass_saved(kind) {
    try { localStorage.removeItem(GF_PASS_FAIL_KEY + kind + ":" + (S.gf_model || "?")); } catch (e) { }
  }
  function gf_lte_lock_write(pci, earfcn) {
    if (gf_has_id("setCellLockSetting")) return gf_call("setCellLockSetting", { lte_pci_lock: pci, lte_earfcn_lock: earfcn }, 10000);
    if (S.gf_cells && S.gf_cells.ltePass) return gf_call("setTR069Configuration", { goformId: "LTE_LOCK_CELL_SET", lte_pci_lock: pci, lte_earfcn_lock: earfcn }, 10000);
    return Promise.resolve({ error: "not available" });
  }

  function gf_has_id(m) {
    if (!gf_has(m)) return false;
    try { return String(gf_svc()[m]).indexOf(GF_IDS[m]) > -1; } catch (e) { return false; }
  }

  async function gf_cell_caps() {
    if (S.gf_cells) return S.gf_cells;
    var c = { lte: false, nr: false, reset: false, bridge: false, port2: false };
    var rq = window.requirejs || window.require;
    var want = gf_has_id("setCellLockSetting") || gf_has_id("setCellLock5gSetting") || gf_has_id("setNetworkUnlock") || gf_has_id("SetOperationMode");
    if (want && rq && typeof rq.toUrl === "function") {
      var extraPaths = await gf_extra_module_paths();
      var routes = gf_routes().sort(function (a, b) {
        return (/develop|debug|network_mode|lock/i.test(b.path) ? 1 : 0) - (/develop|debug|network_mode|lock/i.test(a.path) ? 1 : 0);
      });
      var all = routes.concat(extraPaths.map(function (p) { return { path: p, hash: "" }; }));
      for (var i = 0; i < all.length; i++) {
        var js = await gf_text(rq.toUrl(all[i].path + ".js"));
        if (!/setCellLock|setNetworkUnlock|SetOperationMode/.test(js)) continue;
        if (/\.setCellLockSetting\(/.test(js)) c.lte = true;
        if (/\.setCellLock5gSetting\(/.test(js)) c.nr = true;
        if (/\.setNetworkUnlock\(/.test(js)) c.reset = true;
        if (!/\.SetOperationMode\(/.test(js) || !/LTE_BRIDGE/.test(js)) continue;
        var t = await gf_text(rq.toUrl("tmpl/" + all[i].path + ".html"));
        if (/change_network_mode_bridge|value="LTE_BRIDGE"/.test(t)) {
          c.bridge = true;
          c.port2 = /name="opMode2"[^>]*value="1"|value="1"[^>]*name="opMode2"|opMode_LAN2/.test(t);
        }
      }
    }
    c.lte = c.lte && gf_has_id("setCellLockSetting");
    c.nr = c.nr && gf_has_id("setCellLock5gSetting");
    if ((!c.lte && !gf_has("setCellLockSetting") || !c.nr && !gf_has("setCellLock5gSetting")) && gf_pass_ok()) {
      if (!S.gf_model) try { S.gf_model = (await gf_get(["model_name"])).model_name || ""; } catch (e) { }
      var no = function (kind) { try { return !!localStorage.getItem(GF_PASS_NO_KEY + kind + ":" + (S.gf_model || "?")); } catch (e) { return false; } };
      if (!c.lte && !gf_has("setCellLockSetting") && !no("lte")) { c.lte = true; c.ltePass = true; }
      if (!c.nr && !gf_has("setCellLock5gSetting") && !no("nr")) { c.nr = true; c.nrPass = true; }
    }
    c.reset = c.reset && gf_has_id("setNetworkUnlock");
    var cfg = gf_ui_config();
    var cfgBridgeOk = !cfg || (cfg.OPMODE_CHANGE_SUPPORT !== false &&
      (!Array.isArray(cfg.OPERATE_MODE) || cfg.OPERATE_MODE.indexOf("LTE_BRIDGE") > -1));
    c.bridge = c.bridge && gf_has_id("SetOperationMode") && cfgBridgeOk;
    S.gf_cells = c;
    return c;
  }

  async function gf_extra_module_paths() {
    var rq = window.requirejs || window.require;
    if (!rq || typeof rq.toUrl !== "function") return [];
    var home = await gf_text(rq.toUrl("home.js"));
    if (!home) return [];
    var paths = {};
    String(home).replace(/showSettingWindow\s*\(\s*["'][^"']+["']\s*,\s*["']([\w\/_\-]+)["']\s*,\s*["']([\w\/_\-]+)["']/g, function (_, a, b) {
      paths[a] = 1; paths[b] = 1;
    });
    String(home).replace(/showOpModeWindow[\s\S]{0,120}?["']([\w\/_\-]+opmode[\w\/_\-]*)["']/g, function (_, p) { paths[p] = 1; });
    return Object.keys(paths);
  }

  function gf_parse_ngbr(s) {
    return String(s || "").split(";").map(function (e) { return e.trim(); }).filter(Boolean).map(function (e) {
      var p = e.split(",").map(function (x) { return x.trim(); });
      var ok = p.length >= 4 && /^\d+$/.test(p[0]) && /^\d+$/.test(p[1]) && /^-?\d+(\.\d+)?$/.test(p[2]) && /^-\d+(\.\d+)?$/.test(p[3]) &&
        +p[2] <= 0 && +p[2] >= -40 && +p[3] <= -40 && +p[3] >= -160;
      if (!ok) return { type: "LTE", obj: { raw: e } };
      var cv = lte_earfcn_to_mhz(+p[0]);
      return { type: "LTE", obj: { raw: e }, earfcn: p[0], pci: p[1], rsrq: p[2], rsrp: p[3], sinr: p[4] || "",
        band: cv ? "B" + cv.band : "" };
    });
  }
  async function gf_nbr_read() {
    var g = {};
    try { g = await gf_get(["ngbr_cell_info"]); } catch (e) { return null; }
    return g.ngbr_cell_info || "";
  }
  async function gf_nbr_show() {
    ztoggle("zte_scan_panel", true);
    zset("zte_scan_status", "Reading…");
    var raw = await gf_nbr_read();
    if (raw === null) { zset("zte_scan_status", "No answer from the router — try again in a moment."); return; }
    S.nbr_raw = { lte: raw };
    var rows = gf_parse_ngbr(raw);
    var lp = String(S.net.lte_pci || ""), lc = String(S.net.gf_pcell_earfcn || "");
    rows.forEach(function (r) { r.serving = r.pci === lp && r.earfcn === lc; });
    S.nbr = rows.sort(function (a, b) { return (num(b.rsrp) || -999) - (num(a.rsrp) || -999); });
    render_nbr(rows.length ? rows.length + " LTE cell(s) the router measures now · " + new Date().toLocaleTimeString() +
      (rows.some(function (r) { return r.serving; }) ? " · ★ = serving cell" : "") : "The router reports no neighbor cells right now.");
    var tb = zel("zte_scan_tbody");
    if (!tb) return;
    [].forEach.call(tb.rows, function (tr, i) {
      var r = S.nbr[i];
      if (r && r.serving && tr.cells[5]) { tr.cells[5].textContent += " ★"; tr.title = "serving cell · " + tr.title; }
      tr.querySelectorAll(".zte_btn").forEach(function (b) { if (S.gf_cells && S.gf_cells.lte) b.classList.add("zte_gf_keep"); });
    });
  }
  async function gf_force_lock(i) {
    var c = (S.nbr || [])[i];
    if (!c || !S.gf_cells || !S.gf_cells.lte) return;
    return gf_lte_cell_apply(c.pci, c.earfcn);
  }

  var GF_CELL_WARN = "⚠️ The router's own page warns: a wrong cell lock can leave the router without service.\n" +
    "Use the values of a cell the router measures (Network / neighbor list).";
  function gf_scs_for(band) { return [1, 2, 3, 5, 7, 8, 12, 20, 25, 28, 66, 71, 75, 76].indexOf(+band) > -1 ? "15" : "30"; }

  async function gf_cell_wait(test, ms) {
    var end = Date.now() + ms, d = null;
    while (Date.now() < end) {
      await sleep(Math.min(3000, Math.max(0, end - Date.now())));
      var left = end - Date.now();
      if (left < 300) break;
      var g = null;
      try { g = await gf_get(GF_FAST.concat(GF_SLOW), left); } catch (e) { g = null; }
      if (!g) continue;
      if (g.loginfo !== "ok") return { ok: false, d: null, lost: true };
      d = gf_netinfo(g);
      if (test(d)) return { ok: true, d: d };
    }
    return { ok: false, d: d };
  }
  function gf_lost(what) {
    return what + " — the web session ended, so the result is unknown. " +
      (gf_saved() ? "The panel logs in again by itself; check Cell Lock then." : "Log in again and check Cell Lock.");
  }
  function gf_cells_lte() { return !!(S.gf_cells && S.gf_cells.lte); }
  async function gf_offer_reboot(what, lte, removal) {
    if (!gf_has("restart")) { toast(what + " is saved — restart the router to apply it.", "warn", 12000); return; }
    if (!confirm((removal ? what + " is saved.\n\nOn this router a cell lock is removed when the router restarts. Restart now?" :
      what + " is saved, but the router is not on that cell yet.\n\n" +
      "On this router a cell lock is applied when the router restarts. Restart now?") + "\n(about 1–2 min; Wi-Fi and all connections drop)\n\n" +
      (lte ? "Note: after the restart the router attaches to that cell (MC889A Pro: a restart applied it where two network-mode " +
        "switches did not). In 5G NSA the network can still move it later — to keep the router on an LTE band, use the LTE band lock.\n\n" : "") +
      "OK = restart now · Cancel = it applies at the next restart")) {
      toast(what + " is saved — it applies after the next restart.", "info", 10000);
      return;
    }
    var r = await gf_call("restart", {}, 6000);
    if (r.timeout) { gf_reboot_sent("No answer — the router is probably restarting"); return; }
    if (r.error || (r.result && r.result !== "success")) { toast("The router refused the reboot (" + (r.error || r.result) + ").", "error"); return; }
    gf_reboot_sent();
  }

  async function gf_lte_cell_apply(pci, earfcn, retried) {
    if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    var chk = check_lte_cell(pci, earfcn);
    if (chk.error) { toast("LTE cell lock: " + chk.error, "error", 9000); return; }
    var cv = lte_earfcn_to_mhz(+chk.earfcn);
    if (!retried && !confirm("Lock LTE to cell PCI " + chk.pci + " · EARFCN " + chk.earfcn + (cv ? " (B" + cv.band + ")" : "") + "?\n\n" + GF_CELL_WARN +
      ((S.gf_cells || {}).ltePass ? "\n\nThis router's web pages have no cell lock: the panel sends it through the router's own save " +
        "function (the router signs it, as for every other change). It applies when the router restarts." : "") +
      "\n\nMobile data may drop for a moment. Remove it later with \"LTE Unlock\".")) return;
    S.gf_busy = true;
    try {
      toast("Setting the LTE cell lock…", "info", 4000);
      var r = await gf_lte_lock_write(chk.pci, chk.earfcn);
      var pass = !!(S.gf_cells || {}).ltePass;
      if (gf_write_state(r) === "refused") {
        if (!pass && !retried && gf_login_retry(function () { gf_lte_cell_apply(chk.pci, chk.earfcn, true); },
          "The router refused the LTE cell lock with the current login.", true)) return;
        toast("The router did not apply the LTE cell lock (" + (r.error || r.result) + ")." + (pass ? gf_pass_refused("lte") : retried ? "" : gf_cell_refused_hint()), "error", 15000);
        return;
      }
      var want = chk.pci + "," + chk.earfcn;
      var saved = function (d) { return d.lock_lte_cell === want; };
      var on = function (d) {
        var nt = String(d.network_type || "");
        return !!nt && !/NO_SERVICE|LIMITED/i.test(nt) && d.lte_pci === chk.pci && String(d.gf_pcell_earfcn) === chk.earfcn;
      };
      var w = await gf_cell_wait(function (d) { return saved(d) && on(d); }, 15000);
      if (w.lost) { toast(gf_lost("LTE cell lock sent"), "warn", 12000); return; }
      if (!w.d) { toast(gf_unknown_msg("LTE cell lock sent"), "warn", 12000); return; }
      if (w.ok || saved(w.d)) { if (pass) gf_pass_saved("lte"); }
      if (w.ok) { toast("LTE cell lock " + want + " ✓ — saved, and the router is on that cell.", "ok", 8000); return; }
      if (saved(w.d)) {
        await gf_offer_reboot("LTE cell lock " + want, true);
      } else {
        toast("LTE cell lock sent, but the router reads back " + (w.d.lock_lte_cell || "no lock") +
          " — the lock is not confirmed." + (pass ? gf_pass_refused("lte") : ""), "warn", 15000);
      }
    } finally {
      S.gf_busy = false;
      gf_poll_once(true);
    }
  }
  function gf_cell_refused_hint() {
    return "\nOn some firmware (MC888) the cell lock is taken only with the super admin or a Developer Options login.";
  }
  async function gf_lte_cell_lock(reset) {
    var c = S.gf_cells || {};
    if (reset) return c.lte ? gf_cell_zero(false) : gf_cell_reset("LTE cell lock", S.net.lock_lte_cell);
    if (!c.lte) { toast("This router's pages have no LTE cell lock.", "warn"); return; }
    var def = (S.net.lte_pci || "") + "," + (S.net.gf_pcell_earfcn || "");
    var inp = prompt("LTE cell lock — PCI,EARFCN (e.g. 413,1700)\nDefault = current cell", def);
    if (!inp) return;
    var p = inp.split(",").map(function (x) { return x.trim(); });
    if (p.length !== 2) { toast("Invalid input — use PCI,EARFCN", "error"); return; }
    return gf_lte_cell_apply(p[0], p[1]);
  }

  async function gf_nr_cell_lock(reset) {
    var c = S.gf_cells || {};
    if (reset) return c.nr ? gf_cell_zero(true) : gf_cell_reset("5G cell lock", S.net.lock_nr_cell);
    if (!c.nr) { toast("This router's pages have no 5G cell lock.", "warn"); return; }
    if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    var band = strip_n(S.net.nr5g_action_band || "") ||
      (S.net.nr5g_action_channel ? nr_band("", nr_arfcn_to_mhz(+S.net.nr5g_action_channel)) : "");
    var def = S.net.nr5g_pci ? [S.net.nr5g_pci, S.net.nr5g_action_channel || "", band, band ? gf_scs_for(band) : ""].join(",") : "";
    var inp = prompt("5G cell lock — PCI,ARFCN,BAND,SCS (e.g. 73,634080,78,30)\nSCS in kHz: 15, 30, 60 or 120\nDefault = current 5G cell", def);
    if (!inp) return;
    var p = inp.split(",").map(function (x) { return x.trim(); });
    if (p.length !== 4) { toast("Invalid input — use PCI,ARFCN,BAND,SCS", "error"); return; }
    var chk = check_nr_cell(p[0], p[1], p[2]);
    if (chk.error) { toast("5G cell lock: " + chk.error, "error", 9000); return; }
    if (["15", "30", "60", "120"].indexOf(String(parseInt(p[3], 10))) === -1 || !/^\d+$/.test(p[3])) { toast("SCS must be 15, 30, 60 or 120", "error"); return; }
    var scs = String(parseInt(p[3], 10));
    var sa = nr_avail("sa");
    if (sa.length && sa.indexOf(String(chk.band)) === -1) { toast("The router's 5G cell lock offers n" + sa.join(", n") + " only.", "error", 9000); return; }
    var val = [chk.pci, chk.arfcn, chk.band, scs].join(",");
    if (!confirm("Lock 5G to cell PCI " + chk.pci + " · ARFCN " + chk.arfcn + " · n" + chk.band + " · SCS " + scs + " kHz?\n\n" + GF_CELL_WARN +
      ((S.gf_cells || {}).nrPass ? "\n\nThis router's web pages have no 5G cell lock: the panel sends it through the router's own save " +
        "function (the router signs it, as for every other change). It applies when the router restarts." : "") +
      "\n\nRemove it later with \"5G Unlock\".")) return;
    return gf_nr_cell_send(chk, val, false);
  }
  async function gf_nr_cell_send(chk, val, retried) {
    if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    S.gf_busy = true;
    try {
      toast("Setting the 5G cell lock…", "info", 4000);
      var r = await gf_nr_lock_write(val);
      var pass = !!(S.gf_cells || {}).nrPass;
      if (gf_write_state(r) === "refused") {
        if (!pass && !retried && gf_login_retry(function () { gf_nr_cell_send(chk, val, true); },
          "The router refused the 5G cell lock with the current login.", true)) return;
        toast("The router did not apply the 5G cell lock (" + (r.error || r.result) + ")." + (pass ? gf_pass_refused("nr") : retried ? "" : gf_cell_refused_hint()), "error", 15000);
        return;
      }
      var saved = function (d) { return d.lock_nr_cell === val; };
      var has_nr_service = function (nt) { return nt === "ENDC" || nt === "LTE-NSA" || nt === "SA"; };
      var nr_scell_match = function (d) {
        return String(d.nrca || "").split(";").some(function (e) {
          var p = e.split(",").map(function (x) { return x.trim(); });
          return p.length >= 5 && p[1] === chk.pci && p[4] === chk.arfcn && (p[2] === "1" || p[2] === "2");
        });
      };
      var on = function (d) {
        if (!has_nr_service(d.network_type)) return false;
        if (d.nr5g_pci === chk.pci && String(d.nr5g_action_channel) === chk.arfcn) return true;
        return nr_scell_match(d);
      };
      var w = await gf_cell_wait(function (d) { return saved(d) && on(d); }, 24000);
      if (w.lost) { toast(gf_lost("5G cell lock sent"), "warn", 12000); return; }
      if (!w.d) { toast(gf_unknown_msg("5G cell lock sent"), "warn", 12000); return; }
      if (w.ok || saved(w.d)) { if (pass) gf_pass_saved("nr"); }
      if (w.ok) { toast("5G cell lock " + val + " ✓ — saved, and the router is on that cell.", "ok", 8000); return; }
      if (saved(w.d)) await gf_offer_reboot("5G cell lock " + val);
      else {
        toast("5G cell lock sent, but the router reads back " + (w.d.lock_nr_cell || "no lock") +
          " — the lock is not confirmed." + (pass ? gf_pass_refused("nr") : ""), "warn", 15000);
      }
    } finally {
      S.gf_busy = false;
      gf_poll_once(true);
    }
  }

  async function gf_cell_zero(nr, opts) {
    opts = opts || {};
    var held = !!opts.held;
    var c = S.gf_cells || {}, what = nr ? "5G cell lock" : "LTE cell lock", cur = nr ? S.net.lock_nr_cell : S.net.lock_lte_cell;
    if (!(nr ? c.nr : c.lte)) { toast("This router's pages have no " + what + ".", "warn"); return "failed"; }
    if (!cur) { if (!opts.quiet) toast("No " + what + " is active.", "info"); return "none"; }
    if (!held && S.gf_busy) { toast("Another router action is still running.", "warn"); return "failed"; }
    if (!opts.quiet && !opts.retried && !confirm("Remove the " + what + " (" + cur + ")?\n\nThe router keeps its band locks. It leaves the cell when it restarts (asked next).")) return "none";
    var res = "failed";
    S.gf_busy = true;
    try {
      toast("Removing the " + what + "…", "info", 4000);
      var r = nr ? await gf_nr_lock_write("0,0,0,0") :
        await gf_lte_lock_write("0", "0");
      var st = gf_write_state(r);
      var gone = function (d) { return !(nr ? d.lock_nr_cell : d.lock_lte_cell); };
      if (st === "refused" && !held && !opts.quiet && !opts.retried &&
        gf_login_retry(function () { gf_cell_zero(nr, { retried: true }); }, "The router refused the " + what + " removal with the current login.", true)) return "unknown";
      var w = st === "refused" ? { ok: false } : await gf_cell_wait(gone, 12000);
      if (w.lost || (st !== "refused" && !w.ok && !w.d)) {
        toast(what + " removal sent — the router did not answer afterwards (it may have ended the web session), so the result is unknown.\n" +
          (gf_saved() ? "The panel logs in again by itself; check Cell Lock then" : "Log in again and check Cell Lock") +
          " — the removal applies when the router restarts.", "warn", 14000);
        gf_poll_once(true);
        return "unknown";
      }
      if (!w.ok) {
        toast((st === "refused" ? "The router did not remove the " + what + " (" + (r.error || r.result) + ")" :
          "The router still reads back the " + what + " " + ((w.d && (nr ? w.d.lock_nr_cell : w.d.lock_lte_cell)) || "(no answer)") +
          " — it was not removed") + ".", "warn", 12000);
        res = "failed";
      } else res = "removed";
      gf_poll_once(true);
      if (res === "failed" && !opts.quiet && c.reset &&
        confirm("The " + what + " was not removed with its own command.\n\nUse the router's reset of ALL band and cell locks instead?")) {
        await gf_cell_reset(what, cur, true, true);
        return "failed";
      }
      if (res === "removed" && !opts.quiet) await gf_offer_reboot(what + " removal", false, true);
      return res;
    } finally {
      if (!held) S.gf_busy = false;
    }
  }

  async function gf_seq_session_gone(what) {
    if (await gf_logged_in()) return false;
    toast(what + ": the router ended the web session (or did not answer) — nothing more was sent.\n" +
      (gf_saved() ? "The panel logs in again by itself; check the locks then." : "Log in again and check the locks."), "warn", 14000);
    return true;
  }
  async function gf_reset_all() {
    var c = S.gf_cells || {}, b = S.gf_bands || gf_band_caps();
    if (!b.lte && !b.nr && !c.lte && !c.nr) return gf_cell_reset("", "");
    if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    if (!confirm("Remove ALL band and cell locks?\n\n• LTE and 5G band locks → all bands of the router\n• LTE / 5G cell lock → removed (it applies when the router restarts)")) return;
    S.gf_busy = true;
    try {
      var g0 = null;
      try { g0 = await gf_get(["lte_band_lock", "lte_band_ext_1_64", "nr5g_sa_band_lock", "nr5g_nsa_band_lock"]); } catch (e) { g0 = null; }
      var skipped = [];
      if (b.lte) { if (gf_lte_all_set(g0) === true) skipped.push("LTE"); else await gf_lte_band_unlock(true, true, true); }
      if (b.nr) { if (gf_nr_all_set(g0) === true) skipped.push("5G"); else await gf_nr_band_unlock(true, true); }
      if (skipped.length) toast(skipped.join(" and ") + " band lock" + (skipped.length > 1 ? "s" : "") + ": already on every band — left as is.", "info", 6000);
      if (skipped.length < (b.lte ? 1 : 0) + (b.nr ? 1 : 0) && (await gf_seq_session_gone("Reset ALL"))) return;
      var active = { lte: !!(S.net && S.net.lock_lte_cell), nr: !!(S.net && S.net.lock_nr_cell) };
      if (((!c.lte && active.lte) || (!c.nr && active.nr)) && c.reset) {
        await gf_cell_reset("", "", true, true);
        return;
      }
      var r1 = c.lte ? await gf_cell_zero(false, { quiet: true, held: true }) : "none";
      if (r1 === "unknown" && (await gf_seq_session_gone("Reset ALL"))) return;
      var r2 = c.nr ? await gf_cell_zero(true, { quiet: true, held: true }) : "none";
      if (r2 === "unknown" && (await gf_seq_session_gone("Reset ALL"))) return;
      if (r1 === "removed" || r2 === "removed") await gf_offer_reboot("Cell lock removal", false, true);
      else if ((!c.lte && active.lte) || (!c.nr && active.nr))
        toast("A cell lock is set, but this router's pages have no way to remove it — remove it on the router's own page.", "warn", 10000);
      else if (r1 === "none" && r2 === "none") toast("No cell lock was set.", "info", 5000);
    } finally {
      S.gf_busy = false;
    }
  }

  function gf_bands_default_detail(d) {
    var out = { lte: null, nr_sa: null, nr_nsa: null };
    if (lte_from_router()) {
      var lb = lte_bands_from_mask(d.lte_band_lock) || [];
      out.lte = lte_avail_in_mask().every(function (b) { return lb.indexOf(Number(b)) > -1; });
    }
    if (nr_from_router()) {
      var same = function (want, got) { var l = band_list(got); return want.length === l.length && want.every(function (b) { return l.indexOf(String(b)) > -1; }); };
      var saBands = nr_avail("sa"), nsaBands = nr_avail("nsa");
      if (saBands.length) out.nr_sa = same(saBands, d.nr5g_sa_band_lock);
      if (nsaBands.length) out.nr_nsa = same(nsaBands, d.nr5g_nsa_band_lock);
    }
    return out;
  }
  async function gf_cell_reset(what, cur, noAsk, held) {
    var c = S.gf_cells || {};
    if (what && !cur) { toast("No " + what + " is active.", "info"); return; }
    if (!c.reset) { toast("This router's pages have no way to remove " + (what ? "a " + what : "the locks") + ".", "warn"); return; }
    if (!held && S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    if (!noAsk && !confirm((what ? "Remove the " + what + " (" + cur + ")?\n\nThe router's page removes it with its own reset, which also" :
      "Reset ALL band and cell locks?\n\nThe router's own reset:") +
      " puts every LTE / 5G band lock and cell lock back to the router's defaults.\nMobile data may drop for a moment.\n\nContinue?")) return;
    S.gf_busy = true;
    try {
      toast("Resetting the band and cell locks…", "info", 4000);
      var before = S.net || {};
      var beforeBands = gf_bands_default_detail(before);
      var hadLteCell = !!before.lock_lte_cell;
      var hadNrCell = !!before.lock_nr_cell;
      var hadLteBandsNarrowed = beforeBands.lte === false;
      var hadNrSaBandsNarrowed = beforeBands.nr_sa === false;
      var hadNrNsaBandsNarrowed = beforeBands.nr_nsa === false;
      var r = await gf_call("setNetworkUnlock", {}, 10000);
      if (gf_write_state(r) === "refused") { toast("The router did not reset the locks (" + (r.error || r.result) + ").", "error"); return; }
      var nothingToCheck = !hadLteCell && !hadNrCell && !hadLteBandsNarrowed && !hadNrSaBandsNarrowed && !hadNrNsaBandsNarrowed;
      var w;
      if (nothingToCheck) {
        w = await gf_cell_wait(function () { return true; }, 4000);
      } else {
        w = await gf_cell_wait(function (d) {
          var det = gf_bands_default_detail(d);
          if (hadLteCell && d.lock_lte_cell) return false;
          if (hadNrCell && d.lock_nr_cell) return false;
          if (hadLteBandsNarrowed && det.lte === false) return false;
          if (hadNrSaBandsNarrowed && det.nr_sa === false) return false;
          if (hadNrNsaBandsNarrowed && det.nr_nsa === false) return false;
          return true;
        }, 40000);
      }
      if (w.lost) { toast(gf_lost("Reset sent"), "warn", 12000); return; }
      if (!w.d) {
        toast("Reset sent, but the router did not answer afterwards — the result is unknown. Check Cell Lock and the bands in a moment.", "warn", 14000);
        return;
      }
      var after = w.d;
      var afterBands = gf_bands_default_detail(w.d);
      function axisStatus(hadLocked, nowLocked, isBandAxis, afterVal) {
        if (!hadLocked) return null;
        if (isBandAxis) {
          if (afterVal === true) return "reset";
          if (afterVal === false) return "still_narrowed";
          return "unknown";
        }
        if (!nowLocked) return "reset";
        if (nowLocked) return "still_locked";
        return "unknown";
      }
      var parts = [];
      var axes = [
        ["LTE cell lock", hadLteCell, after.lock_lte_cell, false, null, before.lock_lte_cell, after.lock_lte_cell],
        ["5G cell lock",  hadNrCell,  after.lock_nr_cell,  false, null, before.lock_nr_cell,  after.lock_nr_cell],
        ["LTE bands",     hadLteBandsNarrowed, null, true, afterBands.lte, null, null],
        ["5G SA bands",   hadNrSaBandsNarrowed, null, true, afterBands.nr_sa, null, null],
        ["5G NSA bands",  hadNrNsaBandsNarrowed, null, true, afterBands.nr_nsa, null, null],
      ];
      var allOk = true, anyKnown = false;
      axes.forEach(function (ax) {
        var name = ax[0], had = ax[1], now = ax[2], isBand = ax[3], afterVal = ax[4], afterStr = ax[6];
        if (!had) return;
        anyKnown = true;
        var st = axisStatus(had, now, isBand, afterVal);
        if (st === "reset") parts.push(name + " removed ✓");
        else if (st === "still_locked") { parts.push(name + " not removed (still " + afterStr + ")"); allOk = false; }
        else if (st === "still_narrowed") {
          parts.push(isBand ? "band locks not at the defaults (" + name + " still narrowed)" : name + " still narrowed");
          allOk = false;
        }
        else { parts.push(name + " status unknown"); allOk = false; }
      });
      var unchecked = 0;
      ["lte", "nr_sa", "nr_nsa"].forEach(function (axKey) {
        if (afterBands[axKey] === null) {
          var lbl = axKey === "lte" ? "LTE bands" : axKey === "nr_sa" ? "5G SA bands" : "5G NSA bands";
          var covered = (axKey === "lte" && hadLteBandsNarrowed) || (axKey === "nr_sa" && hadNrSaBandsNarrowed) || (axKey === "nr_nsa" && hadNrNsaBandsNarrowed);
          if (!covered) { parts.push(lbl + ": not checked (router does not report this list)"); unchecked++; }
        }
      });
      if (!anyKnown) { toast("Nothing was locked or narrowed — the reset changed nothing.", "info", 7000); return; }
      if (allOk && unchecked) { toast("Reset done: " + parts.join(", ") + ".", "info", 12000); return; }
      if (allOk) {
        var allBandsDefault = (afterBands.lte !== false) && (afterBands.nr_sa !== false) && (afterBands.nr_nsa !== false);
        if (allBandsDefault) toast("Band and cell locks reset to the router defaults ✓ — " + parts.join(", ") + ".", "ok", 10000);
        else toast("Reset ✓ — " + parts.join(", ") + ".", "ok", 10000);
        return;
      }
      toast("Reset result: " + parts.join(", ") + ".", "warn", 12000);
    } finally {
      if (!held) S.gf_busy = false;
      gf_poll_once(true);
    }
  }

  async function gf_bridge_mode(enable) {
    if (!(S.gf_cells || {}).bridge) { toast("This router's pages have no bridge mode.", "warn"); return; }
    if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    S.gf_busy = true;
    try {
      await gf_bridge_run(enable);
    } finally {
      S.gf_busy = false;
    }
  }
  async function gf_bridge_run(enable) {
    var g = {};
    try { g = await gf_get(["opms_wan_mode", "ethernet_port_specified"]); } catch (e) { g = {}; }
    var cur = g.opms_wan_mode || S.wan.opms_wan_mode || "";
    if (!cur) { toast("Could not read the operation mode — try again in a moment.", "warn"); return; }
    var p = { opMode: enable ? "LTE_BRIDGE" : "PPP" };
    if (enable) {
      if (cur === "LTE_BRIDGE") { toast("Already in Bridge mode.", "info"); return; }
      p.ethernet_port_specified = g.ethernet_port_specified === "1" ? "1" : "0";
      if (S.gf_cells.port2) {
        var port = prompt("Bridge mode — which Ethernet port gets the mobile IP?\n1 = WAN/LAN1\n2 = LAN2", p.ethernet_port_specified === "1" ? "2" : "1");
        if (!port) return;
        if (["1", "2"].indexOf(port.trim()) === -1) { toast("Type 1 or 2", "error"); return; }
        p.ethernet_port_specified = port.trim() === "2" ? "1" : "0";
      }
      if (!confirm("Switch to BRIDGE mode?\n\n• The router restarts.\n• The device on " + (p.ethernet_port_specified === "1" ? "LAN2" : "WAN/LAN1") +
        " gets the mobile IP directly; the router stops routing.\n• The router's own page says: in bridge mode Wi-Fi only reaches the router's settings page.\n\n" +
        "Switch back with \"Router mode\" here (over Wi-Fi) or on the router's own Network Mode page.")) return;
    } else {
      if (cur !== "LTE_BRIDGE") { toast("Not in bridge mode (" + (OP_MODES[cur] || cur) + ") — nothing to change.", "info"); return; }
      if (!confirm("Switch back to normal ROUTER mode?\n\nThe router restarts.")) return;
    }
    var r = await gf_call("SetOperationMode", p, 10000);
    if (r.timeout) { gf_reboot_sent("No answer — the router is probably restarting to apply " + OP_MODES[p.opMode] + " mode"); return; }
    if (gf_write_state(r) === "refused") { toast("The router refused the mode change (" + (r.error || r.result) + ").", "error"); return; }
    gf_reboot_sent(gf_write_ok(r) ? "Switching to " + OP_MODES[p.opMode] + " mode — the router restarts"
      : "No clear answer — the router is probably restarting to apply " + OP_MODES[p.opMode] + " mode");
  }

  async function gf_nbr_try() {
    var raw = await gf_nbr_read();
    if (!raw || !gf_parse_ngbr(raw).some(function (r) { return r.pci !== undefined; })) return false;
    gf_nbr_enable();
    return true;
  }
  function gf_nbr_recheck(n) {
    if (n <= 0) return;
    setTimeout(async function () {
      if (S.session_lost) return gf_nbr_recheck(n);
      if (!(await gf_nbr_try())) gf_nbr_recheck(n - 1);
    }, 30000);
  }
  function gf_nbr_enable() {
    var c = S.gf_cells || {};
    if (c.nbr) return;
    c.nbr = true;
    window.zte_nbr_scan = gf_nbr_show;
    window.zte_force_lock = gf_force_lock;
    var ns = (S.gf_secs || {})["Neighbor Scan & Force Connect"];
    if (!ns) return;
    ns.style.display = "";
    var title = ns.querySelector(".zte_sec_title");
    if (title) title.textContent = c.lte ? "Neighbor Cells & Force Connect" : "Neighbor Cells";
    var note = title && title.nextElementSibling;
    if (note) note.textContent = "The LTE cells the router measures now (no scan: mobile data stays on)." +
      (c.lte ? " \"Lock\" sets an LTE cell lock on that PCI + EARFCN." : "");
    var b = gf_keep_btn("zte_nbr_scan");
    if (b) b.textContent = "🔍 Show neighbor cells";
    var th = ns.querySelectorAll("thead th");
    if (th[4]) th[4].textContent = "RSSI";
  }

  async function gf_cells_setup() {
    var p = zel("zte_panel");
    if (!p) return;
    var c = await gf_cell_caps();
    var secs = {};
    p.querySelectorAll(".zte_sec").forEach(function (s) {
      var t = s.querySelector(".zte_sec_title");
      if (t) secs[t.textContent.trim()] = s;
    });
    S.gf_secs = secs;
    if (!(await gf_nbr_try())) gf_nbr_recheck(20);
    if (c.lte || c.nr || c.reset) {
      window.zte_lte_cell_lock = gf_lte_cell_lock;
      window.zte_nr_cell_lock = gf_nr_cell_lock;
      window.zte_reset_band_cell = gf_reset_all;
      if (c.lte) gf_keep_btn("zte_lte_cell_lock(false");
      if (c.nr) gf_keep_btn("zte_nr_cell_lock(false");
      if (c.lte || c.reset) gf_keep_btn("zte_lte_cell_lock(true");
      if (c.nr || c.reset) gf_keep_btn("zte_nr_cell_lock(true");
      gf_keep_btn("zte_reset_band_cell");
      var cl = zel("zte_cell_lock_state");
      if (cl && cl.nextElementSibling) {
        cl.nextElementSibling.style.display = "";
        cl.nextElementSibling.textContent = "Prompts are prefilled with the current cell." +
          (c.lte || c.nr ? " Unlock removes that cell lock only (band locks stay); it applies after a restart." :
            " Unlock = the router's own reset of all band and cell locks.") +
          (c.lte ? "" : " This router's pages have no LTE cell lock.");
      }
    }
    if (c.bridge) {
      window.zte_bridge_mode = gf_bridge_mode;
      gf_keep_btn("zte_bridge_mode(true");
      gf_keep_btn("zte_bridge_mode(false");
      var om = zel("zte_opmode");
      if (om && om.parentElement) om.parentElement.style.display = "";
      p.querySelectorAll(".zte_grp").forEach(function (g) {
        var n = g.querySelector(".zte_grp_name");
        if (n && n.textContent.trim() === "Router Settings") g.style.display = "";
      });
    }
    S.gf_actions = S.gf_actions || [];
    if (c.bridge) S.gf_actions.push("bridge");
    if (c.lte || c.nr) S.gf_actions.push("cell lock");
    gf_mode_text();
  }
  var GF_ANT_SRV = ["setAntennaControlSetting", "setAntennaState", "getAntennaControlSetting"];
  GF_ANT_SRV.forEach(function (m) { if (GF_ALLOWED.indexOf(m) < 0) GF_ALLOWED.push(m); });
  if (GF_ALLOWED.indexOf("getDeviceInfo") < 0) GF_ALLOWED.push("getDeviceInfo");

  async function gf_ant_caps() {
    if (S.gf_ant_caps !== undefined) return S.gf_ant_caps;
    S.gf_ant_caps = null;
    if (!GF_ANT_SRV.every(function (m) { return gf_has(m); })) { return null; }
    var ok = await gf_call("getAntennaControlSetting", {}, 4000);
    if (!ok || ok.error || ok.timeout || ok.result === "failure") { return null; }
    var cap = { names: [], states: [], name_labels: {}, state_labels: {} };
    var rq = window.requirejs || window.require, tm = "";
    if (rq && typeof rq.toUrl === "function") {
      var candidates = ["tmpl/adm/ant_settings.html", "tmpl/developer/ant_settings.html",
        "tmpl/hide/ant_switch.html", "tmpl/adm/ant_switch.html"];
      for (var ci = 0; ci < candidates.length && !tm; ci++) {
        tm = await gf_text(rq.toUrl(candidates[ci]));
      }
      if (tm) {
        var nameBlock = tm.match(/selectedAntennaName[\s\S]*?<\/select>/);
        if (nameBlock) {
          String(nameBlock[0]).replace(/data-trans=["']antenna_(\w+)["']\s*value=["'](\d+)["']|value=["'](\d+)["'][^>]*data-trans=["']antenna_(\w+)["']/g, function (_, l1, v1, v2, l2) {
            var v = v1 || v2, l = l1 || l2;
            if (v && !cap.name_labels[v]) { cap.names.push(v); cap.name_labels[v] = l.replace(/^(RX|rx)/, "RX"); }
          });
        }
        var stateBlock = tm.match(/selectedAntennaState[\s\S]*?<\/select>/);
        if (stateBlock) {
          String(stateBlock[0]).replace(/data-trans=["']direction_(\w+)["']\s*value=["'](\d+)["']|value=["'](\d+)["'][^>]*data-trans=["']direction_(\w+)["']/g, function (_, l1, v1, v2, l2) {
            var v = v1 || v2, l = l1 || l2;
            if (v && !cap.state_labels[v]) {
              cap.states.push(v);
              cap.state_labels[v] = /omni/i.test(l) ? "omni" : "directional";
            }
          });
        }
      }
    }
    if (!(tm && /selectedAntennaName|selectedAntennaState/.test(tm))) {
      if (!S.gf_model) { try { S.gf_model = (await gf_get(["model_name"])).model_name || ""; } catch (e) { } }
      if (!/^MC889/i.test(S.gf_model || "")) { return null; }
    }
    if (!cap.names.length) {
      cap.names = ["5", "6"];
      cap.name_labels = { "5": "RX0", "6": "RX1" };
    }
    if (!cap.states.length) {
      cap.states = ["4", "1"];
      cap.state_labels = { "4": "directional", "1": "omni" };
    }
    S.gf_ant_caps = cap;
    return cap;
  }

  function gf_ant_label(name, state) {
    var c = S.gf_ant_caps || {};
    return (c.name_labels && c.name_labels[name] || name) + "+" + (c.state_labels && c.state_labels[state] || state);
  }

  async function gf_ant_set_one(name, state) {
    return await gf_call("setAntennaState", { antenna_name: name, state: state }, 6000);
  }
  async function gf_ant_apply_all(state) {
    var caps = await gf_ant_caps();
    if (!caps) return null;
    var enable = await gf_call("setAntennaControlSetting", { ant_switch_enable: "1" }, 6000);
    if (gf_write_state(enable) === "refused") return enable;
    var unsure = [];
    for (var i = 0; i < caps.names.length; i++) {
      var r = await gf_ant_set_one(caps.names[i], state);
      if (gf_write_state(r) === "refused") return r;
      if (gf_write_state(r) === "unknown") unsure.push(caps.names[i]);
    }
    return { result: "success", unsure: unsure };
  }
  async function gf_ant_confirm(want, unsure) {
    await sleep(1500);
    var g = await gf_read_back(["ant_switch_enable", "ant_switch_idx", "ant_switch_state"]);
    if (!g) return { res: "unknown", line: "" };
    if (!g.ant_switch_enable && want.enable !== "0") return { res: "unknown", line: "" };
    var tail = want.pair && want.pair.length ? want.pair[want.pair.length - 1] : null;
    var ok = want.enable === "0" ? (g.ant_switch_enable === "0" || !g.ant_switch_enable) :
      g.ant_switch_enable === "1" && !!tail && g.ant_switch_state === tail.state && (!g.ant_switch_idx || g.ant_switch_idx === tail.name);
    var tailName = tail && tail.name;
    var open = (unsure || []).filter(function (n) { return n !== tailName; });
    if (ok && open.length) return { res: "partial", g: g, open: open, line: "" };
    if (ok) gf_ant_last_set(want);
    return { res: ok ? "ok" : "differs", g: g,
      line: g.ant_switch_enable === "0" ? "Auto" : "manual, last-set chain " + gf_ant_label(g.ant_switch_idx || "?", g.ant_switch_state || "?") };
  }
  function gf_ant_not_ok(what, c) {
    if (c.res === "unknown") toast(gf_unknown_msg(what + " sent"), "warn", 12000);
    else if (c.res === "partial") toast(what + " — the last chain reads back as set, but " + c.open.map(function (n) { return gf_ant_label(n, "").replace(/\+$/, ""); }).join(", ") +
      " got no answer, and the router reports only the last chain: not confirmed.", "warn", 12000);
    else toast(what + " — sent, but the router reads back " + c.line + ".", "warn", 10000);
  }

  async function gf_ant_auto() {
    if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    S.gf_busy = true;
    try {
      var r = await gf_call("setAntennaControlSetting", { ant_switch_enable: "0" }, 6000);
      if (gf_write_state(r) === "refused") { toast("The router refused the antenna change (" + (r.error || r.result) + ").", "error"); return; }
      var c = await gf_ant_confirm({ enable: "0" });
      if (c.res === "ok") toast("Antenna: automatic ✓ (the router picks).", "ok", 5000);
      else gf_ant_not_ok("Antenna: automatic", c);
    } finally { S.gf_busy = false; gf_poll_once(true); }
  }
  async function gf_ant_directional() { return gf_ant_apply_bulk("directional", "4"); }
  async function gf_ant_omni() { return gf_ant_apply_bulk("omni", "1"); }
  async function gf_ant_apply_bulk(label, state) {
    if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    S.gf_busy = true;
    try {
      toast("Antenna: " + label + " on all chains…", "info", 3000);
      var r = await gf_ant_apply_all(state);
      if (!r) { toast("This router does not expose antenna control.", "warn"); return; }
      if (gf_write_state(r) === "refused") { toast("Antenna " + label + " not applied (" + (r.error || r.result) + ").", "error"); return; }
      var capsB = S.gf_ant_caps || { names: [] };
      var c = await gf_ant_confirm({ enable: "1", pair: capsB.names.map(function (n) { return { name: n, state: state }; }) }, r.unsure);
      if (c.res === "ok") toast("Antenna: " + label + " ✓ (all chains).", "ok", 5000);
      else gf_ant_not_ok("Antenna: " + label, c);
    } finally { S.gf_busy = false; gf_poll_once(true); }
  }

  var GF_ANT_NOISE_DELTA = 1.5;
  var GF_ANT_MEAS = ["network_type", "nr5g_action_band", "nr5g_action_nsa_band", "nr5g_action_channel",
    "nr5g_rsrp", "Z5g_rsrp", "nr5g_snr", "Z5g_SINR", "Z5g_snr"];
  function gf_ant_meas(g) {
    g = g || {};
    var nt = gf_nettype(g.network_type), sa = nt === "SA";
    if (nt !== "ENDC" && nt !== "LTE-NSA" && nt !== "SA") return { band: "", arfcn: "", key: "", nr: false, sinr: NaN, rsrp: NaN };
    var band = strip_n(gf_nr_active_band(g, sa) || "");
    var arfcn = g.nr5g_action_channel || "";
    return { band: band, arfcn: arfcn, key: band + "/" + arfcn, nr: true,
      sinr: parseFloat(gf_nr_snr(g)), rsrp: parseFloat(gf_first(g.nr5g_rsrp, g.Z5g_rsrp)) };
  }
  function gf_ant_pairs(caps) {
    var out = [];
    function rec(i, acc) {
      if (i === caps.names.length) { out.push(acc.slice()); return; }
      for (var j = 0; j < caps.states.length; j++) { acc.push({ name: caps.names[i], state: caps.states[j] }); rec(i + 1, acc); acc.pop(); }
    }
    rec(0, []);
    return out;
  }
  function gf_ant_pair_label(pair) {
    return pair.map(function (p) { return gf_ant_label(p.name, p.state); }).join(" · ");
  }
  async function gf_ant_apply_pair(pair, lenient) {
    var unsure = [];
    for (var i = 0; i < pair.length; i++) {
      var r = await gf_ant_set_one(pair[i].name, pair[i].state);
      if (lenient ? gf_write_state(r) === "refused" : !gf_write_ok(r)) return r;
      if (gf_write_state(r) === "unknown") unsure.push(pair[i].name);
    }
    return { result: "success", unsure: unsure };
  }
  async function gf_ant_autotest() {
    if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    S.gf_busy = true;
    var caps = await gf_ant_caps();
    if (!caps) { S.gf_busy = false; toast("This router does not expose antenna control.", "warn"); return; }
    var g0 = {};
    try { g0 = await gf_get(GF_ANT_MEAS.concat(["ant_switch_enable", "ant_switch_idx", "ant_switch_state"])); } catch (e) { g0 = {}; }
    var m0 = gf_ant_meas(g0);
    var carrierBand = m0.band, carrierArfcn = m0.arfcn, carrierKey = m0.key;
    var sinr0 = m0.sinr, rsrp0 = m0.rsrp;
    var allowed = ["78", "1", "28"];
    if (!(carrierBand && carrierArfcn && !isNaN(sinr0) && allowed.indexOf(carrierBand) > -1)) {
      S.gf_busy = false;
      toast("Auto-test needs an active 5G attachment on n78, n1 or n28 to decide — attach first, then try again.", "warn", 10000); return;
    }
    var pairs = gf_ant_pairs(caps);
    var savedWasAuto = (g0.ant_switch_enable === "0" || !g0.ant_switch_enable);
    var baselineState = g0.ant_switch_state || caps.states[0];
    var baselineLabel = caps.state_labels[baselineState] || baselineState;
    if (!confirm("Antenna Auto-test\n\nThe panel will cycle through " + pairs.length + " full chain configurations" +
      " (each sets ALL " + caps.names.length + " chain(s) to a defined state), 10 seconds per combo.\n\n" +
      "Mobile data stays up while the antennas switch.\n\n" +
      "Measurement carrier: n" + carrierBand + " / ARFCN " + carrierArfcn + " (SINR " + sinr0.toFixed(1) +
      ", RSRP " + (isNaN(rsrp0) ? "?" : Math.round(rsrp0)) + ").\n\n" +
      "Baseline / restore target: " + (savedWasAuto ? "Auto (firmware control)" : "all chains " + baselineLabel) +
      ".\nNote: the firmware does not expose each chain's current state independently, so if your " +
      "current configuration is mixed (e.g. RX0 directional + RX1 omni), a 'no significant difference' outcome " +
      "puts back the restore target above, not that mix.\n\nContinue?")) { S.gf_busy = false; return; }
    try {
      gf_ant_last_set(null);
      var en = await gf_call("setAntennaControlSetting", { ant_switch_enable: "1" }, 6000);
      if (gf_write_state(en) === "refused") { toast("Auto-test failed to enable manual control (" + (en.error || en.result) + ").", "error"); return; }
      var results = [];
      for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i];
        var pairLabel = gf_ant_pair_label(pair);
        toast("Auto-test " + (i + 1) + "/" + pairs.length + ": " + pairLabel + "…", "info", 3000);
        var pr = await gf_ant_apply_pair(pair);
        if (!gf_write_ok(pr)) { results.push({ pair: pair, label: pairLabel, skipped: true }); continue; }
        await sleep(10000);
        var g = {};
        try { g = await gf_get(GF_ANT_MEAS); } catch (e) { g = {}; }
        var m = gf_ant_meas(g);
        var sameCarrier = m.key === carrierKey;
        var sinr = m.sinr, rsrp = m.rsrp;
        if (!m.nr) { results.push({ pair: pair, label: pairLabel, skipped: true, reason: "5G not attached" }); continue; }
        if (!sameCarrier) { results.push({ pair: pair, label: pairLabel, skipped: true, reason: "carrier drifted to " + (m.band ? "n" + m.band : "?") + "/" + (m.arfcn || "?") }); continue; }
        results.push({ pair: pair, label: pairLabel, sinr: sinr, rsrp: rsrp });
      }
      var usable = results.filter(function (r) { return !r.skipped && !isNaN(r.sinr); });
      if (!usable.length) { toast("Auto-test: no comparable 5G measurements across combos — restoring.", "warn", 10000); throw new Error("restore"); }
      usable.sort(function (a, b) {
        if (a.sinr !== b.sinr) return b.sinr - a.sinr;
        if (a.rsrp !== b.rsrp) return (isNaN(b.rsrp) ? -Infinity : b.rsrp) - (isNaN(a.rsrp) ? -Infinity : a.rsrp);
        var da = a.pair.filter(function (p) { return p.state === "4"; }).length;
        var db = b.pair.filter(function (p) { return p.state === "4"; }).length;
        return db - da;
      });
      var best = usable[0], worst = usable[usable.length - 1];
      var delta = best.sinr - worst.sinr;
      if (delta < GF_ANT_NOISE_DELTA) {
        toast("Auto-test: no significant difference (SINR spread " + delta.toFixed(1) + " dB) — restoring the starting setting.", "info", 12000);
        throw new Error("restore");
      }
      var ap = await gf_ant_apply_pair(best.pair, true);
      if (gf_write_state(ap) === "refused") { toast("Auto-test picked " + best.label + " but applying one of the chains was refused — restoring.", "error", 10000); throw new Error("restore"); }
      var lines = results.map(function (r) {
        if (r.skipped) return "• " + r.label + ": " + (r.reason || "refused");
        return "• " + r.label + " — SINR " + (isNaN(r.sinr) ? "?" : r.sinr.toFixed(1)) + " / RSRP " + (isNaN(r.rsrp) ? "?" : Math.round(r.rsrp));
      }).join("\n");
      var cw = await gf_ant_confirm({ enable: "1", pair: best.pair }, ap.unsure);
      if (cw.res === "ok") toast("Auto-test ✓ — applied " + best.label + " (SINR " + best.sinr.toFixed(1) + " dB, Δ " + delta.toFixed(1) + " dB)\n" + lines, "ok", 15000);
      else gf_ant_not_ok("Auto-test: " + best.label, cw);
    } catch (e) {
      if (String(e.message) === "restore") {
        if (savedWasAuto) {
          var rrAuto = await gf_call("setAntennaControlSetting", { ant_switch_enable: "0" }, 6000);
          if (gf_write_state(rrAuto) === "refused") {
            toast("Antenna restore to Auto was refused by the router (" + (rrAuto.error || rrAuto.result) + ") — set it by hand from the Antenna dropdown.", "error", 12000);
          } else {
            var ca = await gf_ant_confirm({ enable: "0" });
            if (ca.res !== "ok") gf_ant_not_ok("Antenna restore to Auto", ca);
          }
        } else {
          var safe = caps.names.map(function (n) { return { name: n, state: baselineState }; });
          var rrPair = await gf_ant_apply_pair(safe, true);
          if (gf_write_state(rrPair) === "refused") {
            toast("Antenna restore to " + baselineLabel + " was refused by the router (" + (rrPair.error || rrPair.result) + ") — set it by hand from the Antenna dropdown.", "error", 12000);
          } else {
            var cp = await gf_ant_confirm({ enable: "1", pair: safe }, rrPair.unsure);
            if (cp.res === "ok") toast("Antenna restored to all chains " + baselineLabel + ".", "info", 7000);
            else gf_ant_not_ok("Antenna restore to " + baselineLabel, cp);
          }
        }
      } else throw e;
    } finally { S.gf_busy = false; gf_poll_once(true); }
  }

  async function gf_antenna_setup() {
    var caps = await gf_ant_caps();
    if (!caps) return;
    window.zte_antenna_refresh = gf_antenna_refresh;
    window.zte_set_antenna = gf_ant_set_mode;
    window.zte_ant_autotest = gf_ant_autotest;
    var antSec = zel("zte_ant_sec");
    if (!antSec) return;
    antSec.style.display = "";
    S.ant_supported = true;
    S.ant_busy = true;
    S.gf_ant_ui = true;
    var sel = zel("zte_ant_sel");
    if (sel) {
      var opts = ['<option value="auto">Auto (firmware control)</option>'];
      if (caps.states.indexOf("4") > -1) opts.push('<option value="directional">Directional' + (caps.names.length > 1 ? " (both chains)" : "") + "</option>");
      if (caps.states.indexOf("1") > -1) opts.push('<option value="omni">Omni' + (caps.names.length > 1 ? " (both chains)" : "") + "</option>");
      sel.innerHTML = opts.join("");
      sel.style.display = "";
      sel.classList.add("zte_gf_keep");
      sel.disabled = false;
      var methodRow = sel.closest(".zte_row"); if (methodRow) methodRow.style.display = "";
    }
    ["zte_ant_src", "zte_ant_cur", "zte_ant_sw"].forEach(function (id) {
      var el = zel(id);
      if (!el) return;
      var row = el.closest(".zte_row") || el; row.style.display = "none";
    });
    Array.prototype.forEach.call(antSec.querySelectorAll(":scope > div"), function (d) {
      if (/debugging|developer session|lasts until reboot/i.test(d.textContent || "")) d.style.display = "none";
    });
    Array.prototype.forEach.call(antSec.querySelectorAll(".zte_btn_grid"), function (g) {
      if (g.textContent && /Refresh antenna/i.test(g.textContent)) g.style.display = "none";
    });
    if (!zel("zte_gf_ant_autotest_btn")) {
      antSec.insertAdjacentHTML("beforeend",
        '<button class="zte_btn full zte_gf_keep" id="zte_gf_ant_autotest_btn" onclick="window.zte_ant_autotest()" style="margin-top:8px;">🧪 Auto-test antenna (~60 s)</button>' +
        '<div id="zte_gf_ant_state" style="font-size:12px;color:#78909C;margin-top:4px;"></div>'
      );
    }
    gf_antenna_refresh();
  }
  async function gf_antenna_refresh() {
    var g = {};
    try { g = await gf_get(["ant_switch_enable", "ant_switch_idx", "ant_switch_state"]); } catch (e) { g = {}; }
    S.gf_raw = Object.assign({}, S.gf_raw || {}, g);
    gf_antenna_paint(g);
  }
  var GF_ANT_LAST_KEY = "ZtePanelGfAntLast";
  function gf_ant_last_set(v) {
    try { if (v) localStorage.setItem(GF_ANT_LAST_KEY, JSON.stringify(Object.assign({ at: Date.now() }, v))); else localStorage.removeItem(GF_ANT_LAST_KEY); } catch (e) { }
  }
  function gf_ant_last_get() {
    try { return JSON.parse(localStorage.getItem(GF_ANT_LAST_KEY) || "null"); } catch (e) { return null; }
  }
  function gf_antenna_paint(g) {
    if (!S.gf_ant_ui || !g) return;
    var isAuto = (g.ant_switch_enable === "0" || !g.ant_switch_enable);
    var stateVal = g.ant_switch_state || "", idx = g.ant_switch_idx || "";
    var want, line;
    if (isAuto) {
      want = "auto";
      line = "Auto (firmware control) — current pick: " + gf_ant_label(idx || "?", stateVal || "?");
    } else {
      var last = gf_ant_last_get(), pair = last && last.enable === "1" && Array.isArray(last.pair) ? last.pair : null;
      var tail = pair && pair.length ? pair[pair.length - 1] : null;
      var known = !!tail && tail.state === stateVal && (!idx || tail.name === idx);
      var states = known ? pair.map(function (p) { return p.state; }).filter(function (x, i, a) { return a.indexOf(x) === i; }) : [];
      var lab = states.length === 1 && S.gf_ant_caps && S.gf_ant_caps.state_labels ? S.gf_ant_caps.state_labels[states[0]] : "";
      if (lab === "directional" || lab === "omni") {
        want = lab;
        line = "Manual: all chains " + lab;
      } else if (known) {
        want = "manual";
        line = "Manual: " + gf_ant_pair_label(pair);
      } else {
        want = "manual";
        line = "Manual — the router reports only the last-set chain: " + gf_ant_label(idx || "?", stateVal || "?");
      }
    }
    zhtml("zte_gf_ant_state", esc(line));
    var sel = zel("zte_ant_sel");
    if (sel && !S.gf_busy) {
      if (want === "manual") {
        var mo = sel.querySelector('option[value="manual"]');
        if (!mo) { mo = document.createElement("option"); mo.value = "manual"; mo.disabled = true; sel.appendChild(mo); }
        mo.textContent = line.indexOf("Manual: ") === 0 ? line.replace(/^Manual: /, "Mixed: ") : "Manual (set outside the panel)";
      }
      if (sel.value !== want) sel.value = want;
    }
  }

  async function gf_ant_set_mode(v) {
    if (v === "auto") return gf_ant_auto();
    if (v === "omni") return gf_ant_omni();
    if (/directional/.test(String(v))) return gf_ant_directional();
    toast("Antenna option \"" + v + "\" is not available on this router.", "warn");
  }

  async function gf_gps_setup() {
    var g = {};
    try { g = await gf_get(["gps_lat", "gps_lon"]); } catch (e) { g = {}; }
    if (gf_gps_encrypted(g)) await gf_gps_decode(true);
    if (!gf_gps_valid(g)) {
      return;
    }
    S.gf_raw = Object.assign({}, S.gf_raw || {}, { gps_lat: g.gps_lat, gps_lon: g.gps_lon });
    gf_gps_enable();
  }
  function gf_gps_enable() {
    if (S.gf_gps_enabled) return;
    S.gf_gps_enabled = true;
    var gn = zel("zte_gnss_wrap"); if (gn) gn.style.display = "";
    window.zte_gps_refresh = async function () {
      if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
      try {
        var h = await gf_get(["gps_lat", "gps_lon"]);
        S.gf_raw = Object.assign({}, S.gf_raw || {}, { gps_lat: h.gps_lat, gps_lon: h.gps_lon });
        if (gf_gps_encrypted(h)) await gf_gps_decode(true);
        gf_after_gps(true);
      } catch (e) { toast("The router did not answer.", "warn"); }
    };
    gf_keep_btn("zte_gps_refresh");
    gf_after_gps();
  }
  if (GF_ALLOWED.indexOf("clearTraffic") < 0) GF_ALLOWED.push("clearTraffic");

  function gf_plain(re) {
    for (var i = 1; i < arguments.length; i++) {
      var v = String(arguments[i] === undefined || arguments[i] === null ? "" : arguments[i]).trim();
      if (v && re.test(v)) return v;
    }
    return "";
  }
  async function gf_devinfo() {
    if (!gf_has("getDeviceInfo")) return {};
    var r = await gf_call("getDeviceInfo", {}, 6000);
    return r && !r.error && !r.timeout ? r : {};
  }
  var GF_SIM_FIELDS = ["sim_iccid", "iccid", "sim_imsi", "msisdn", "mdm_mcc", "mdm_mnc", "network_provider",
    "modem_main_state", "pin_status", "pinnumber", "puknumber"];
  var GF_HWSW_FIELDS = ["model_name", "hardware_version", "wa_inner_version", "cr_version", "web_version", "imei",
    "lan_ipaddr", "wan_ipaddr", "ipv6_wan_ipaddr", "opms_wan_mode"];
  async function gf_read_info(fields) {
    var g = {};
    try { g = await gf_get(fields); } catch (e) { g = null; }
    return { g: g, d: await gf_devinfo() };
  }

  async function gf_sim_info() {
    var x = await gf_read_info(GF_SIM_FIELDS), g = x.g, d = x.d;
    if (!g) { show_modal("SIM Info", "<p>Could not read the SIM info.</p>"); return; }
    var pin = { "0": "off", "1": "on" }[g.pin_status] || g.pin_status;
    show_modal("SIM Info", info_table("SIM", {
      "ICCID": gf_plain(/^[0-9A-Fa-f]{18,22}$/, g.sim_iccid, g.iccid, d.simSerialNumber),
      "IMSI": gf_plain(/^\d{14,15}$/, d.sim_imsi, g.sim_imsi),
      "Phone number": gf_plain(/^\+?\d{3,15}$/, d.msisdn, g.msisdn),
      "Provider": g.network_provider,
      "MCC-MNC": g.mdm_mcc && g.mdm_mnc ? g.mdm_mcc + "-" + g.mdm_mnc : "",
      "SIM state": g.modem_main_state,
      "PIN check": pin,
      "PIN tries left": g.pinnumber,
      "PUK tries left": g.puknumber,
    }, { rawKeys: true }));
  }

  async function gf_hw_sw_info() {
    var x = await gf_read_info(GF_HWSW_FIELDS), g = x.g, d = x.d;
    if (!g) { show_modal("HW / SW Info", "<p>Could not read the device info.</p>"); return; }
    show_modal("HW / SW Info",
      info_table("Hardware & Software", {
        "Model": g.model_name,
        "Firmware": gf_first(d.sw_version, g.wa_inner_version, g.cr_version),
        "Hardware": gf_first(d.hw_version, g.hardware_version),
        "Web UI": g.web_version,
        "CE / RED version": d.ce_red_version,
        "IMEI": gf_plain(/^\d{14,17}$/, d.imei, g.imei),
        "Panel": "NG v" + CFG.version,
      }, { rawKeys: true }) +
      info_table("Network", {
        "LAN IP": gf_first(g.lan_ipaddr, d.ipAddress),
        "LAN domain": d.lanDomain,
        "MAC": d.macAddress,
        "WAN IP": gf_first(d.wanIpAddress, g.wan_ipaddr),
        "WAN IPv6": gf_first(d.ipv6WanIpAddress, g.ipv6_wan_ipaddr),
        "PDP type": gf_first(d.ipv6PdpType, d.pdpType),
        "WAN mode": gf_first(d.opms_wan_mode, g.opms_wan_mode),
      }, { rawKeys: true }));
  }

  async function gf_test_connection() {
    var s = Date.now();
    try {
      var ok = (await gf_get(["loginfo"])).loginfo === "ok";
      toast("Router OK — " + (Date.now() - s) + " ms" + (ok ? "" : " (not logged in)"), ok ? "ok" : "warn");
    } catch (e) {
      toast("The router did not answer.", "error");
    }
  }

  async function gf_month_bytes() {
    try {
      var g = await gf_get(["flux_monthly_rx_bytes", "flux_monthly_tx_bytes", "monthly_rx_bytes", "monthly_tx_bytes"]);
      var rx = gf_first(g.flux_monthly_rx_bytes, g.monthly_rx_bytes), tx = gf_first(g.flux_monthly_tx_bytes, g.monthly_tx_bytes);
      if (rx === "" && tx === "") return null;
      return (Number(rx) || 0) + (Number(tx) || 0);
    } catch (e) {
      return null;
    }
  }
  async function gf_reset_traffic() {
    if (S.gf_busy) { toast("Another router action is still running.", "warn"); return; }
    if (!confirm("Reset the router's traffic counters to 0?\n\n(The router's own traffic-statistics reset — the monthly data and connected time.)")) return;
    S.gf_busy = true;
    try {
      var before = await gf_month_bytes();
      var r = await gf_call("clearTraffic", {}, 8000), st = gf_write_state(r);
      if (st === "refused") { toast("The router refused the counter reset (" + (r.error || r.result) + ").", "error"); return; }
      var after = null;
      for (var i = 0; i < 4; i++) {
        await sleep(1500);
        after = await gf_month_bytes();
        if (after !== null && (after === 0 || (before !== null && after < before))) break;
      }
      if (after !== null && (after === 0 || (before !== null && after < before))) toast("Traffic counters reset ✓", "ok");
      else toast((st === "ok" ? "The router accepted the reset, but the monthly counter has not dropped yet" :
        "No clear answer from the router, and the monthly counter has not dropped yet") + " — check again in a moment.", "warn", 10000);
    } finally {
      S.gf_busy = false;
    }
  }

  var GF_KA_MS = 60000;
  async function gf_keepalive_start() {
    if (S.gf_ka) return;
    var rq = window.requirejs || window.require;
    if (!rq || typeof rq.toUrl !== "function") return;
    var names = [], home = gf_routes().filter(function (r) { return r.hash === "#home"; })[0];
    if (home) names.push(home.path);
    if (names.indexOf("home") < 0) names.push("home");
    var url = null;
    for (var i = 0; i < names.length && !url; i++) {
      var u = rq.toUrl("tmpl/" + names[i] + ".html");
      if (await gf_text(u + (u.indexOf("?") > -1 ? "&" : "?") + "_=" + Date.now())) url = u;
    }
    if (!url) { return; }
    S.gf_ka = setInterval(function () {
      gf_text(url + (url.indexOf("?") > -1 ? "&" : "?") + "_=" + Date.now());
    }, GF_KA_MS);
  }

  if (GF_ALLOWED.indexOf("getTR069Config") < 0) GF_ALLOWED.push("getTR069Config");
  async function gf_tr069_setup() {
    if (!gf_has("getTR069Config")) return;
    var c = await gf_call("getTR069Config", {}, 6000);
    if (!c || c.error || c.timeout || c.tr069_PeriodicInformEnable === undefined) { return; }
    var acs = String(c.serverUrl || c.serverURL || "").trim() !== "";
    var inf = String(c.tr069_PeriodicInformEnable) === "1";
    var iv = parseInt(c.tr069_PeriodicInformInterval, 10);
    var ivTxt = !isNaN(iv) && iv > 0 ? " every " + (iv % 60 === 0 ? iv / 60 + " min" : iv + " s") : "";
    var dm = String(c.tr069_DataModule || "").replace(/^TR(\d+)$/i, "TR-$1");
    zhtml("zte_tr069_state",
      "ACS " + (acs ? '<b style="color:#C62828">set</b>' : '<b style="color:#2E7D32">not set</b>') +
      ' · Inform <b style="color:' + (inf && acs ? "#C62828" : "#78909C") + '">' + (inf ? "on" : "off") + "</b>" + esc(inf ? ivTxt : "") +
      (c.tr069_CPEPortNo ? " · port " + esc(String(c.tr069_CPEPortNo)) : "") + (dm ? " · " + esc(dm) : ""));
    var row = zel("zte_tr069_row");
    if (row) {
      row.style.display = "";
      row.title = acs ? "An ACS (the operator's management server) is set: the router reports to it and can be managed by it." :
        "No ACS is set: TR-069 has no server to report to, so Inform does nothing. Change it on the router's Developer Options → TR-069 page.";
    }
    var sec = zel("zte_dev_sec");
    if (sec) sec.style.display = "";
    S.gf_tr069 = { acs: acs, inform: inf, interval: iv };
  }

  function gf_device_setup() {
    gf_tr069_setup().catch(function (e) { });
    window.zte_sim_info = gf_sim_info;
    window.zte_hw_sw_info = gf_hw_sw_info;
    gf_keep_btn("zte_sim_info");
    gf_keep_btn("zte_hw_sw_info");
    if (gf_has("clearTraffic")) { window.zte_reset_traffic = gf_reset_traffic; gf_keep_btn("zte_reset_traffic"); }
    gf_keepalive_start().catch(function (e) { });
  }
  function start_panel() {
    if (S.init_done) return;
    if (zel("zte_panel")) {
      toast("Another ZTE panel script is already running on this page.\nKeep only one enabled in your userscript manager.", "warn");
      return;
    }
    S.init_done = true;
    S.started_at = Date.now();
    try { sessionStorage.removeItem(LS.TRIED); } catch (e) { }
    try { localStorage.removeItem(LS.USER_LOGOUT); } catch (e) { }
    inject_html();
    update_login_state();
    watch_logout_click();
    poll_loop();
    setTimeout(read_sys_settings, 5000);
    setTimeout(check_wifi, 3500);
    setTimeout(model_check, 1200);
    setTimeout(update_gps, 6000);
    setTimeout(update_arp_state, 8000);
    setTimeout(load_ant_ui, 3000);
    setTimeout(load_band_caps, 2500);
    setTimeout(load_qos_cap, 4000);
    setTimeout(load_tr069_cap, 4500);
    start_hidden_menus();
    setup_debug_toggle();
    setTimeout(glock_resume_if_pending, 6500);
    setTimeout(reconnect_resume_if_pending, 600);
    setTimeout(function () { scan_last_restore(); scan_results_resume(); }, 2000);
    toast("ZTE Panel NG Lite v" + CFG.version + " active", "ok");
  }

  function wait_page_settled() {
    return new Promise(function (resolve) {
      var start = Date.now(), last = -1, quietSince = Date.now(), obs = null;
      try {
        obs = new window.PerformanceObserver(function (list) { if (list.getEntries().length) quietSince = Date.now(); });
        obs.observe({ type: "resource" });
      } catch (e) {
        obs = null;
        try { performance.clearResourceTimings(); } catch (e2) { }
      }
      (function tick() {
        if (!obs) {
          var n = performance.getEntriesByType("resource").length;
          if (n !== last) { last = n; quietSince = Date.now(); }
        }
        var quiet = document.readyState === "complete" && Date.now() - quietSince >= 800;
        if (quiet || Date.now() - start >= 5000) {
          if (obs) obs.disconnect();
          return resolve();
        }
        setTimeout(tick, 200);
      })();
    });
  }

  async function ubus_present(ms) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || CFG.ajaxTimeout);
    try {
      var r = await fetch("/ubus/?t=" + Date.now(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Z-Mode": "1" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "call", params: [ZERO_SID, "session", "access", {}] }),
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (r.status === 404) return false;
      var j = null;
      try { j = JSON.parse(await r.text()); } catch (e) { j = null; }
      if (!j || typeof j !== "object") return null;
      if (j.jsonrpc === "2.0" && "id" in j && ("result" in j || "error" in j)) return true;
      return null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(to);
    }
  }

  async function bootstrap() {
    window.__ztePanelNG = CFG.version;
    window.addEventListener("zte-panel-ng-second-copy", function () {
      toast("Another ZTE panel script is also enabled on this page — it was stopped.\nKeep only one enabled in your userscript manager.", "warn", 12000);
    });
    console.info("[ZTE] Panel NG Lite v" + CFG.version + " loaded");

    try { CFG.debug = localStorage.getItem(LS.DEBUG) === "1"; } catch (e) { }
    if (CFG.debug) console.info("[ZTE] debug logging ON");

    await wait_page_settled();
    var ub = await ubus_present();
    if (ub !== true && gf_seen_before()) {
      if ((await goform_wait_boot()) === "goform") return goform_bootstrap();
      ub = true;
    }
    if (ub === true) { try { localStorage.removeItem(GF_BACKEND_KEY); } catch (e) { } }
    if (ub === null) {
      if (await goform_present()) return goform_bootstrap();
      ub = await ubus_present();
      if (ub === null && (await goform_wait_boot(true)) === "goform") return goform_bootstrap();
      if (ub === null) ub = true;
    }
    if (ub === false) {
      if (await goform_present()) return goform_bootstrap();
      console.warn("[ZTE] This router answers neither /ubus/ nor /goform/ — the panel does not support it.");
      toast("ZTE Panel NG: this router's web interface answers neither the ubus nor the goform API,\n" +
        "so the panel stays off here.", "warn", 20000);
      return;
    }
    dismiss_login_again();
    var logged_in = await check_login();
    for (var n = 0; !logged_in && n < 4 && ms_since(sessionStorage, LS.TRIED) < 60000; n++) {
      await sleep(700);
      logged_in = await check_login();
    }
    if (logged_in) return start_panel();

    if (saved_hash()) {
      if (just_logged_out()) {
        toast("Logged out. Auto login waits 1 minute after a Logout —\nreload the page after that to log in automatically (or log in on the router page).", "info", 8000);
      } else if (ms_since(sessionStorage, LS.TRIED) < 60000 && !job_extra_login(true)) {
        toast("Auto login was just tried and the router page is still logged out.\nLog in on the router page.", "warn", 10000);
      } else {
        stamp(sessionStorage, LS.TRIED);
        var result = "error";
        try { result = await router_login(saved_hash()); } catch (e) { console.warn("[ZTE] Auto login error:", e.message); }
        if (result === "ok") {
          toast("Logged in with the saved password — reloading…", "ok", 3000);
          if (/login/i.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
          location.reload();
          return;
        }
        if (result === "rejected") {
          try { localStorage.removeItem(LS.PW); } catch (e) { }
          toast("Auto login failed — the router rejected the saved password, so it was removed.\nLog in on the router page, then save it again with 🔑 Auto Login.", "error", 15000);
        } else {
          toast("Auto login did not go through. Log in on the router page.", "warn", 10000);
        }
      }
    }

    var busy = false;
    var t = setInterval(async function () {
      if (busy) return;
      busy = true;
      try {
        dismiss_login_again();
        if (await check_login()) {
          clearInterval(t);
          await wait_page_settled();
          start_panel();
        }
      } catch (e) {
        console.warn("[ZTE] login wait: " + e.message);
      } finally {
        busy = false;
      }
    }, CFG.loginWaitInterval);
  }

  bootstrap();
})();
