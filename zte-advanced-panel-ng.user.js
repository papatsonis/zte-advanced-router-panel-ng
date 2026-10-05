// ==UserScript==
// @name         ZTE Advanced Router Panel NG (ubus)
// @namespace    https://github.com/papatsonis/zte-advanced-router-panel-ng
// @version      2026-ng1.31
// @description  ZTE signal monitor and controls for newer ubus-based routers (MC7520, MC7523/G5TC, MC7530 and later): signal, band lock, cell lock, network mode, ODU antenna selection, neighbor scan, bridge mode, DNS, APN, session timeout, temperature control, traffic stats, GPS, plus developer tools.
// @author       papatsonis (based on work by Cerix and Thomas Pöchtrager)
// @license      AGPL-3.0-or-later
// @homepageURL  https://github.com/papatsonis/zte-advanced-router-panel-ng
// @supportURL   https://github.com/papatsonis/zte-advanced-router-panel-ng/issues
// @downloadURL  https://raw.githubusercontent.com/papatsonis/zte-advanced-router-panel-ng/main/zte-advanced-panel-ng.user.js
// @updateURL    https://raw.githubusercontent.com/papatsonis/zte-advanced-router-panel-ng/main/zte-advanced-panel-ng.user.js
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
 * ZTE Advanced Router Panel NG
 *
 * A port of "ZTE Advanced Router Panel" by Cerix to the ubus JSON-RPC API of
 * newer ZTE routers, built on the API calls, login flow and signal parsing of
 * "ZTE-Script-NG" by Thomas Pöchtrager, with further features added.
 *
 * Port and modifications: papatsonis, 2026 — https://github.com/papatsonis/zte-advanced-router-panel-ng
 * This is a modified work. It is not maintained or endorsed by the original
 * authors; please do not ask them for support for this version.
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

  // ─────────────────────────────────────────────
  //  CONFIGURATION
  // ─────────────────────────────────────────────
  var CFG = {
    version: "2026-ng1.31",
    bmac: true,
    pollInterval: 1000,
    slowPollEvery: 5, // temperature, CPU/memory and WAN status are read on every 5th poll
    loginWaitInterval: 1500,
    toastDuration: 4000,
    ajaxTimeout: 10000,
    retryOnAccessDenied: 5, // ZTE's web server sometimes returns Access Denied spuriously (same as ZTE-Script-NG)
    // Hours between automatic IP reassignment (Very/Wind SIMs reconnect every 4h).
    // Set to 0 to disable the countdown display.
    ip_cycle_hours: 4,
    // The panel reads the band lists from the router itself. These two lists are used only if
    // the router does not report its own ("Remove band lock" = lock to all of these).
    lte_all_bands: [1, 3, 7, 8, 20, 28, 38, 40, 41, 42, 43],
    nr_all_bands: ["1", "3", "7", "8", "20", "28", "38", "40", "41", "75", "77", "78"],
    nr_type_variants: ["1", "NSA", "nsa", "ENDC", "LTE_AND_5G"], // extra values tried by "Probe 5G NSA lock"
  };

  var ZERO_SID = "00000000000000000000000000000000";

  // ─────────────────────────────────────────────
  //  GLOBAL STATE
  // ─────────────────────────────────────────────
  var S = (window._ZTE_STATE = {
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
    poll_timer: null,
    poll_tick: 0,
  });

  // ─────────────────────────────────────────────
  //  SMALL HELPERS
  // ─────────────────────────────────────────────
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
  function zset(id, t) {
    var e = zel(id);
    if (e) e.textContent = t !== undefined && t !== null ? t : "";
  }
  function zhtml(id, h) {
    var e = zel(id);
    if (e) e.innerHTML = h;
  }
  function ztoggle(id, show) {
    var e = zel(id);
    if (e) e.style.display = show ? "" : "none";
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

  // ─────────────────────────────────────────────
  //  TOAST NOTIFICATIONS (stacking queue)
  // ─────────────────────────────────────────────
  var toastQueue = [];
  function repositionToasts() {
    var top = 18;
    for (var i = 0; i < toastQueue.length; i++) {
      toastQueue[i].style.top = top + "px";
      top += toastQueue[i].offsetHeight + 8;
    }
  }
  function toast(msg, type, ms) {
    var colors = { info: "#1976D2", ok: "#388E3C", warn: "#F57C00", error: "#D32F2F" };
    var el = document.createElement("div");
    el.style.cssText =
      "position:fixed;top:18px;right:18px;z-index:2147483647;background:" +
      (colors[type] || colors.info) +
      ";color:#fff;padding:12px 20px;border-radius:8px;font-family:Segoe UI,Verdana,sans-serif;" +
      "font-size:13px;box-shadow:0 4px 15px rgba(0,0,0,.25);max-width:360px;white-space:pre-line;" +
      "word-wrap:break-word;transition:opacity .3s, top .3s ease-out;";
    el.textContent = msg;
    document.body.appendChild(el);
    toastQueue.push(el);
    repositionToasts();
    setTimeout(function () {
      el.style.opacity = "0";
      setTimeout(function () {
        var i = toastQueue.indexOf(el);
        if (i > -1) toastQueue.splice(i, 1);
        el.remove();
        repositionToasts();
      }, 350);
    }, ms || CFG.toastDuration);
  }

  // ─────────────────────────────────────────────
  //  SHA256
  //  crypto.subtle only exists in secure contexts (https / localhost).
  //  Router pages on plain http://192.168.x.x are NOT secure contexts,
  //  so we fall back to a pure-JS implementation. Output is UPPERCASE hex.
  // ─────────────────────────────────────────────
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
    var padded = (((len + 9) >> 6) + 1) * 16;
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
      } catch (e) { /* fall through */ }
    }
    return sha256_js(str);
  }

  // ─────────────────────────────────────────────
  //  UBUS JSON-RPC
  //  Each call: { service, method, params }
  //  Returns { success, data, accessDenied, error } (or an array of those)
  // ─────────────────────────────────────────────
  async function ubus(calls, opts) {
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
      // double "t" on purpose (same marker as ZTE-Script-NG in the network log)
      var r = await fetch("/ubus/?t=" + Date.now() + "&t=" + Date.now(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Z-Mode": "1" }, // Z-Mode prevents auto logout
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      json = await r.json();
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
        return { success: false, data: null, accessDenied: x.error.code === -32002, error: x.error.message };
      }
      var res = x.result || [];
      if (res[0] === 0) return { success: true, data: res.length > 1 ? res[1] : null };
      if (!opts.quiet) console.warn("[ZTE] ubus failed", rq.params[1] + "." + rq.params[2], "code", res[0]);
      return { success: false, data: null, code: res[0], error: "code " + res[0] };
    });
    return Array.isArray(calls) ? out : out[0];
  }

  async function ubusRetry(calls, opts, max) {
    max = max || CFG.retryOnAccessDenied;
    var res;
    for (var i = 0; i < max; i++) {
      if (i) await new Promise(function (r) { setTimeout(r, 250); }); // never hammer the router
      res = await ubus(calls, opts);
      var denied = Array.isArray(res) ? res.some(function (r) { return r.accessDenied; }) : res.accessDenied;
      if (!denied) break;
    }
    return res;
  }

  // Run a setter, show a toast, refresh the panel
  async function run_action(label, fn) {
    try {
      var res = await fn();
      var ok = Array.isArray(res) ? res.every(function (r) { return r && r.success; }) : res && res.success;
      toast(ok ? label + " ✓" : label + " failed" + (res && res.error ? " (" + res.error + ")" : ""), ok ? "ok" : "error");
      poll_once();
      return !!ok;
    } catch (e) {
      toast(label + " failed: " + e.message, "error");
      return false;
    }
  }

  // ─────────────────────────────────────────────
  //  AUTH (ubus: zwrt_web)
  //  final password = SHA256( SHA256(password) + zte_web_sault ), uppercase hex
  // ─────────────────────────────────────────────
  // Auto login (optional): a SHA256 hash of the router password, saved only if the user asks.
  //
  // How it works, and why it is done exactly this way:
  //   - The saved password is used only when the router page is opened and nobody is logged in.
  //     The panel logs in once, stores the session token where the router's page keeps it
  //     (sessionStorage "ct") and reloads the page once. The router's page then starts up
  //     already logged in — the same thing that happens when a logged-in page is refreshed.
  //   - The panel never logs in while the router's page is running. A login made behind the
  //     page's back is not picked up by it, and a second session only gets in the way.
  //   - Right after a Logout the saved password is not used, so that logging out works.
  var PW_KEY = "ZtePanelPwHash";          // localStorage: SHA256 of the password, if saved
  var TRIED_KEY = "ZtePanelAutoLoginAt";  // sessionStorage (per tab): an automatic login + reload is under way (no reload loops)
  var LOGOUT_KEY = "ZtePanelLogoutAt";    // localStorage: the page was left with its session token already removed
  var SEEN_KEY = "ZtePanelSeenAlive";     // sessionStorage (per tab): time of the last successful poll

  function saved_hash() {
    try { return localStorage.getItem(PW_KEY); } catch (e) { return null; }
  }
  function ms_since(storage, key) {
    var v = 0;
    try { v = Number(storage.getItem(key)) || 0; } catch (e) { /* ignore */ }
    return Date.now() - v;
  }
  function stamp(storage, key) {
    try { storage.setItem(key, String(Date.now())); } catch (e) { /* ignore */ }
  }
  // Was somebody logged in on THIS tab until a moment ago? Then the login form means "Logout".
  // (A new tab has no such history, so there the saved password is used.)
  function just_logged_out() {
    return ms_since(sessionStorage, SEEN_KEY) < 10000 || ms_since(localStorage, LOGOUT_KEY) < 10000;
  }

  async function ask_pw_hash() {
    var pw = prompt("Router password:");
    return pw ? sha256Hex(pw) : null;
  }

  // One login to the router with the saved password. Returns "ok", "rejected" or "error".
  async function router_login(pw_hash) {
    var saltRes = await ubus({ service: "zwrt_web", method: "web_login_info" }, { session: ZERO_SID });
    var sault = saltRes && saltRes.data && saltRes.data.zte_web_sault;
    if (!sault) return "error";
    var finalHash = await sha256Hex(pw_hash + sault);
    var r = await ubus({ service: "zwrt_web", method: "web_login", params: { password: finalHash } }, { session: ZERO_SID });
    var d = r && r.data;
    console.log("[ZTE] auto login answer: result=" + (d ? d.result : "none"));
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

  // Developer-options login, made inside the session the router's page already has.
  // (This is not a login to the router: it creates no new session.)
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
      try { localStorage.setItem(PW_KEY, h); } catch (e) { /* ignore */ }
      ov.remove();
      update_login_state();
      toast("Password saved.\nIt is used the next time you open the router page.", "ok");
    }
    ov.querySelector("#zte_pw_save").onclick = save;
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") save(); });
    inp.focus();
  };

  window.zte_forget_password = function () {
    try { localStorage.removeItem(PW_KEY); } catch (e) { /* ignore */ }
    update_login_state();
    toast("Saved password removed", "info");
  };

  function update_login_state() {
    zset("zte_autologin_state", saved_hash() ? "on (password saved)" : "off");
  }

  // ─────────────────────────────────────────────
  //  FREQUENCY CONVERSION (from ZTE-Script-NG)
  // ─────────────────────────────────────────────
  function lte_earfcn_to_mhz(earfcn) {
    var t = [
      // [band, f_dl_low, n_offs_dl, n_min_dl, n_max_dl]
      [1, 2110, 0, 0, 599], [3, 1805, 1200, 1200, 1949], [4, 2110, 1950, 1950, 2399],
      [5, 869, 2400, 2400, 2649], [7, 2620, 2750, 2750, 3449], [8, 925, 3450, 3450, 3799],
      [20, 791, 6150, 6150, 6449], [28, 758, 9210, 9210, 9659], [32, 1452, 9920, 9920, 10359],
      [38, 2570, 37750, 37750, 38249], [40, 2300, 38650, 38650, 39649],
      [42, 3400, 41590, 41590, 43589], [43, 3600, 43590, 43590, 45589],
    ];
    for (var i = 0; i < t.length; i++) {
      if (earfcn >= t[i][3] && earfcn <= t[i][4])
        return { band: t[i][0], mhz: +(t[i][1] + 0.1 * (earfcn - t[i][2])).toFixed(1) };
    }
    return null;
  }

  function nr_arfcn_to_mhz(arfcn) {
    function f(N) {
      if (N >= 0 && N <= 599999) return 0.005 * N;
      if (N >= 600000 && N <= 2016666) return 3000 + 0.015 * (N - 600000);
      if (N >= 2016667 && N <= 3279165) return 24250 + 0.06 * (N - 2016667);
      return null;
    }
    var t = [
      [1, 422000, 434000], [3, 361000, 376000], [5, 173800, 178800], [7, 524000, 538000],
      [8, 185000, 192000], [28, 151600, 160600], [40, 460000, 480000], [41, 499200, 537999],
      [75, 286400, 303400], [78, 620000, 653333], [79, 693334, 733333],
      [257, 2054167, 2104166], [258, 2016667, 2070833], [260, 2229167, 2279166], [261, 2070833, 2084999],
    ];
    for (var i = 0; i < t.length; i++) {
      if (arfcn >= t[i][1] && arfcn <= t[i][2]) {
        var m = f(arfcn);
        return m === null ? null : { band: t[i][0], mhz: +m.toFixed(2) };
      }
    }
    return null;
  }

  // ─────────────────────────────────────────────
  //  CELL ID → eNodeB / gNodeB
  //  LTE ECI (28 bit) = eNodeB (20 bit) << 8 | sector (8 bit)
  //  NR NCI is 36 bit; we use the same 8-bit sector split as ZTE-Script-NG.
  //  Division instead of >>> so values above 2^32 are not truncated.
  // ─────────────────────────────────────────────
  function parse_cell_id(s) {
    if (s === null || s === undefined || s === "") return null;
    s = String(s).trim();
    var n = /^0x/i.test(s) || (/^[0-9a-f]+$/i.test(s) && !/^\d+$/.test(s)) ? parseInt(s.replace(/^0x/i, ""), 16) : parseInt(s, 10);
    return isNaN(n) || n <= 0 ? null : n;
  }
  function split_cell_id(s) {
    var n = parse_cell_id(s);
    if (n === null) return null;
    return { node: Math.floor(n / 256), sector: n % 256 };
  }

  // ─────────────────────────────────────────────
  //  PARSE LTE CELLS (netinfo.lteca / netinfo.ltecasig)
  //  lteca entry:    pci,?,?,earfcn,bandwidth;...
  //  ltecasig entry: rsrp,rsrq,sinr,rssi,ul_configured(1),active(2);...  (SCells only)
  // ─────────────────────────────────────────────
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
        c.rsrp = num(d.lte_rsrp); c.rsrq = num(d.lte_rsrq); c.sinr = num(d.lte_snr); c.rssi = num(d.lte_rssi);
      } else if (sig[idx - 1]) {
        var s = sig[idx - 1].split(",").map(function (x) { return x.trim(); });
        if (s.length >= 6) {
          c.rsrp = num(s[0]); c.rsrq = num(s[1]); c.sinr = num(s[2]); c.rssi = num(s[3]);
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

  // ─────────────────────────────────────────────
  //  PARSE NR CELLS (primary from nr5g_* + SCells from netinfo.nrca)
  //  nrca entry: ul(1/0),pci,active(2/1),band,arfcn,bw,?,rsrp,rsrq,sinr,rssi;...
  // ─────────────────────────────────────────────
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
        rsrp: num(d.nr5g_rsrp), rsrq: num(d.nr5g_rsrq), sinr: num(d.nr5g_snr), rssi: num(d.nr5g_rssi),
        ul: true, active: true,
        band: conv ? String(conv.band) : strip_n(d.nr5g_action_band),
        freq: conv ? conv.mhz : null,
      });
    }
    if (d.nrca) {
      d.nrca.split(";").filter(function (e) { return e.trim() !== ""; }).forEach(function (entry) {
        var p = entry.split(",").map(function (x) { return x.trim(); });
        if (p.length < 11) return;
        var a = parseInt(p[4], 10);
        var cv = nr_arfcn_to_mhz(a);
        // A configured but inactive SCell reports the floor values -140/-43/-23/-120 = "not measured"
        var unmeasured = num(p[7]) !== null && num(p[7]) <= -140;
        out.push({
          pci: parseInt(p[1], 10),
          arfcn: a,
          bandwidth: parseInt(p[5], 10),
          rsrp: unmeasured ? null : num(p[7]), rsrq: unmeasured ? null : num(p[8]),
          sinr: unmeasured ? null : num(p[9]), rssi: unmeasured ? null : num(p[10]),
          ul: parseInt(p[0], 10) === 1,
          active: parseInt(p[2], 10) === 2,
          band: cv ? String(cv.band) : strip_n(p[3]),
          freq: cv ? cv.mhz : null,
        });
      });
    }
    return out;
  }

  function net_flags(nt) {
    return {
      is_lte: nt === "LTE" || nt === "ENDC" || nt === "LTE-NSA",
      is_sa: nt === "SA",
      is_nsa: nt === "ENDC" || nt === "LTE-NSA",
      show_nr: nt === "SA" || nt === "ENDC",
    };
  }

  function band_info(lte, nr) {
    var parts = [];
    nr.forEach(function (c) { if (c.band) parts.push("n" + c.band + (c.bandwidth ? "(" + c.bandwidth + "MHz)" : "")); });
    lte.forEach(function (c) { if (c.band) parts.push("B" + c.band + (c.bandwidth ? "(" + c.bandwidth + "MHz)" : "")); });
    return parts.join(" + ");
  }

  // ─────────────────────────────────────────────
  //  LTE BAND MASK HELPERS (decimal string bitmask, bit n-1 = band n)
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  //  ROUTER COMMANDS (ubus: zte_nwinfo_api)
  // ─────────────────────────────────────────────
  var NET_MODES = {
    Only_5G: "5G SA",
    LTE_AND_5G: "5G NSA",
    WL_AND_5G: "4G/5G Auto",
    Only_LTE: "LTE Only",
  };

  window.zte_set_net_mode = function (mode) {
    if (!mode) {
      mode = prompt(
        "Network mode (net_select):\n" +
          Object.keys(NET_MODES).map(function (k) { return k + " = " + NET_MODES[k]; }).join("\n"),
        S.net.net_select || "WL_AND_5G",
      );
      if (!mode) return;
      mode = mode.trim();
    }
    return run_action("Network mode → " + (NET_MODES[mode] || mode), function () {
      return ubusRetry({ service: "zte_nwinfo_api", method: "nwinfo_set_netselect", params: { net_select: mode } });
    });
  };

  function send_lte_mask(mask, label) {
    return run_action(label, function () {
      return ubusRetry({
        service: "zte_nwinfo_api",
        method: "nwinfo_set_gwl_bandlock",
        params: { is_gw_band: "0", gw_band_mask: "0", is_lte_band: "1", lte_band_mask: mask.toString() },
      });
    });
  }

  // All netinfo fields that look like an NR band lock (firmwares differ in naming)
  function nr_lock_fields(d) {
    var out = {};
    Object.keys(d || {}).forEach(function (k) {
      if (/^nr.*band_lock$/i.test(k) || k === "nr5g_sa_band_lock") out[k] = d[k];
    });
    return out;
  }
  // ── The bands this router has ──
  // The router keeps its factory band lists in uci zwrt_zte_nwinfo / default_band_lock, e.g. on a G5TC:
  //   default_lte_ext_band_lock   "1,3,7,8,20,28,38"
  //   default_nr5g_sa_band_lock   "1,3,7,28,75,78"
  //   default_nr5g_nsa_band_lock  "1,3,7,28,75,78"
  // These are what "no band lock" means on that model. The panel shows them as "Supported bands"
  // and uses them for the "Unlocked" status, for "Remove band lock", to leave out band buttons the
  // router cannot do, and to refuse bands it does not have.
  // CFG.lte_all_bands / CFG.nr_all_bands are only a fallback for firmware that reports no such list.
  var UCI_BAND_DEFAULTS = { service: "uci", method: "get", params: { config: "zwrt_zte_nwinfo", section: "default_band_lock" } };

  // "1,3,7" → ["1", "3", "7"] (numbers only, ascending, no duplicates)
  function band_list(v) {
    var seen = {};
    return String(v || "").split(/[,+\s]+/).map(strip_n).filter(function (b) {
      if (!/^\d+$/.test(b) || seen[b]) return false;
      seen[b] = true;
      return true;
    }).sort(function (a, b) { return a - b; });
  }
  // S.bands = { lte, nr_sa, nr_nsa } as reported by the router (empty lists if it reports none)
  function lte_from_router() { return !!(S.bands && S.bands.lte.length); }
  function nr_from_router() { return !!(S.bands && (S.bands.nr_sa.length || S.bands.nr_nsa.length)); }
  function lte_avail() {
    return lte_from_router() ? S.bands.lte : CFG.lte_all_bands.map(String);
  }
  // which: "sa", "nsa", or nothing for every 5G band the router has
  function nr_avail(which) {
    if (!nr_from_router()) return CFG.nr_all_bands.map(String);
    var b = S.bands;
    if (which === "sa") return b.nr_sa.length ? b.nr_sa : b.nr_nsa;
    if (which === "nsa") return b.nr_nsa.length ? b.nr_nsa : b.nr_sa;
    return band_list(b.nr_sa.concat(b.nr_nsa).join(","));
  }
  // One read at start; asked again before a band action if the router did not answer then.
  async function load_band_caps() {
    if (S.bands_loaded || S.bands_busy) return;
    S.bands_busy = true;
    try {
      var r = await ubusRetry(UCI_BAND_DEFAULTS, { quiet: true });
      if (r.accessDenied) { // not answered: try a few more times, and again before a band action
        S.bands_tries = (S.bands_tries || 0) + 1;
        if (S.bands_tries < 4) setTimeout(load_band_caps, 8000);
        return;
      }
      var v = uci_values(r) || {};
      var lte = band_list(v.default_lte_ext_band_lock);
      if (!lte.length && v.default_lte_band_lock) lte = (lte_bands_from_mask(v.default_lte_band_lock) || []).map(String);
      S.bands = { lte: lte, nr_sa: band_list(v.default_nr5g_sa_band_lock), nr_nsa: band_list(v.default_nr5g_nsa_band_lock) };
      S.bands_loaded = true;
      console.log("[ZTE] bands of this router: LTE " + (lte.join(",") || "(not reported)") + " · 5G SA " + (S.bands.nr_sa.join(",") || "(not reported)") + " · 5G NSA " + (S.bands.nr_nsa.join(",") || "(not reported)"));
      render_band_chips();
    } catch (e) { /* keep the built-in lists */ } finally {
      S.bands_busy = false;
    }
  }

  // Band buttons: a fixed set of common locks. One that needs a band this router does not have
  // is left out. Every other band of the router is reachable through "Custom".
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
  // The grey "Supported bands" line under each "Remove band lock" button: what the router reports
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
  // Bands of `list` that this router does not have (only when the router reported its bands)
  function bands_missing(list, avail, known) {
    return known ? list.filter(function (b) { return avail.indexOf(String(b)) === -1; }) : [];
  }

  // Bands of a lock field, or null when it is empty / contains every band (= no lock)
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

  // ── 5G band lock ──
  // zte_nwinfo_api / nwinfo_set_nrbandlock { nr5g_type, nr5g_band }
  // The router keeps separate lock lists for 5G SA and 5G NSA. A lock is written to
  // both, so it applies whichever mode the router is in. "SA" is the type for the SA
  // list; for the NSA list firmwares differ, so the known values are tried in turn
  // and the one the router accepts is remembered.
  var NSA_TYPE_KEY = "ZtePanelNrNsaType";
  var NSA_TYPES = ["1", "NSA"];
  function nsa_type() {
    try { var v = localStorage.getItem(NSA_TYPE_KEY); if (v) return v; } catch (e) { /* ignore */ }
    return NSA_TYPES[0];
  }

  function nr_lock_call(type, bands) {
    return {
      service: "zte_nwinfo_api",
      method: "nwinfo_set_nrbandlock",
      params: { nr5g_type: String(type), nr5g_band: bands.join(",") },
    };
  }

  // Send one lock request, then read back which lock list now holds exactly these bands
  async function nr_lock_once(type, bands) {
    var r = await ubusRetry(nr_lock_call(type, bands));
    console.log("[ZTE] NR band lock type " + type + ", bands " + bands.join(",") + " ←", JSON.stringify(r));
    if (!r.success) return { ok: false, error: r.error };
    await sleep(1500);
    var d = await fresh_netinfo();
    if (!d) return { ok: true, checked: false };
    var f = nr_lock_fields(d), want = band_set(bands.join(","));
    console.log("[ZTE] NR band lock lists after type " + type + ":", JSON.stringify(f));
    function has(re) { return Object.keys(f).some(function (k) { return re.test(k) && band_set(f[k]) === want; }); }
    return { ok: true, checked: true, sa: has(/_sa_band_lock$/i), nsa: has(/_nsa_band_lock$/i) };
  }

  // target: "sa" or "nsa"
  async function nr_lock_apply(target, bands) {
    var first = nsa_type();
    var types = target === "sa" ? ["SA"] : [first].concat(NSA_TYPES.filter(function (t) { return t !== first; }));
    var res = null;
    for (var i = 0; i < types.length; i++) {
      res = await nr_lock_once(types[i], bands);
      if (!res.ok) continue; // this firmware rejects that type — try the next one
      if (!res.checked) break;
      if (res[target]) {
        if (target === "nsa" && types[i] !== first) { try { localStorage.setItem(NSA_TYPE_KEY, types[i]); } catch (e) { /* ignore */ } }
        break;
      }
    }
    return res;
  }

  // nsaBands: only when the NSA list must differ from the SA one (the router's two default lists)
  async function send_nr_bands(bands, label, nsaBands) {
    toast(label + "…", "info");
    var sa = await nr_lock_apply("sa", bands);
    if (!sa.ok) {
      toast(label + " failed" + (sa.error ? " (" + sa.error + ")" : ""), "error");
      return false;
    }
    var nsa = await nr_lock_apply("nsa", nsaBands || bands);
    poll_once();
    if (!sa.checked) {
      toast(label + " sent, but the panel could not confirm it was saved.", "warn");
      return true;
    }
    var nsaChecked = nsa.ok && nsa.checked;
    var saSaved = sa.sa || (nsaChecked && nsa.sa);
    var nsaSaved = nsaChecked && nsa.nsa;
    var onNsa = net_flags(S.net.network_type).is_nsa;
    if (onNsa ? nsaSaved : saSaved) {
      toast(label + " ✓\nIf the router stays on the old band, switch network mode once.", "ok");
    } else if (saSaved) {
      toast(label + " was saved for 5G SA only.\nOn 5G NSA this router may not apply it.", "warn");
    } else {
      toast("The router did not save the 5G band lock.", "error");
    }
    return true;
  }

  // Developer tool: try several nr5g_type values and report which one changes a stored lock list.
  window.zte_probe_nr_nsa = async function () {
    var def = nr_bands_now().join("+") || "78";
    var inp = prompt(
      "🧪 Probe 5G NSA band lock\n\n" +
        "Sends the band lock with different nr5g_type values (" + CFG.nr_type_variants.join(", ") + ")\n" +
        "and checks which one the router stores. Each try really sets the lock,\n" +
        "so pick bands you're happy to stay on (or use 'Remove NR Band Lock' afterwards).\n\n" +
        "Bands to lock (e.g. 78 or 78+28):",
      def,
    );
    if (!inp) return;
    var bands = parse_band_input(inp);
    if (!bands) { toast("Invalid band input", "error"); return; }
    var want = band_set(bands.join(","));
    var results = [];
    var winner = null;
    toast("Probing " + CFG.nr_type_variants.length + " variants…", "info");
    for (var i = 0; i < CFG.nr_type_variants.length; i++) {
      var type = CFG.nr_type_variants[i];
      var b4 = nr_lock_fields((await fresh_netinfo()) || {});
      var r = await ubusRetry(nr_lock_call(type, bands), null, 5);
      await sleep(1500);
      var af = nr_lock_fields((await fresh_netinfo()) || {});
      var changed = Object.keys(af).filter(function (k) { return String(af[k]) !== String(b4[k]); });
      var stored = Object.keys(af).filter(function (k) { return band_set(af[k]) === want; });
      results.push({ type: type, ok: r.success, err: r.error, changed: changed, stored: stored, after: af });
      console.log("[ZTE] probe type", type, "→", r, "changed:", changed, "after:", af);
      // A variant that stores into a non-SA field is what we want for NSA
      if (r.success && stored.some(function (k) { return !/_sa_/i.test(k); })) { winner = type; break; }
    }
    var html =
      '<div class="zte_sec"><div class="zte_sec_title">Results — requested n' + esc(bands.join(",n")) + "</div>" +
      results.map(function (x) {
        return '<div class="zte_row" style="align-items:flex-start;"><span class="zte_label">nr5g_type = "' + esc(x.type) + '"</span>' +
          '<span class="zte_value">' + (x.ok ? "call OK" : "call failed: " + esc(x.err || "")) + "<br>" +
          "changed: " + esc(x.changed.join(", ") || "nothing") + "<br>" +
          '<span style="font-weight:400;color:#78909C;">' + esc(Object.keys(x.after).map(function (k) { return k + "=" + (x.after[k] || "(empty)"); }).join(" · ")) + "</span>" +
          "</span></div>";
      }).join("") +
      "</div>" +
      '<div class="zte_sec" style="font-size:11px;">' +
      (winner
        ? '<b style="color:#2E7D32">nr5g_type "' + esc(winner) + '" stored an NSA lock.</b> It is now saved and used for the NSA lock list.'
        : "<b>No variant stored a separate NSA lock field.</b> Either the router keeps one shared 5G lock (check whether your NR band changes after toggling network mode), " +
          "or NSA uses a different method — try 🔎 Find band-lock API and send me the result.") +
      "</div>" +
      '<button class="zte_btn ok" id="zte_probe_copy" style="width:100%;">📋 Copy results</button>';
    if (winner) { try { localStorage.setItem(NSA_TYPE_KEY, winner); } catch (e) {} }
    var ov = show_modal("Probe 5G NSA lock", html);
    ov.querySelector("#zte_probe_copy").onclick = function () { copy_text(JSON.stringify(results, null, 2), "Probe results copied"); };
    poll_once();
  };

  function nr_bands_now() {
    return (S.nr || []).map(function (c) { return c.band; }).filter(Boolean);
  }

  // ─────────────────────────────────────────────
  //  API FINDER — asks the router itself:
  //   1. ubus JSON-RPC "list" (method names + argument names), if the router allows it
  //   2. its own web-UI JavaScript, searched for a keyword
  // ─────────────────────────────────────────────
  function re_escape(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  window.zte_find_api = async function (kw) {
    if (kw === undefined) {
      kw = prompt("🔎 Find API — keyword to search for\n(e.g. reboot, bridge, passthrough, reset, flow, gps, dns)", "reboot");
      if (!kw) return;
    }
    var bandLock = kw === "__nrlock";
    var pattern = bandLock ? "nrbandlock|nr_band_lock|nr5g_type|nr5g_band|nsa_band|bandlock" : re_escape(kw.trim());
    var title = bandLock ? "5G band lock" : kw.trim();
    toast("Searching the router's API and web code for “" + title + "”…", "info");
    var out = { keyword: title, ubus_list: null, ubus_list_error: null, js_hits: [] };

    try {
      var r = await fetch("/ubus/?t=" + Date.now(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Z-Mode": "1" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "list", params: [bandLock ? "zte_nwinfo_api" : "*"] }),
      });
      var j = await r.json();
      if (j && j.result) out.ubus_list = j.result;
      else out.ubus_list_error = JSON.stringify(j && j.error ? j.error : j);
    } catch (e) {
      out.ubus_list_error = e.message;
    }

    var urls = new Set();
    document.querySelectorAll("script[src]").forEach(function (s) { urls.add(s.src); });
    (performance.getEntriesByType("resource") || []).forEach(function (e) {
      if (/\.js(\?|$)/i.test(e.name)) urls.add(e.name);
    });
    var re = new RegExp(pattern, "gi");
    for (var u of urls) {
      if (new URL(u, location.href).origin !== location.origin) continue;
      try {
        var txt = await (await fetch(u)).text();
        var m, seen = 0;
        re.lastIndex = 0;
        while ((m = re.exec(txt)) && seen < 15) {
          var snip = txt.slice(Math.max(0, m.index - 250), m.index + 650).replace(/\s+/g, " ");
          if (!out.js_hits.some(function (h) { return h.snip === snip; })) {
            out.js_hits.push({ file: u.split("/").pop().split("?")[0], snip: snip });
            seen++;
          }
          re.lastIndex = m.index + 300; // skip overlapping matches
        }
      } catch (e) { /* ignore unreadable files */ }
      if (out.js_hits.length >= 60) break;
    }

    var hlRe = bandLock ? /band|lock|nr|nsa/i : new RegExp(pattern, "i");
    var listHtml = out.ubus_list
      ? Object.keys(out.ubus_list).sort().map(function (obj) {
          var meths = Object.keys(out.ubus_list[obj]).sort().filter(function (meth) {
            return bandLock || hlRe.test(meth) || hlRe.test(obj);
          });
          if (!meths.length) return "";
          return '<div style="font-size:10px;color:#1976D2;margin-top:6px;">' + esc(obj) + "</div>" +
            meths.map(function (meth) {
              var hl = hlRe.test(meth);
              return '<div style="font-size:11px;' + (hl ? "color:#E65100;font-weight:700;" : "color:#78909C;") + '">' +
                esc(meth) + " " + esc(JSON.stringify(out.ubus_list[obj][meth])) + "</div>";
            }).join("");
        }).join("") || '<div style="color:#78909C;font-size:11px;">No matching methods.</div>'
      : '<div style="color:#78909C;font-size:11px;">Not allowed by this router (' + esc(out.ubus_list_error || "") + ")</div>";
    var jsHtml = out.js_hits.length
      ? out.js_hits.map(function (h) {
          return '<div style="font-size:10px;color:#1976D2;margin-top:6px;">' + esc(h.file) + "</div>" +
            '<pre style="white-space:pre-wrap;word-break:break-all;font-size:10px;margin:0;user-select:text;">' + esc(h.snip) + "</pre>";
        }).join("")
      : '<div style="color:#78909C;font-size:11px;">No matches in loaded scripts. Open the router\'s own page for this feature once, then run this again.</div>';

    var ov = show_modal(
      "API finder — " + title,
      '<button class="zte_btn ok" id="zte_find_copy" style="width:100%;margin-bottom:8px;">📋 Copy everything (send this to me)</button>' +
        '<div class="zte_sec"><div class="zte_sec_title">Matching ubus methods</div>' + listHtml + "</div>" +
        '<div class="zte_sec"><div class="zte_sec_title">Matches in the router\'s web UI code</div>' + jsHtml + "</div>",
    );
    ov.querySelector("#zte_find_copy").onclick = function () { copy_text(JSON.stringify(out, null, 2), "Copied"); };
  };
  window.zte_find_lock_api = function () { return window.zte_find_api("__nrlock"); };

  // ─────────────────────────────────────────────
  //  EXTRA FEATURES
  //  Calls taken from community reverse-engineering of ZTE's ZWRT firmware
  //  (open-u60-pro / zte-u60-pro-mu5250-manager, ZTE U60 Pro). Those tools call
  //  ubus as root on the device; from the web login some may be refused.
  // ─────────────────────────────────────────────
  function denied_msg(what, kw) {
    return "The router refused " + what + " from the web login.\nUse 🔎 Find API with keyword '" + kw + "' and send me the result.";
  }

  // ── Reboot ──
  // The router's own web UI (service_rpc.js) reboots with:
  //   zwrt_mc.device.manager / device_reboot { moduleName: RPC_MODULE_NAME }
  // RPC_MODULE_NAME is read from the router's own scripts; "web" is the fallback.
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
      } catch (e) { /* ignore */ }
    }
    _rpcModuleName = _rpcModuleName || "web";
    console.log("[ZTE] RPC_MODULE_NAME =", _rpcModuleName);
    return _rpcModuleName;
  }

  window.zte_reboot = async function () {
    if (!confirm("Reboot the router?")) return;
    try {
      var mod = await rpc_module_name();
      var r = await ubusRetry({ service: "zwrt_mc.device.manager", method: "device_reboot", params: { moduleName: mod } });
      console.log("[ZTE] device_reboot (moduleName=" + mod + ") ←", JSON.stringify(r));
      if (!r.success) {
        // Fallback: standard OpenWrt reboot
        var r2 = await ubus({ service: "system", method: "reboot" });
        console.log("[ZTE] system.reboot ←", JSON.stringify(r2));
        if (!r2.success) {
          toast("Reboot failed (device_reboot: " + (r.error || "?") + ", system.reboot: " + (r2.error || "?") + ")", "error");
          return;
        }
      }
      toast("Router rebooting… log in again once it is back (about 1–2 min).", "warn");
    } catch (e) {
      // The router may drop the connection while rebooting
      toast("No answer from the router — it is probably rebooting.", "warn");
    }
  };

  // ── WAN reconnect: mobile data off → on (old "BTS hop") ──
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
  function set_wwan(cur, enable) {
    var body = { cid: 1, connect_mode: numish(cur.connect_mode), roam_enable: numish(cur.roam_enable), enable: enable };
    if (!enable) body.connect_status = "disconnected";
    console.log("[ZTE] set_wwaniface →", JSON.stringify(body));
    return ubusRetry({ service: "zwrt_data", method: "set_wwaniface", params: body });
  }

  window.zte_wan_reconnect = async function () {
    var cur = await get_wwan();
    if (!cur || cur.connect_mode === undefined || cur.roam_enable === undefined) {
      toast("Could not read the mobile-data settings (zwrt_data get_wwaniface) — not touching anything.", "error");
      console.log("[ZTE] get_wwaniface returned:", cur);
      return;
    }
    if (!confirm("Reconnect mobile data?\n\nTurns mobile data OFF and back ON (not a reboot).\n" +
      "Connection returns in about 10–20 s; the router may attach to a different cell.\n\n" +
      "Current: connect_status=" + (cur.connect_status || "?") + ", connect_mode=" + cur.connect_mode + ", roaming=" + cur.roam_enable))
      return;
    var off = await set_wwan(cur, 0);
    if (!off.success) {
      toast(off.accessDenied ? denied_msg("mobile data on/off", "wwaniface") : "Data OFF failed (" + (off.error || "?") + ")", "error");
      return;
    }
    toast("Mobile data OFF — turning it back on in 5 s…", "warn");
    await sleep(5000);
    var on = null;
    for (var i = 0; i < 3 && !(on && on.success); i++) {
      on = await set_wwan(cur, 1);
      if (!on.success) await sleep(2000);
    }
    if (!on.success) {
      toast("⚠️ Could not turn mobile data back ON.\nTurn it on in the router's own web page (Mobile data switch).", "error");
      return;
    }
    toast("Mobile data ON — waiting for connection…", "info");
    for (var k = 0; k < 15; k++) {
      await sleep(2000);
      var st = await get_wwan();
      if (st && /^(connected|ipv4|ipv6)/i.test(String(st.connect_status || ""))) {
        toast("Reconnected ✓ (" + st.connect_status + ")", "ok");
        poll_once();
        return;
      }
    }
    toast("Data is ON but not connected yet — give it a moment.", "warn");
  };

  // ── Reset band + cell locks to firmware defaults ──
  window.zte_reset_band_cell = async function () {
    if (!confirm("Reset ALL band and cell locks to the firmware defaults?\n\n" +
      "Uses nwinfo_reset_band_cell_setting (the router's own 'unlock all').\n" + APPLY_HINT.trim()))
      return;
    if (await run_action("Band & cell locks reset", function () {
      return ubusRetry({ service: "zte_nwinfo_api", method: "nwinfo_reset_band_cell_setting" });
    })) toast("Band & cell locks reset." + APPLY_HINT, "info");
  };

  // ── Neighbour cell scan ──
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
  // One neighbour cell given as text. The router returns
  //   "PCI,EARFCN,Band,RSRP,RSRQ"   e.g. "413,3050,B7,-83,-8"
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
      // no band field: PCI,(E)ARFCN,RSRP,RSRQ[,SINR] — work the band out from the channel
      o.pci = p[0]; o.earfcn = p[1]; o.rsrp = p[2]; o.rsrq = p[3]; o.sinr = p[4];
      var cv = type === "NR" ? nr_arfcn_to_mhz(+p[1]) : lte_earfcn_to_mhz(+p[1]);
      if (cv) o.band = (type === "NR" ? "n" : "B") + cv.band;
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
      // either one cell described as an object, or an empty answer (no cells)
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

  function wwan_connected(st) {
    return !!st && /^(connected|ipv4|ipv6)/i.test(String(st.connect_status || ""));
  }

  // The router's built-in scan disconnects mobile data and leaves it off → turn it back on
  async function restore_data_after_scan(before) {
    if (!(await check_login())) {
      toast("The router ended the session during the scan, so the panel could not check mobile data.\nLog in again; if you are offline, press 🔀 Reconnect data.", "warn", 12000);
      return;
    }
    var now = await get_wwan();
    if (!now) {
      toast("Could not check mobile data after the scan.\nIf you are offline, log in and press 🔀 Reconnect data.", "warn");
      return;
    }
    if (wwan_connected(now)) return;
    if (before && !wwan_connected(before)) {
      toast("Mobile data was already disconnected before the scan — left as it was.\nPress 🔀 Reconnect data to turn it on.", "info");
      return;
    }
    var base = before && before.connect_mode !== undefined ? before : now;
    if (base.connect_mode === undefined || base.roam_enable === undefined) {
      toast("Mobile data is off after the scan — press 🔀 Reconnect data.", "warn");
      return;
    }
    var on = null;
    for (var i = 0; i < 3 && !(on && on.success); i++) {
      on = await set_wwan(base, 1);
      if (!on.success) await sleep(2000);
    }
    if (!on.success) {
      toast("⚠️ Could not turn mobile data back on after the scan.\nUse the Mobile data switch in the router's own page.", "error");
      return;
    }
    for (var k = 0; k < 15; k++) {
      await sleep(2000);
      if (wwan_connected(await get_wwan())) { toast("Mobile data restored ✓", "ok"); return; }
    }
    toast("Mobile data switched back on — still connecting…", "warn");
  }

  window.zte_nbr_scan = async function () {
    if (S.nbr_running) { toast("Scan already running…", "warn"); return; }
    if (!confirm("Neighbor cell scan\n\nUses the router's built-in scan.\n" +
      "⚠️ Mobile data is disconnected while it scans (about 30 s). The panel turns it back on afterwards.\n\nContinue?"))
      return;
    S.nbr_running = true;
    S.pause_poll = true; // keep the router quiet while its modem is busy
    S.nbr = [];
    S.nbr_raw = null;
    ztoggle("zte_scan_panel", true);
    render_nbr("Starting scan…");
    var before = null, started = false, summary = "";
    try {
      before = await get_wwan();
      var r = await ubusRetry({ service: "zte_nwinfo_api", method: "nwinfo_scan_nbr" });
      if (!r.success) {
        render_nbr(r.accessDenied ? "Scan refused by the router (web login)" : "Scan failed: " + (r.error || "?"));
        return;
      }
      started = true;
      render_nbr("Scanning… (mobile data is off during the scan)");
      await sleep(6000);
      var last = "", stable = 0, loggedOut = false;
      for (var i = 1; i <= 9; i++) {
        var res = await ubusRetry([
          { service: "zte_nwinfo_api", method: "nwinfo_get_lte_nbr_contents" },
          { service: "zte_nwinfo_api", method: "nwinfo_get_nr5g_nbr_contents" },
        ], { quiet: true });
        if (res[0].accessDenied && res[1].accessDenied && !(await check_login())) {
          // the router dropped the web session during the scan
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
        if (stable >= 3) break;
        await sleep(3000);
      }
      var nl = S.nbr.filter(function (c) { return c.type === "LTE"; }).length;
      summary = loggedOut
        ? "The router logged you out during the scan — log in again and press Start Scan once more."
        : "Scan complete — " + S.nbr.length + " cell(s): " + nl + " LTE, " + (S.nbr.length - nl) + " 5G";
      render_nbr(summary + (loggedOut ? "" : " · restoring mobile data…"));
      if (!loggedOut) toast("Scan complete: " + nl + " LTE, " + (S.nbr.length - nl) + " 5G", S.nbr.length ? "ok" : "warn");
    } catch (e) {
      summary = "Scan error: " + e.message;
      render_nbr(summary);
    } finally {
      if (started) {
        try { await restore_data_after_scan(before); } catch (e) { /* ignore */ }
        render_nbr(summary);
      }
      S.pause_poll = false;
      S.nbr_running = false;
    }
  };

  window.zte_copy_nbr = function () {
    copy_text(JSON.stringify(S.nbr_raw || {}, null, 2), "Raw scan data copied");
  };

  window.zte_force_lock = async function (i) {
    var c = (S.nbr || [])[i];
    if (!c) return;
    var pci = parseInt(c.pci, 10), ch = parseInt(c.earfcn, 10);
    if (c.type === "LTE") {
      if (!confirm("Lock LTE cell PCI " + pci + ", EARFCN " + ch + "?\n\n⚠️ If this cell belongs to another operator the router will have no service until you unlock.\n" + APPLY_HINT.trim()))
        return;
      if (await run_action("LTE cell lock " + pci + "," + ch, function () { return lte_cell_call(pci, ch); }))
        toast("LTE cell lock set." + APPLY_HINT, "info");
    } else {
      var conv = nr_arfcn_to_mhz(ch);
      var band = strip_n(c.band) || (conv ? String(conv.band) : "");
      band = prompt("Lock 5G cell PCI " + pci + ", ARFCN " + ch + "\n\nConfirm the band number:\n" +
        "⚠️ If this cell belongs to another operator the router will have no service until you unlock.", band);
      if (!band || isNaN(strip_n(band))) return;
      band = strip_n(band);
      if (await run_action("5G cell lock " + pci + "," + ch + "," + band, function () { return nr_cell_call(pci, ch, band); }))
        toast("5G cell lock set." + APPLY_HINT, "info");
    }
  };

  // ── DNS (zwrt_router.api router_get_dns_para / router_set_wan_dns) ──
  function dnsf(d, k) {
    if (!d) return undefined;
    return d[k] !== undefined ? d[k] : d["wan_" + k];
  }
  async function get_dns() {
    var r = await ubusRetry({ service: "zwrt_router.api", method: "router_get_dns_para" }, { quiet: true });
    return r.success ? r.data || {} : null;
  }
  // Try unprefixed keys first, then the firmware's wan_-prefixed keys; verify by reading back.
  async function set_dns(mode, p1, p2) {
    var plain = { dns_mode: mode, prefer_dns_manual: p1 || "", standby_dns_manual: p2 || "" };
    var prefixed = { wan_dns_mode: mode, wan_prefer_dns_manual: p1 || "", wan_standby_dns_manual: p2 || "" };
    var tries = [plain, prefixed];
    for (var i = 0; i < tries.length; i++) {
      console.log("[ZTE] router_set_wan_dns →", JSON.stringify(tries[i]));
      var r = await ubusRetry({ service: "zwrt_router.api", method: "router_set_wan_dns", params: tries[i] });
      if (r.accessDenied) return { ok: false, msg: denied_msg("DNS changes", "dns") };
      await sleep(1200);
      var d = await get_dns();
      if (d && dnsf(d, "dns_mode") === mode && (mode !== "manual" || dnsf(d, "prefer_dns_manual") === p1))
        return { ok: true, msg: "DNS set to " + (mode === "manual" ? p1 + (p2 ? ", " + p2 : "") : "automatic (operator)") };
    }
    return { ok: false, msg: "The router did not apply the DNS change — see the console for details." };
  }

  window.zte_dns = async function () {
    var d = await get_dns();
    if (!d) { toast("Could not read DNS settings (router_get_dns_para)", "error"); return; }
    var ov = show_modal(
      "DNS",
      info_table("Current DNS settings", d, { rawKeys: true }) +
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
      ov.remove();
      var res = await set_dns("manual", p[0], p[1]);
      toast(res.msg, res.ok ? "ok" : "error");
    };
    ov.querySelector("#zte_dns_auto").onclick = async function () {
      ov.remove();
      var res = await set_dns("auto", "", "");
      toast(res.msg, res.ok ? "ok" : "error");
    };
  };

  // ── Operation mode: router (PPP) ↔ bridge (LTE_BRIDGE) ──
  // From the router's own web UI (service_rpc.js, SetOperationMode):
  //   zwrt_router.api / router_set_wan_mode { opms_wan_mode: "PPP" | "LTE_BRIDGE" }
  // Current mode = opms_wan_mode (router_get_status).
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
    if (!confirm(msg)) return;
    var r;
    try {
      r = await ubusRetry({ service: "zwrt_router.api", method: "router_set_wan_mode", params: { opms_wan_mode: target } });
    } catch (e) {
      toast("No answer from the router — it may be restarting to apply " + OP_MODES[target] + " mode.", "warn");
      return;
    }
    console.log("[ZTE] router_set_wan_mode(" + target + ") ←", JSON.stringify(r));
    if (!r.success) { toast("Mode change failed (" + (r.error || "?") + ")", "error"); return; }
    toast("Switching to " + OP_MODES[target] + " mode… this can take a minute (the router may restart).", "warn");
    await sleep(5000);
    try { await poll_once(); } catch (e) { /* router may be restarting */ }
    if (S.wan.opms_wan_mode === target) toast(OP_MODES[target] + " mode active ✓", "ok");
  };

  // ── ARP proxy ──
  // The old firmware had this as the hidden goform ARP_PROXY_SWITCH. On the newer firmware:
  //   zwrt_router.api / router_set_arp_proxy { arp_proxy_enable: 1 | 0 }   (a number, not text)
  // The method name is in the list that open-u60-pro recorded on a ZTE U60 Pro; the parameter
  // was found by testing on an MC7530 (it is not used by the router's own web UI).
  // The router accepts the call only in a developer session.
  // Current state: uci zwrt_router / section "network" / arp_proxy_enable ("1" | "0"); the option
  // is missing until the switch has been used once.
  async function update_arp_state() {
    var state = null;
    try {
      var r = await ubus({ service: "uci", method: "get", params: { config: "zwrt_router", section: "network" } }, { quiet: true });
      var v = r.success && r.data && r.data.values;
      if (v) {
        var raw = v.arp_proxy_enable !== undefined ? v.arp_proxy_enable : v.network && v.network.arp_proxy_enable;
        state = raw === undefined ? "off (never set)" : String(raw) === "1" ? "on" : "off";
      }
    } catch (e) { /* leave unknown */ }
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
      if (r.accessDenied) { // not in a developer session yet
        var h = saved_hash() || (await ask_pw_hash());
        if (!h) return;
        if (!(await developer_option_login(h))) { toast("Developer login failed — ARP proxy not changed.", "error"); return; }
        r = await ubus(call);
      }
    } catch (e) {
      toast("ARP proxy: no answer from the router (" + e.message + ")", "error");
      return;
    }
    console.log("[ZTE] router_set_arp_proxy(" + (enable ? 1 : 0) + ") ←", JSON.stringify(r));
    if (!r.success) {
      toast(r.accessDenied ? "The router refused the ARP proxy call, even in a developer session." : "ARP proxy change failed (" + (r.error || "?") + ")", "error");
      return;
    }
    await sleep(1000);
    var now = await update_arp_state();
    if (now === (enable ? "on" : "off")) toast("ARP proxy is " + word + " ✓\nIf nothing changes on your network, reboot the router.", "ok", 8000);
    else toast("The router accepted the call, but the setting reads “" + (now || "unknown") + "”.", "warn", 8000);
  };

  // ── GPS ──
  // Exactly what the router's own Device details page does (service_rpc.js). Which call that is
  // depends on the firmware:
  //   MC7530:  zwrt_gnss / get_location_info {}             →  gnss_lat, gnss_lon
  //   G5TC:    uci get zwrt_zte_topsw_gnss_gen / INFO      →  LAT, LON
  //            (it has no zwrt_gnss service: the call above answers "Object not found")
  // One read shortly after start and one each time you press "🛰 Refresh position".
  // No background search and no guessed calls.
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
  // two plain numbers, and not the 0/0 some firmware reports for "no position"
  function gps_ok(lat, lon) {
    var la = gps_num(lat), lo = gps_num(lon);
    return la !== null && lo !== null && !(la === 0 && lo === 0);
  }

  // Fallback, used only if the router returns the position in a non-numeric (encoded) form:
  // ask the router's own page code (its RequireJS "service" module) for the decoded values.
  function router_service() {
    try {
      var rq = window.requirejs || window.require;
      var defs = rq && rq.s && rq.s.contexts && rq.s.contexts._ && rq.s.contexts._.defined;
      if (!defs) return null;
      for (var k in defs) {
        if (defs[k] && typeof defs[k].getDeviceInfo === "function") return defs[k];
      }
    } catch (e) { /* ignore */ }
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

  // For firmware without the zwrt_gnss service. Returns
  //   { lat, lon, src }        a position
  //   { nofix: true }          the router keeps a position record, but it is empty
  //   null                     no position source at all → this router has no GPS
  async function gps_alt_position() {
    var has_record = false;
    try {
      var v = uci_values(await ubusRetry(GPS_UCI, { quiet: true }));
      if (v && (v.LAT !== undefined || v.LON !== undefined)) {
        has_record = true;
        if (gps_ok(v.LAT, v.LON)) return { lat: v.LAT, lon: v.LON, src: "uci zwrt_zte_topsw_gnss_gen" };
      }
    } catch (e) { /* try the page */ }
    // last resort: what the router's own page code reports (its Device details page)
    var info = await router_device_info();
    if (info && gps_ok(info.lat, info.lon)) return { lat: info.lat, lon: info.lon, src: "the router's own page" };
    return has_record ? { nofix: true } : null;
  }

  // Every answer is also kept in S.gps, and a position seen once is kept as the last
  // known one (S.gps_last), so the GNSS section can tell "has GPS" from "not available".
  function render_gps(lat, lon, msg) {
    ztoggle("zte_dev_gps_wrap", true);
    if (msg && S.gps_last) { // no position now, but there was one earlier in this session
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
        // no zwrt_gnss service: either a firmware that keeps the position elsewhere, or no GPS
        var alt = await gps_alt_position();
        if (alt && !alt.nofix) {
          console.log("[ZTE] GPS: no zwrt_gnss service — position read from " + alt.src);
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
        console.log("[ZTE] GPS: zwrt_gnss.get_location_info", why);
        render_gps(null, null, why);
        say("GPS " + why, "error");
        return;
      }
      var d = r.data || {};
      if (!S.gps_keys_logged) {
        S.gps_keys_logged = true;
        console.log("[ZTE] GPS fields returned by the router:", Object.keys(d).join(", ") || "(none)");
      }
      var lat = d.gnss_lat, lon = d.gnss_lon;
      var la = gps_num(lat), lo = gps_num(lon);
      if (la === null && !gps_empty(lat)) {
        // present but not a plain number → let the router's own code decode it
        var info = await router_device_info();
        if (info && gps_num(info.lat) !== null && gps_num(info.lon) !== null) {
          lat = info.lat; lon = info.lon; la = gps_num(lat); lo = gps_num(lon);
        } else {
          var sv = String(lat);
          console.log("[ZTE] GPS: position is encoded — length " + sv.length + ", " +
            (/^[0-9a-f]+$/i.test(sv) ? "hex" : /^[A-Za-z0-9+\/=]+$/.test(sv) ? "base64-like" : "other format"));
          S.gps = { state: "encoded" }; // only an encrypted value the panel could not decode
          render_gps(null, null, "encoded by the router (cannot decode)");
          say("The router returns the position in an encoded form — tell me what the console (F12) line '[ZTE] GPS:' says.", "warn");
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
      S.gps_checked = true;
      if (typeof render_gnss === "function") render_gnss();
    }
  }
  window.zte_gps_refresh = function () { return update_gps(true); };

  // ─────────────────────────────────────────────
  //  ODU ANTENNA, GPS
  //  Read with "uci get" (read only), found on an MC7530:
  //   zte_nwinfo / odu_as_mode     antenna selection: as_mode
  //   zte_nwinfo / odu_as_enable   as_switch
  //  The antenna selection is set the way the router's own Developer options page does it:
  //   zte_nwinfo_api / nwinfo_set_odu_as_mode { odu_as_mode: "auto" | "front_directional" | "rear_directional" | "omni" }
  //  These are read with the slow poll (every CFG.slowPollEvery seconds), not every second.
  // ─────────────────────────────────────────────
  var UCI_ANT = { service: "uci", method: "get", params: { config: "zte_nwinfo", section: "odu_as_mode" } };
  var UCI_ANT_EN = { service: "uci", method: "get", params: { config: "zte_nwinfo", section: "odu_as_enable" } };

  function uci_values(r) {
    var v = r && r.success && r.data && r.data.values;
    return v && typeof v === "object" ? v : null;
  }

  // ── ODU antenna selection ──
  // The options and their names come from the router itself, so another model shows what its
  // own firmware offers:
  //   options: the <select data-bind="value: as_mode"> of its Developer options page
  //            (/tmpl/auth/adm/developer_options.html) → value + data-trans key
  //   names:   the page's own translations ($.i18n.prop), else its Messages_<lang>.properties
  //   Front / Rear: taken from the value the router sends (front_directional → Front). On an
  //            MC7530 the firmware's names alone hide this: "Directional Antenna" is
  //            front_directional, "Directional Wide Beam Antenna" is rear_directional.
  // If the page or the names cannot be read, the built-in list below (MC7530) is used.
  var ANT_BUILTIN = [
    { v: "auto", key: "ant_select_mode_auto", name: "Automatic switching" },
    { v: "front_directional", key: "ant_select_mode_front_directional", name: "Directional Antenna" },
    { v: "rear_directional", key: "ant_select_mode_rear_directional", name: "Directional Wide Beam Antenna" },
    { v: "omni", key: "ant_select_mode_rear_omni", name: "Omnidirectional Antenna" },
  ];
  var ANT_MODES = ANT_BUILTIN.slice();
  var ANT_SRC = { list: "built-in (MC7530)", names: "built-in" };

  // Position from the value the router uses: "front_directional" → "Front"
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
      if (window.$ && $.i18n && typeof $.i18n.prop === "function") {
        var t = $.i18n.prop(key);
        if (t && t !== key && !/^\[.*\]$/.test(t)) return String(t);
      }
    } catch (e) { /* ignore */ }
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
    } catch (e) { /* use the built-in list */ }
    if (opts.length) { ANT_SRC.list = "router UI (developer_options)"; S.ant_has_ui = true; }
    else { opts = ANT_BUILTIN.map(function (x) { return { v: x.v, key: x.key, name: "" }; }); S.ant_has_ui = false; }

    // names: the page's own translations first, then its language file, then built-in
    var props = null, fromPage = 0, fromFile = 0;
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i], t = o.key ? page_i18n(o.key) : null;
      if (t) { o.name = t; fromPage++; continue; }
      if (props === null) {
        props = {};
        try {
          var lang = (performance.getEntriesByType("resource") || []).map(function (e) { return e.name; })
            .filter(function (u) { return /Messages_[\w-]+\.properties/i.test(u); })[0] || "/i18n/Messages_en.properties";
          var lr = await fetch(lang, { cache: "no-store" });
          if (lr.ok) props = parse_properties(await lr.text());
        } catch (e) { /* ignore */ }
      }
      if (o.key && props[o.key]) { o.name = props[o.key]; fromFile++; continue; }
      var b = ANT_BUILTIN.filter(function (x) { return x.v === o.v; })[0];
      o.name = b ? b.name : o.v;
    }
    ANT_SRC.names = fromPage ? "router translations" : fromFile ? "router language file" : "built-in";
    ANT_MODES = opts;
    fill_ant_select();
    console.log("[ZTE] antenna options: " + ANT_MODES.map(function (x) { return x.v + " = " + ant_text(x); }).join(" | ") + " · list: " + ANT_SRC.list + " · names: " + ANT_SRC.names);
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
  // The setting exists only on some models (ODU-based). Proof: the router's own developer page
  // offers the control, OR odu_as_mode holds a real value. A literal "null"/empty (as an
  // MC8532B returns) means the field is a stub and the model does not have it.
  function ant_real_value(a) {
    return !!(a && a.as_mode && a.as_mode !== "null" && String(a.as_mode).trim() !== "");
  }
  function ant_supported() {
    return S.ant_has_ui === true || ant_real_value(S.ant);
  }

  function render_antenna() {
    // hide the whole section on a router that does not have this setting (latched once supported)
    if (ant_supported()) S.ant_supported = true;
    ztoggle("zte_ant_sec", S.ant_supported === true);
    if (S.ant_supported !== true) return;
    var a = S.ant || {};
    var cur = a.as_mode || "";
    var sel = zel("zte_ant_sel");
    // a router without this setting: say so instead of showing an empty control
    if (!S.ant && S.ant_err) {
      if (sel) sel.disabled = true;
      zhtml("zte_ant_cur", '<span style="color:#78909C;font-weight:400">not available on this router (uci zte_nwinfo / odu_as_mode: ' + esc(S.ant_err) + ")</span>");
      zset("zte_ant_sw", "—");
      return;
    }
    if (sel) sel.disabled = false;
    // never change the dropdown under the mouse, or while a change is being applied
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
    var cur = (S.ant && S.ant.as_mode) || "";
    var sel = zel("zte_ant_sel");
    function back() { if (sel) sel.value = cur || "auto"; if (sel) sel.blur(); }
    if (!v || v === cur) { back(); return; }
    if (!confirm("Antenna selection → " + ant_label(v) + " (" + v + ")?\n\n" +
      "• ZTE says: this setting is meant for debugging. A different antenna changes the signal; in normal use choose Automatic switching.\n" +
      "• It may need a developer session: the panel asks for the router password if none is saved.\n" +
      "• The connection can drop for a moment while the ODU switches.")) { back(); return; }
    S.ant_busy = true;
    var call = { service: "zte_nwinfo_api", method: "nwinfo_set_odu_as_mode", params: { odu_as_mode: v } };
    try {
      var r = await ubusRetry(call, { quiet: true }, 3);
      if (r.accessDenied) { // not in a developer session yet
        var h = saved_hash() || (await ask_pw_hash());
        if (!h) { back(); return; }
        if (!(await developer_option_login(h))) { toast("Developer login failed — antenna selection not changed.", "error"); back(); return; }
        r = await ubus(call);
      }
      console.log("[ZTE] nwinfo_set_odu_as_mode(" + v + ") ←", JSON.stringify(r));
      if (!r.success) {
        toast(r.accessDenied ? "The router refused the antenna call, even in a developer session." : "Antenna change failed (" + (r.error || "?") + ")", "error");
        back();
        return;
      }
      await sleep(1500);
      S.ant_busy = false;
      var now = await read_antenna();
      if (now === v) toast("Antenna selection: " + ant_label(v) + " ✓", "ok");
      else toast("The router accepted the call, but the setting reads “" + (now || "unknown") + "”.", "warn", 8000);
    } catch (e) {
      toast("Antenna selection: no answer from the router (" + e.message + ")", "error");
      back();
    } finally {
      S.ant_busy = false;
      render_antenna();
    }
  };
  window.zte_antenna_refresh = function () { return read_antenna(); };

  // ─────────────────────────────────────────────
  //  HIDDEN SETTINGS: session timeout (no page in the router's web UI) and temperature control
  //  (the router's Developer options page)
  //   session timeout: zwrt_web / web_login_timeout_period_get -> { login_timeout_period }
  //                    zwrt_web / web_login_timeout_period_set { login_timeout_period: <number> }
  //                    (the value must be a NUMBER, not a string)
  //   thermal control: zwrt_bsp.thermal / get_policy -> { current_policy: 0|1 }
  //                    zwrt_bsp.thermal / set_policy { name: 19, action: 0|1 }  (action = the new policy)
  //  Each is shown only if the router answers its getter; tested on an MC7530.
  // ─────────────────────────────────────────────
  var THERMAL_POLICY_NAME = 19; // fixed policy id the MC7530 web code uses for set_policy

  // the router's own wording for a setting, so other models show their own labels:
  // the page's live translations first, then its language file, then the built-in fallback
  var ROUTER_PROPS = null;
  async function router_props() {
    if (ROUTER_PROPS) return ROUTER_PROPS;
    ROUTER_PROPS = {};
    try {
      var lang = (performance.getEntriesByType("resource") || []).map(function (e) { return e.name; })
        .filter(function (u) { return /Messages_[\w-]+\.properties/i.test(u); })[0] || "/i18n/Messages_en.properties";
      var r = await fetch(lang, { cache: "no-store" });
      if (r.ok) ROUTER_PROPS = parse_properties(await r.text());
    } catch (e) { /* fall back to the built-in text */ }
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
    // timeout
    if (r[0].success && r[0].data && r[0].data.login_timeout_period !== undefined) {
      S.login_timeout = parseInt(r[0].data.login_timeout_period, 10);
      S.login_timeout_ok = true;
    } else if (!r[0].accessDenied) { S.login_timeout_ok = false; }
    // thermal
    if (r[1].success && r[1].data && r[1].data.current_policy !== undefined) {
      S.thermal_policy = parseInt(r[1].data.current_policy, 10);
      S.thermal_ok = true;
    } else if (!r[1].accessDenied) { S.thermal_ok = false; }
    if (S.thermal_ok && !S.thermal_label) {
      // "Temperature Control" + its protection note, taken from the router (keys from the MC7530 UI)
      S.thermal_label = await router_str("tc_settings_switch", "Temperature control");
      S.thermal_info = await router_str("thermal_switch_info",
        "Protects the device by throttling when it gets too hot. Keep it ON. If turned off, it comes back on after a reboot.");
    }
    render_sys_settings();
  }

  function fmt_timeout(sec) {
    if (!(sec > 0)) return "—";
    if (sec % 3600 === 0) return (sec / 3600) + " h";
    if (sec % 60 === 0) return (sec / 60) + " min";
    return sec + " s";
  }

  function render_sys_settings() {
    var any = S.login_timeout_ok || S.thermal_ok;
    ztoggle("zte_sys_sec", !!any);
    ztoggle("zte_sys_timeout_row", !!S.login_timeout_ok);
    if (S.login_timeout_ok) zhtml("zte_sys_timeout", (S.login_timeout > 0 ? esc(fmt_timeout(S.login_timeout)) +
      ' <span style="font-size:10px;color:#78909C;font-weight:400">(' + S.login_timeout + " s)</span>" : "—"));
    ztoggle("zte_sys_thermal_row", !!S.thermal_ok);
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

  // runs a setter, handling a developer-session prompt the same way the antenna control does
  async function sys_set(call) {
    var r = await ubusRetry(call, { quiet: true }, 3);
    if (r.accessDenied) {
      var h = saved_hash() || (await ask_pw_hash());
      if (!h) return { cancelled: true };
      if (!(await developer_option_login(h))) { toast("Developer login failed.", "error"); return { denied: true }; }
      r = await ubus(call);
    }
    return r;
  }

  window.zte_set_login_timeout = async function () {
    var cur = S.login_timeout > 0 ? S.login_timeout : 600;
    var inp = prompt("Session timeout — seconds of inactivity before the router logs you out.\n" +
      "Now: " + cur + " s. New value in seconds (60\u201386400):", String(cur));
    if (inp === null) return;
    var n = parseInt(String(inp).trim(), 10);
    if (!(n >= 60 && n <= 86400)) { toast("Enter a number of seconds between 60 and 86400.", "warn"); return; }
    var r = await sys_set({ service: "zwrt_web", method: "web_login_timeout_period_set", params: { login_timeout_period: n } });
    if (r.cancelled) return;
    if (!r || !r.success) { toast("Could not change the session timeout" + (r && r.error ? " (" + r.error + ")" : "") + ".", "error"); return; }
    await read_sys_settings();
    toast("Session timeout set to " + fmt_timeout(S.login_timeout) + " \u2713", "ok", 6000);
  };

  window.zte_thermal = async function (on) {
    if (!on) {
      var info = S.thermal_info || "With it off the device may run hotter. It comes back on after a reboot.";
      if (!confirm("Turn " + (S.thermal_label || "temperature control") + " OFF?\n\n" + info +
        "\n\nIt may ask for the router password (developer session).")) return;
    }
    var r = await sys_set({ service: "zwrt_bsp.thermal", method: "set_policy", params: { name: THERMAL_POLICY_NAME, action: on ? 1 : 0 } });
    if (r.cancelled) return;
    if (!r || !r.success) { toast("Thermal control change failed" + (r && r.error ? " (" + r.error + ")" : "") + ".", "error"); return; }
    await sleep(1200);
    await read_sys_settings();
    if (S.thermal_policy === (on ? 1 : 0)) toast("Thermal control is " + (on ? "ON" : "OFF") + " \u2713", on ? "ok" : "warn", 6000);
    else toast("The router accepted the call, but thermal control reads policy " + S.thermal_policy + ".", "warn", 8000);
  };

  // ── GPS ──
  // Only two things are shown: whether the router has GPS, and its position (as in ng1.27).
  // The GNSS details in uci zwrt_zte_gnss (fix, satellites, time, A-GNSS) are not shown: on an
  // MC7530 they stayed at 0 / no fix even while the router returned a position.
  // That config is read once (at start and on "Check again"), only to tell "no position yet"
  // from "not available".
  // Does this router have GPS? The reliable signal is whether a position source answers:
  // zwrt_gnss.get_location_info, or — on firmware without that service (G5TC) — the position
  // record in uci zwrt_zte_topsw_gnss_gen. The uci zwrt_zte_gnss config is NOT used: an MC8532B
  // keeps those sections but has no GPS, and get_location_info returns "Object not found".
  //   yes:  it returned coordinates (now or earlier this session; the MC7530 sends them
  //         encrypted and its own page decodes them — still a position)
  //   open: the call works but gave no coordinates yet (no fix), or only an undecodable value
  //   no:   the service is absent (Object/Method not found) and there is no other position
  //         source either → not available
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
    zhtml("zte_gnss_status", '<span style="color:' + st.col + '">' + esc(st.txt) + "</span>" +
      (st.why ? '<div style="font-size:9px;color:#B0BEC5;font-weight:400;">' + esc(st.why) + "</div>" : ""));
    ztoggle("zte_gnss_data", st.has === "yes" || st.has === "open");
    zset("zte_gnss_refresh_btn", st.has === "no" ? "🛰 Check again" : "🛰 Refresh position");
  }


  // ── Traffic counter reset ──
  // From the router's own web UI (service_rpc.js):
  //   zwrt_data / set_wwandst_calibmonth {source_module, cid:1, type, value}  — "correct" this month's usage
  //       type 2 = data, type 1 = time (same mapping as get_wwandst_monthlimit)
  //   zwrt_data / get|set_wwandst_clearday {source_module, cid:1, enable, clearday} — automatic monthly reset day
  // There is no "clear now" call, so a reset = correcting the month's data and time to 0.
  // Session counters restart on every reconnect; all-time totals cannot be reset.
  window.zte_reset_traffic = async function () {
    if (!confirm("Reset this month's traffic counters to 0?\n\n(Sets the monthly data and connected time to 0 using the router's own usage correction.)"))
      return;
    var mod = await rpc_module_name();
    var before = Number(S.traffic.month_rx_bytes) + Number(S.traffic.month_tx_bytes) || 0;
    var res = await ubusRetry([
      { service: "zwrt_data", method: "set_wwandst_calibmonth", params: { source_module: mod, cid: 1, type: 2, value: "0" } },
      { service: "zwrt_data", method: "set_wwandst_calibmonth", params: { source_module: mod, cid: 1, type: 1, value: "0" } },
    ]);
    console.log("[ZTE] set_wwandst_calibmonth ←", JSON.stringify(res));
    if (!res[0].success && !res[1].success) {
      toast("Counter reset failed (" + (res[0].error || "?") + ")", "error");
      return;
    }
    await sleep(2000);
    await poll_once();
    var after = Number(S.traffic.month_rx_bytes) + Number(S.traffic.month_tx_bytes) || 0;
    toast(after < before || after === 0 ? "Monthly counters reset ✓" :
      "Router accepted the correction, but the monthly counter has not dropped yet — check again in a moment.",
      after < before || after === 0 ? "ok" : "warn");
  };

  window.zte_traffic_clearday = async function () {
    var mod = await rpc_module_name();
    var r = await ubusRetry({ service: "zwrt_data", method: "get_wwandst_clearday", params: { source_module: mod, cid: 1 } });
    var cur = (r.success && r.data) || {};
    console.log("[ZTE] get_wwandst_clearday ←", JSON.stringify(cur));
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
    await run_action(day > 0 ? "Auto reset on day " + day : "Auto reset disabled", function () {
      return ubusRetry({ service: "zwrt_data", method: "set_wwandst_clearday", params: params });
    });
  };

  // helper: show any ubus answer as a table or JSON
  function render_any(title, data) {
    if (data && typeof data === "object" && !Array.isArray(data) &&
      Object.keys(data).every(function (k) { return data[k] === null || typeof data[k] !== "object"; }))
      return info_table(title, data, { rawKeys: true });
    return '<div class="zte_sec"><div class="zte_sec_title">' + esc(title) + "</div>" +
      '<pre style="white-space:pre-wrap;word-break:break-all;font-size:10px;margin:0;user-select:text;">' +
      esc(JSON.stringify(data, null, 2)) + "</pre></div>";
  }
  // ── APN ──
  // Read:   zwrt_apn_object get_apn_mode / get_apn_at_cid / get_manu_apn_list / get_auto_apn_list
  // Switch (exactly as the router's own APN page does, service_rpc.js):
  //   automatic:       set_apn_mode {apn_mode:0}
  //   manual profile:  set_apn_mode {apn_mode:1}  +  enable_manu_apn_id {profileId}
  // Creating / editing profiles is left to the router's own APN page.
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

  async function apn_apply(label, calls) {
    var res = await ubusRetry(calls);
    console.log("[ZTE] APN ←", JSON.stringify(res));
    var bad = res.filter(function (r) { return !r.success; })[0];
    if (bad) {
      toast(label + " failed (" + (bad.error || "?") + ")", "error");
      return false;
    }
    toast(label + " ✓\nThe mobile connection restarts with the new APN…", "ok");
    return true;
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
      return res[i].success ? render_any(c[0], res[i].data) :
        '<div class="zte_sec"><div class="zte_sec_title">' + esc(c[0]) + '</div><div style="color:#78909C;">Not available (' + esc(res[i].error || "") + ")</div></div>";
    }).join(""));

    var note = "\n\nThe mobile connection restarts. If there is no internet afterwards, open 📡 APN again and switch back.";
    ov.querySelector("#zte_apn_auto").onclick = async function () {
      if (!confirm("Switch to the automatic APN?" + note)) return;
      ov.remove();
      await apn_apply("Automatic APN", [{ service: "zwrt_apn_object", method: "set_apn_mode", params: { apn_mode: 0 } }]);
    };
    ov.querySelectorAll("[data-apn-idx]").forEach(function (b) {
      b.onclick = async function () {
        var p = profiles[+b.getAttribute("data-apn-idx")];
        if (!confirm('Switch to the manual APN profile "' + (p.name || "?") + '" (' + (p.apn || "?") + ")?" + note)) return;
        ov.remove();
        await apn_apply('APN → "' + (p.name || p.apn || p.id) + '"', [
          { service: "zwrt_apn_object", method: "set_apn_mode", params: { apn_mode: 1 } },
          { service: "zwrt_apn_object", method: "enable_manu_apn_id", params: { profileId: p.id } },
        ]);
      };
    });
  };

  window.zte_lte_band = async function (bands) {
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
    return send_lte_mask(lte_mask_from_bands(list), "LTE bands B" + list.join("+B"));
  };

  window.zte_lte_band_unlock = async function (skipConfirm) {
    await load_band_caps();
    var all = lte_avail();
    if (!skipConfirm && !confirm("Remove LTE band lock?\n\nLocks to all bands " +
      (lte_from_router() ? "of this router" : "in the panel's built-in list") + ": B" + all.join(", B")))
      return;
    return send_lte_mask(lte_mask_from_bands(all), "LTE band lock removed");
  };

  window.zte_nr_band = async function (bands) {
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
    return send_nr_bands(list, "5G bands n" + list.join("+n"));
  };

  window.zte_nr_band_unlock = async function (skipConfirm) {
    await load_band_caps();
    var sa = nr_avail("sa"), nsa = nr_avail("nsa");
    if (!skipConfirm && !confirm("Remove NR (5G) band lock?\n\nLocks to all bands " +
      (nr_from_router() ? "of this router" : "in the panel's built-in list") + ": n" + nr_avail().join(", n")))
      return;
    await send_nr_bands(sa, "NR band lock removed", nsa);
  };

  window.zte_unlock_all_bands = async function () {
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

  window.zte_lte_cell_lock = async function (reset) {
    if (reset) {
      var cur = S.net.lock_lte_cell;
      if (!cur || cur === "0,0") { toast("No LTE cell lock is active", "info"); return; }
      if (!confirm("Remove LTE cell lock (" + cur + ")?")) return;
      if (await run_action("LTE cell lock removed", function () { return lte_cell_call(0, 0); }))
        toast("LTE cell lock removed." + APPLY_HINT, "info");
      return;
    }
    var def = (S.net.lte_pci || "") + "," + (S.net.lte_action_channel || "");
    var inp = prompt("LTE cell lock — PCI,EARFCN (e.g. 116,3350)\nDefault = current cell", def);
    if (!inp) return;
    var p = inp.split(",").map(function (x) { return x.trim(); });
    if (p.length !== 2 || p.some(function (x) { return x === "" || isNaN(x); })) {
      toast("Invalid input — use PCI,EARFCN", "error");
      return;
    }
    if (+p[0] < 0 || +p[0] > 503) { toast("PCI must be between 0 and 503", "error"); return; }
    if (await run_action("LTE cell lock " + p.join(","), function () { return lte_cell_call(p[0], p[1]); }))
      toast("LTE cell lock set." + APPLY_HINT, "info");
  };

  window.zte_nr_cell_lock = async function (reset) {
    if (reset) {
      var cur = S.net.lock_nr_cell;
      if (!cur || cur === "0,0,0") { toast("No 5G cell lock is active", "info"); return; }
      if (!confirm("Remove 5G cell lock (" + cur + ")?")) return;
      if (await run_action("5G cell lock removed", function () { return nr_cell_call(0, 0, 0); }))
        toast("5G cell lock removed." + APPLY_HINT, "info");
      return;
    }
    var def = (S.net.nr5g_pci || "") + "," + (S.net.nr5g_action_channel || "") + "," + strip_n(S.net.nr5g_action_band);
    var inp = prompt("5G cell lock — PCI,ARFCN,BAND (e.g. 202,639936,78)\nDefault = current cell", def);
    if (!inp) return;
    var p = inp.split(",").map(function (x) { return strip_n(x); });
    if (p.length !== 3 || p.some(function (x) { return x === "" || isNaN(x); })) {
      toast("Invalid input — use PCI,ARFCN,BAND", "error");
      return;
    }
    if (await run_action("5G cell lock " + p.join(","), function () { return nr_cell_call(p[0], p[1], p[2]); }))
      toast("5G cell lock set." + APPLY_HINT, "info");
  };

  // ─────────────────────────────────────────────
  //  WIFI SETTINGS (ubus: uci get wireless / zwrt_wlan.set)
  // ─────────────────────────────────────────────
  async function set_wifi_param(param, label, validator, formatter, extraCb, disclaimer) {
    formatter = formatter || function (v) { return v; };
    extraCb = extraCb || function () { return ""; };
    var res = await ubusRetry([
      { service: "uci", method: "get", params: { config: "wireless", section: "wifi0" } },
      { service: "uci", method: "get", params: { config: "wireless", section: "wifi1" } },
    ]);
    var v24 = (res[0].data && res[0].data.values) || {};
    var v5 = (res[1].data && res[1].data.values) || {};
    var c24 = v24[param] || "unknown";
    var c5 = v5[param] || "unknown";
    while (true) {
      var input = prompt(
        "WiFi " + label + " for 2.4 GHz and 5 GHz (value1,value2 — or one value for both)\n" +
          "Current:\n  2.4 GHz: " + formatter(c24) + extraCb(v24) + "\n  5 GHz:   " + formatter(c5) + extraCb(v5) +
          (disclaimer ? "\n\n" + disclaimer : ""),
        c24 + "," + c5,
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
    );
  };

  window.zte_wifi_country = function () {
    return set_wifi_param(
      "country", "Country",
      function (v) { return /^[A-Za-z]{2}$/.test(v); },
      function (v) { return String(v).toUpperCase(); },
      null,
      "⚠️ Wrong settings may be illegal in your country or cause connectivity issues.",
    );
  };

  // ─────────────────────────────────────────────
  //  INFO MODAL
  // ─────────────────────────────────────────────
  function show_modal(title, html) {
    var old = zel("zte_modal");
    if (old) old.remove();
    var ov = document.createElement("div");
    ov.id = "zte_modal";
    ov.innerHTML =
      '<div class="zte_modal_box">' +
      '<div class="zte_modal_hdr"><span>' + esc(title) + '</span><button class="zte_icon_btn" id="zte_modal_x">×</button></div>' +
      '<div class="zte_modal_body">' + html + "</div></div>";
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    zel("zte_modal_x").onclick = function () { ov.remove(); };
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

  // A router without WiFi (an outdoor unit such as the MC7530) keeps the uci "wireless" config,
  // but its WiFi service is missing: zwrt_wlan answers "Object not found". The WiFi section is
  // hidden only on that answer; any other answer (or none) keeps it visible.
  async function check_wifi() {
    var r;
    try { r = await ubusRetry({ service: "zwrt_wlan", method: "report", params: {} }, { quiet: true }, 3); } catch (e) { r = null; }
    S.wifi_absent = !!(r && !r.success && !r.accessDenied && /not\s*found/i.test(String(r.error || "")));
    ztoggle("zte_wifi_sec", !S.wifi_absent);
    console.log("[ZTE] WiFi: zwrt_wlan.report → " + (r ? (r.success ? "ok" : r.error) : "no answer") + (S.wifi_absent ? " — section hidden" : ""));
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

  // Raw dump of every netinfo field — use it to find fields not shown in the panel
  window.zte_dump_netinfo = function () {
    var ov = show_modal(
      "Raw netinfo (zte_nwinfo_api.nwinfo_get_netinfo)",
      '<button class="zte_btn ok" id="zte_dump_copy" style="width:100%;margin-bottom:8px;">📋 Copy as JSON</button>' +
        info_table("All fields", S.net, { rawKeys: true }),
    );
    ov.querySelector("#zte_dump_copy").onclick = function () {
      copy_text(JSON.stringify(S.net, null, 2), "netinfo copied");
    };
  };

  // Generic ubus call — for features this panel does not wrap yet
  window.zte_custom_ubus = async function () {
    var service = prompt("ubus service (e.g. zte_nwinfo_api):", "zte_nwinfo_api");
    if (!service) return;
    var method = prompt("ubus method (e.g. nwinfo_get_netinfo):", "nwinfo_get_netinfo");
    if (!method) return;
    var ptxt = prompt("params as JSON:", "{}");
    if (ptxt === null) return;
    var params;
    try { params = JSON.parse(ptxt || "{}"); } catch (e) { toast("Invalid JSON", "error"); return; }
    var r = await ubus({ service: service.trim(), method: method.trim(), params: params });
    show_modal(
      service + "." + method,
      '<div class="zte_sec"><div class="zte_sec_title">' + (r.success ? "Success" : "Failed: " + esc(r.error || "")) + "</div>" +
        '<pre style="white-space:pre-wrap;word-break:break-all;font-size:11px;margin:0;user-select:text;">' +
        esc(JSON.stringify(r.data, null, 2)) + "</pre></div>",
    );
  };

  // ─────────────────────────────────────────────
  //  MISC ACTIONS
  // ─────────────────────────────────────────────
  function copy_text(text, msg) {
    if (navigator.clipboard && window.isSecureContext)
      navigator.clipboard.writeText(text).then(function () { toast(msg || "Copied!", "ok"); },
        function () { prompt("Copy:", text); });
    else prompt("Copy:", text);
  }

  window.zte_test_connection = async function () {
    var s = Date.now();
    try {
      var ok = await check_login();
      toast("Router OK — " + (Date.now() - s) + " ms" + (ok ? "" : " (not logged in)"), ok ? "ok" : "warn");
    } catch (e) {
      toast("Router unreachable!", "error");
    }
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
    lines.push("Cell ID: " + (d.cell_id || "N/A") + " | 5G Cell ID: " + (d.nr5g_cell_id || "N/A"));
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

  // ─────────────────────────────────────────────
  //  HIDDEN MENUS (the router's own web UI)
  //  The web UI keeps more than it shows:
  //   1. left-menu entries that are hidden (class "hide", or switched off by the UI itself),
  //   2. parts of a page hidden with class "hide",
  //   3. pages that have an address (#hash) but no menu entry at all.
  //  With "Hidden Menus" on, 1 and 2 are shown with a dashed outline; "Hidden pages" lists 3.
  //  Only what the UI can open in the current operation mode is shown: its page list comes
  //  from the UI's own modules (config/menu and config/<device>/menu_*).
  //  Nothing here talks to the router — it only changes what the page displays.
  // ─────────────────────────────────────────────
  var HIDDEN_KEY = "ZtePanelHiddenMenus"; // localStorage: "1" = on
  var HIDDEN_SKIP = ["#login", "#home", "#change_password", "#privacy_policy", "#developer_options_login", "#check_license"];

  function hidden_on() {
    try { return localStorage.getItem(HIDDEN_KEY) === "1"; } catch (e) { return false; }
  }

  // The web UI's modules (require.js registry), or null on a page built differently
  function ui_modules() {
    try {
      var rq = window.requirejs || window.require;
      return (rq && rq.s && rq.s.contexts && rq.s.contexts._ && rq.s.contexts._.defined) || null;
    } catch (e) {
      return null;
    }
  }

  // Can the web UI open this address right now (in this operation mode, logged in)?
  function ui_can_open(hash) {
    try {
      var mods = ui_modules(), menu = mods && mods["config/menu"];
      if (!menu || typeof menu.findMenu !== "function") return null; // unknown
      return menu.findMenu(hash).length > 0;
    } catch (e) {
      return null;
    }
  }

  // Every page the web UI can open in the current operation mode: [{ hash, path }]
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

  // A hidden menu entry is worth showing only if one of its links leads somewhere
  function menu_entry_opens(li) {
    var links = li.querySelectorAll("a[href^='#']"), any = false, known = false;
    for (var i = 0; i < links.length; i++) {
      var h = links[i].getAttribute("href");
      if (h.length < 2) continue;
      var can = ui_can_open(h);
      if (can !== null) known = true;
      if (can) any = true;
    }
    return any || !known; // page list unknown → show it, like the old panel did
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
    // 1. left menu (the UI's own logic may hide an entry again, so entries shown before are re-checked)
    document.querySelectorAll("#leftMenu li, #sidebarMenu li").forEach(function (li) {
      if (in_panel(li)) return;
      var byClass = li.classList.contains("hide"), byStyle = li.style.display === "none";
      if (!byClass && !byStyle) return;
      if (!menu_entry_opens(li)) return;
      reveal(li, byClass ? "class" : "style");
    });
    // 2. page content (never dialogs or alerts: those are hidden for a reason)
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
    b.className = "zte_btn" + (on ? " ok" : "");
    b.textContent = on ? "👁 Hidden Menus: ON" : "👁 Hidden Menus: OFF";
  }

  window.zte_hidden_toggle = function () {
    var on = !hidden_on();
    try { if (on) localStorage.setItem(HIDDEN_KEY, "1"); else localStorage.removeItem(HIDDEN_KEY); } catch (e) { /* ignore */ }
    update_hidden_btn();
    if (on) {
      var n = apply_hidden_menus();
      toast("Hidden menus: ON" + (n ? " — " + n + " hidden item(s) shown on this page (dashed outline)" : " — nothing hidden on this page"), "ok");
    } else {
      undo_hidden_menus();
      toast("Hidden menus: OFF", "info");
    }
  };

  // Pages the web UI can open but has no menu entry for
  window.zte_hidden_pages = function () {
    var pages = ui_pages().filter(function (p) {
      if (HIDDEN_SKIP.indexOf(p.hash) !== -1) return false;
      var links = document.querySelectorAll('a[href="' + p.hash + '"]');
      for (var i = 0; i < links.length; i++) if (!in_panel(links[i])) return false;
      return true;
    });
    var html = pages.length
      ? '<div class="zte_sec" style="font-size:11px;color:#78909C;line-height:1.5;">Pages the router\'s web interface has, but does not link from its menu ' +
        "(in the current operation mode). Some belong to features this model does not have and stay empty; " +
        "some ask for a developer login or a licence first.</div>" +
        '<div class="zte_sec"><div class="zte_btn_grid">' +
        pages.map(function (p) {
          return '<button class="zte_btn" data-hash="' + esc(p.hash) + '" title="' + esc(p.path) + '">' + esc(p.hash.slice(1)) + "</button>";
        }).join("") + "</div></div>"
      : '<div class="zte_sec" style="font-size:12px;color:#78909C;">No hidden pages found — the page list of the router\'s web interface could not be read on this firmware.</div>';
    var ov = show_modal("Hidden pages", html);
    ov.querySelectorAll("button[data-hash]").forEach(function (b) {
      b.onclick = function () { ov.remove(); location.hash = b.getAttribute("data-hash"); };
    });
  };

  function start_hidden_menus() {
    update_hidden_btn();
    // The web UI redraws its page on every address change, and its menu logic can hide entries again
    window.addEventListener("hashchange", function () {
      setTimeout(apply_hidden_menus, 600);
      setTimeout(apply_hidden_menus, 1500);
    });
    setInterval(apply_hidden_menus, 2000);
    apply_hidden_menus();
  }

  // ─────────────────────────────────────────────
  //  FORMAT HELPERS
  // ─────────────────────────────────────────────
  function fmt_bytes(v) {
    var b = Number(v);
    if (!v || isNaN(b)) return "—";
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

  // ─────────────────────────────────────────────
  //  POLLING
  // ─────────────────────────────────────────────
  // Signal and speeds change every second; temperature, CPU/memory and WAN status do not.
  // Reading those less often keeps the load on the router's (slow) web server low.
  var POLL_FAST = [
    { service: "zte_nwinfo_api", method: "nwinfo_get_netinfo" },
    { service: "zwrt_data", method: "get_wwandst", params: { source_module: "web", cid: 1, type: 4 } },
  ];
  var POLL_SLOW = [
    { service: "zwrt_bsp.thermal", method: "get_cpu_temp" },
    { service: "zwrt_mc.device.manager", method: "get_device_info" },
    { service: "zwrt_router.api", method: "router_get_status" },
    // uci reads for the ODU antenna (see "ODU ANTENNA, GPS")
    UCI_ANT, UCI_ANT_EN,
  ];

  // fastOnly = true reads just the fast group; without it everything is refreshed
  // (the first poll, every CFG.slowPollEvery-th poll, and after every action).
  async function poll_once(fastOnly) {
    try {
      var res = await ubusRetry(fastOnly ? POLL_FAST : POLL_FAST.concat(POLL_SLOW), { quiet: true }, 2);
      if (res[0].success) S.net = res[0].data || {};
      if (res[1].success) S.traffic = res[1].data || {};
      if (!fastOnly) {
        if (res[2].success) S.thermal = res[2].data || {};
        if (res[3].success) S.devinfo = res[3].data || {};
        if (res[4].success) S.wan = res[4].data || {};
        var v;
        if ((v = uci_values(res[5])) && !S.ant_busy) { S.ant = v; S.ant_err = null; }
        else if (!v && res[5] && !res[5].accessDenied) S.ant_err = res[5].error || "no data";
        if ((v = uci_values(res[6]))) S.ant_en = v;
      }

      // Logged out? Some firmware (MC7530) answers netinfo without a login, so that call
      // says nothing: look at the others. check_login() below confirms it before the panel pauses.
      var rest = res.length > 1 ? res.slice(1) : res;
      var denied = rest.some(function (r) { return r.accessDenied; }) && rest.every(function (r) { return !r.success; });
      if (denied) {
        set_dot("error");
        if (!(await check_login())) { S.session_lost = true; S.lost_checks = 0; }
        return;
      }
      stamp(sessionStorage, SEEN_KEY);
      set_dot(res.every(function (r) { return r.success; }) ? "ok" : "warn");
      update_ui();
    } catch (e) {
      set_dot("error");
    }
  }

  // While nobody is logged in, the panel stays out of the router's way: no polling, only one
  // small check every CFG.loginWaitInterval. It never logs in again by itself (a new login
  // would replace the session the router's own page is using), and after a login it waits
  // for the router's page to finish loading before it starts polling again.
  async function wait_for_session() {
    if (await check_login()) {
      await wait_page_settled();
      console.log("[ZTE] session is back — polling resumed");
      if (S.expired_warned) toast("Logged in again — panel resumed", "ok");
      S.session_lost = false;
      S.expired_warned = false;
      S.poll_tick = 0;
      return;
    }
    S.lost_checks++;
    if (S.lost_checks === 2 && !S.expired_warned) {
      S.expired_warned = true;
      console.log("[ZTE] session ended " + Math.round((Date.now() - S.started_at) / 1000) + " s after the panel started");
      toast("Router session ended — log in again on the router page.", "warn");
    }
  }

  async function poll_loop() {
    if (S.session_lost) {
      await wait_for_session();
    } else if (!S.pause_poll) {
      await poll_once(S.poll_tick % CFG.slowPollEvery !== 0);
      S.poll_tick++;
    }
    S.poll_timer = setTimeout(poll_loop, S.session_lost ? CFG.loginWaitInterval : CFG.pollInterval);
  }

  // ─────────────────────────────────────────────
  //  UPDATE UI
  // ─────────────────────────────────────────────
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

  function update_ui() {
    var d = S.net;
    var f = net_flags(d.network_type);
    S.lte = parse_lte_cells(d);
    S.nr = parse_nr_cells(d);
    var lte = f.is_lte ? S.lte : [];
    var nr = f.show_nr ? S.nr : [];

    // ── Network ──
    var nt = d.network_type || "—";
    zset("network_type", nt === "SA" ? "5G SA" : nt === "ENDC" ? "5G NSA (EN-DC)" : nt);
    zset("network_provider_fullname", d.network_provider_fullname || "—");
    var nrSum = f.is_sa || f.is_nsa ? S.nr : [];
    zset("__bandinfo", band_info(lte, nrSum) || "—");
    var bw = 0;
    lte.concat(nrSum).forEach(function (c) { if (c.bandwidth) bw += c.bandwidth; });
    zset("zte_total_bw", bw ? bw + " MHz" : "—");

    ztoggle("lte_ca_active_tr", f.is_lte);
    zhtml("ca_active", lte.length > 1
      ? '<span style="color:#1976D2;font-weight:700">&#10003; ' + lte.length + "× LTE</span>"
      : '<span style="color:#78909C">&#10005;</span>');
    ztoggle("nr_ca_active_tr", f.show_nr);
    zhtml("nr_ca_active", nr.length > 1
      ? '<span style="color:#7B1FA2;font-weight:700">&#10003; ' + nr.length + "× NR (" +
        esc(nr.map(function (c) { return "n" + c.band; }).join(" + ")) + ")</span>"
      : '<span style="color:#78909C">&#10005; (' + esc(nr[0] ? "n" + nr[0].band : "—") + ")</span>");

    var enb = f.is_lte ? split_cell_id(d.cell_id) : null;
    ztoggle("zte_enodeb_row", !!enb);
    if (enb) zhtml("zte_enodeb_val", esc(enb.node) + ' <span style="font-size:10px;color:#78909C;font-weight:400">(0x' +
      enb.node.toString(16).toUpperCase() + ") · sector " + enb.sector + "</span>");
    var gnb = split_cell_id(d.nr5g_cell_id);
    ztoggle("zte_gnodeb_row", !!gnb && (f.is_sa || f.is_nsa));
    if (gnb) zhtml("zte_gnodeb_val", esc(gnb.node) + ' <span style="font-size:10px;color:#78909C;font-weight:400">(0x' +
      gnb.node.toString(16).toUpperCase() + ") · sector " + gnb.sector + "</span>");

    zset("cell_id", d.cell_id || "—");
    ztoggle("cell", !!d.cell_id && f.is_lte);
    zset("nr5g_cell_id", d.nr5g_cell_id || "—");
    ztoggle("5g_cell", !!d.nr5g_cell_id && (f.is_sa || f.is_nsa));
    zset("wan_ipaddr", S.wan.mwan_wanlan1_wan_ipaddr || "—");
    ztoggle("wanipinfo", !!S.wan.mwan_wanlan1_wan_ipaddr);

    var mcc = d.rmcc || d.mcc, mnc = d.rmnc || d.mnc;
    ztoggle("zte_mccmnc_row", !!(mcc && mnc));
    if (mcc && mnc) zset("zte_mccmnc", mcc + "-" + mnc);

    var t = S.thermal && S.thermal.cpuss_temp;
    ztoggle("temperature", t !== undefined && t !== null && t !== "");
    zset("temps", "CPU: " + t + "°C");

    update_session_info();

    // Network mode highlight
    Object.keys(NET_MODES).forEach(function (m) {
      var b = zel("zte_mode_" + m);
      if (b) b.classList.toggle("active", d.net_select === m);
    });

    // Cell locks
    var ll = d.lock_lte_cell && d.lock_lte_cell.trim() !== "" && d.lock_lte_cell !== "0,0";
    var nl = d.lock_nr_cell && d.lock_nr_cell.trim() !== "" && d.lock_nr_cell !== "0,0,0";
    ztoggle("zte_lock_row", ll || nl);
    zhtml("zte_lock_status", '<span style="color:#D32F2F;">' +
      [ll ? "🔒 LTE " + esc(d.lock_lte_cell) : "", nl ? "🔒 5G " + esc(d.lock_nr_cell) : ""].filter(Boolean).join("<br>") + "</span>");
    zhtml("zte_cell_lock_state",
      "LTE: " + (ll ? '<b style="color:#D32F2F">' + esc(d.lock_lte_cell) + "</b>" : '<span style="color:#78909C">unlocked</span>') +
      " &nbsp;·&nbsp; 5G: " + (nl ? '<b style="color:#D32F2F">' + esc(d.lock_nr_cell) + "</b>" : '<span style="color:#78909C">unlocked</span>'));

    // LTE band lock
    var lb = d.lte_band_lock ? lte_bands_from_mask(d.lte_band_lock) : null;
    var allLte = lte_avail().every(function (b) { return lb && lb.indexOf(Number(b)) > -1; });
    zhtml("zte_lte_band_lock_status", !lb || !lb.length || allLte
      ? '<span style="color:#78909C;">Unlocked</span>'
      : '<span style="color:#E65100;">🔒 B' + lb.join(" + B") + "</span>");

    // NR band lock. The router keeps SA and NSA locks separately (NRDC is never set by the panel).
    // Unlocked → just "Unlocked"; locked → only the locked bands. Raw values are in the tooltip.
    var nrFields = nr_lock_fields(d);
    var nrTip = Object.keys(nrFields).map(function (k) { return k + "=" + (nrFields[k] || "(empty)"); }).join("\n");
    var saL = nr_locked_list(d.nr5g_sa_band_lock, "sa"), nsaL = nr_locked_list(d.nr5g_nsa_band_lock, "nsa");
    var nrTxt = "";
    if (saL && nsaL && saL.join() === nsaL.join()) nrTxt = "n" + saL.join(" + n");
    else nrTxt = [saL ? "SA n" + saL.join(" + n") : "", nsaL ? "NSA n" + nsaL.join(" + n") : ""].filter(Boolean).join(" · ");
    zhtml("zte_nr_band_lock_status", nrTxt
      ? '<span style="color:#E65100;" title="' + esc(nrTip) + '">🔒 ' + esc(nrTxt) + "</span>"
      : '<span style="color:#78909C;" title="' + esc(nrTip) + '">Unlocked</span>');
    zset("zte_nr_lock_type", nsa_type());

    // ── Signal cards ──
    zhtml("zte_lte_cards", lte.length
      ? lte.map(function (c, i) { return cell_card("lte", c, i, lte.length); }).join("")
      : '<div style="color:#78909C;font-size:11px;">No LTE cells</div>');
    zhtml("zte_nr_cards", nr.length
      ? nr.map(function (c, i) { return cell_card("nr", c, i, nr.length); }).join("")
      : '<div style="color:#78909C;font-size:11px;">No 5G cells</div>');
    if (nr.length) {
      zhtml("zte_5g_active_bands", '<span style="color:#7B1FA2;font-weight:700;">' +
        esc(nr.map(function (c, i) { return (i === 0 ? "PCell n" : "SCell n") + c.band; }).join(" + ")) + "</span>");
    }
    ztoggle("zte_5g_bands_row", nr.length > 0);

    // ── Neighbour cells (only if the firmware exposes such a field) ──
    var nkeys = Object.keys(d).filter(function (k) { return /ngbr|neighbo|nbr_cell/i.test(k) && d[k]; });
    ztoggle("ngbr_cells", nkeys.length > 0);
    if (nkeys.length) {
      zhtml("ngbr_cell_info_content", nkeys.map(function (k) {
        return '<div style="font-size:10px;color:#78909C;margin-top:4px;">' + esc(k) + "</div>" +
          '<div style="font-size:11px;word-break:break-all;">' + esc(String(d[k])).replace(/;/g, "<br>") + "</div>";
      }).join(""));
    }

    update_traffic();
    update_device();
    // ODU antenna + GPS
    render_antenna();
    render_gnss();
  }

  function update_session_info() {
    var secs = parseInt(S.traffic.real_time, 10) || 0;
    var extra = "";
    if (CFG.ip_cycle_hours > 0 && secs > 0) {
      var cyc = CFG.ip_cycle_hours * 3600;
      var rem = cyc - (secs % cyc);
      var col = rem < 300 ? "#D32F2F" : rem < 900 ? "#E65100" : "#388E3C";
      extra = ' &nbsp;<span style="font-size:10px;color:' + col + ';font-weight:700;" ' +
        'title="Time until next automatic IP reassignment">IP ↻ ' + fmt_time(rem) + "</span>";
    }
    zhtml("zte_session_info", fmt_time(secs) + extra);
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

  function update_device() {
    var dv = S.devinfo, w = S.wan, h = "";
    var t = S.thermal && S.thermal.cpuss_temp;
    h += row("CPU Temp", t !== undefined && t !== "" ? t + " °C" : null);
    if (Array.isArray(dv.cpuinfo)) {
      var loads = dv.cpuinfo.filter(function (c) { return c.name !== "all"; }).map(function (c) {
        return Math.round(100 - (parseFloat(c.idle) || 0)) + "%";
      });
      if (loads.length) h += row("CPU Load (per core)", loads.join(" · "));
    }
    if (dv.meminfo) {
      var tot = parseInt(dv.meminfo.total, 10), av = parseInt(dv.meminfo.avaliable, 10); // sic: firmware spelling
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

  // ─────────────────────────────────────────────
  //  CSS — LIGHT BLUE THEME
  // ─────────────────────────────────────────────
  function inject_css() {
    if (zel("zte_tm_style")) return;
    var s = document.createElement("style");
    s.id = "zte_tm_style";
    s.textContent = [
      "#zte_panel{position:fixed;top:12px;left:12px;z-index:2147483646;width:440px;max-height:94vh;",
      "background:#FFFFFF;color:#37474F;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);",
      'font-family:"Segoe UI",Verdana,sans-serif;font-size:12px;border:1px solid #B0BEC5;display:flex;flex-direction:column;}',
      "#zte_panel *,#zte_modal *{box-sizing:border-box;}",
      ".zte_unhidden{outline:1px dashed #F9A825 !important;outline-offset:-1px;}",
      "#zte_hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;",
      "background:linear-gradient(135deg,#1976D2,#1565C0);border-radius:12px 12px 0 0;cursor:move;user-select:none;flex-shrink:0;}",
      "#zte_hdr h2{margin:0;font-size:13px;font-weight:700;color:#FFFFFF;letter-spacing:.5px;}",
      "#zte_status_dot{width:10px;height:10px;border-radius:50%;background:#78909C;display:inline-block;margin-right:6px;transition:background .5s;}",
      ".zte_hdr_btns{display:flex;gap:4px;}",
      ".zte_icon_btn{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#FFFFFF;cursor:pointer;font-size:13px;",
      "padding:2px 7px;border-radius:5px;line-height:1;font-family:inherit;}",
      ".zte_icon_btn:hover{background:rgba(255,255,255,.3);}",
      "#zte_body{padding:10px;background:#FAFAFA;overflow-y:auto;flex:1;scrollbar-width:thin;scrollbar-color:#90A4AE #E3F2FD;}",
      "#zte_panel .zte_value,#zte_panel td,#zte_panel .zte_label,#zte_modal .zte_value{user-select:text;-webkit-user-select:text;}",
      ".zte_sec{background:#FFFFFF;border-radius:8px;padding:8px 10px;margin-bottom:8px;border:1px solid #E0E0E0;box-shadow:0 1px 3px rgba(0,0,0,.05);}",
      ".zte_sec_title{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#1976D2;margin-bottom:6px;font-weight:700;}",
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
      ".zte_btn.active{background:#1976D2;border-color:#1976D2;color:#fff;font-weight:700;}",
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

  // ─────────────────────────────────────────────
  //  HTML PANEL
  // ─────────────────────────────────────────────
  function btn(label, fn, cls) {
    return '<button class="zte_btn' + (cls ? " " + cls : "") + '" onclick="' + fn + '">' + label + "</button>";
  }
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

    var panel = document.createElement("div");
    panel.id = "zte_panel";
    panel.innerHTML =
      '<div id="zte_hdr">' +
      '<h2><span id="zte_status_dot"></span>ZTE Advanced Router Panel NG</h2>' +
      '<div class="zte_hdr_btns">' +
      '<button class="zte_icon_btn" onclick="window.zte_test_connection()" title="Test connection">⚡</button>' +
      '<button class="zte_icon_btn" id="zte_min_btn" title="Minimize">−</button>' +
      "</div></div>" +
      '<div id="zte_body">' +
      // ── NETWORK ──
      '<div class="zte_sec"><div class="zte_sec_title">Network</div>' +
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
      // ── LTE SIGNAL ──
      '<div class="zte_sec"><div class="zte_sec_title">LTE Signal</div><div id="zte_lte_cards"></div></div>' +
      // ── 5G SIGNAL ──
      '<div class="zte_sec">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
      '<span class="zte_sec_title" style="margin-bottom:0">5G Signal (NR)</span>' +
      '<span id="zte_5g_bands_row" style="font-size:10px;display:none;"><span id="zte_5g_active_bands">—</span></span>' +
      '</div><div id="zte_nr_cards"></div></div>' +
      // ── ODU ANTENNA (shown only if the router has the setting) ──
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
      // ── NEIGHBOUR CELLS (shown only if exposed by firmware) ──
      '<div class="zte_sec" id="ngbr_cells" style="display:none"><div class="zte_sec_title">Neighbor Cells (raw)</div>' +
      '<div id="ngbr_cell_info_content"></div></div>' +
      // ── NEIGHBOUR SCAN & FORCE CONNECT ──
      '<div class="zte_sec"><div class="zte_sec_title">Neighbor Scan & Force Connect</div>' +
      '<div style="font-size:10px;color:#78909C;margin-bottom:6px;">Uses the router\'s built-in scan (~30 s). ' +
      'Mobile data is off while it scans; the panel turns it back on. "Lock" applies a cell lock on that PCI + EARFCN.</div>' +
      '<div class="zte_btn_grid">' +
      btn("🔍 Start Scan", "window.zte_nbr_scan()", "ok") +
      btn("📋 Copy raw scan data", "window.zte_copy_nbr()") +
      "</div>" +
      '<div id="zte_scan_panel" style="display:none;margin-top:8px;">' +
      '<div id="zte_scan_status" style="color:#1976D2;font-size:11px;margin-bottom:6px;">—</div>' +
      '<div style="overflow-x:auto;"><table><thead><tr>' +
      "<th>Type</th><th>Band</th><th>RSRP</th><th>RSRQ</th><th>SINR</th><th>PCI</th><th>(E)ARFCN</th><th></th>" +
      '</tr></thead><tbody id="zte_scan_tbody"></tbody></table></div>' +
      "</div></div>" +
      // ── CONNECTION ──
      '<div class="zte_sec"><div class="zte_sec_title">Connection</div><div class="zte_btn_grid">' +
      btn("🔀 Reconnect data (off/on)", "window.zte_wan_reconnect()", "warn") +
      btn("🌐 DNS settings", "window.zte_dns()") +
      btn("🌉 Bridge mode ON", "window.zte_bridge_mode(true)", "warn") +
      btn("📶 Router mode (bridge OFF)", "window.zte_bridge_mode(false)") +
      '<div style="grid-column:1/-1;font-size:10px;color:#78909C;text-align:center;">Operation mode: <b id="zte_opmode">—</b></div>' +
      btn("🧩 ARP Proxy ON", "window.zte_arp_proxy(true)") +
      btn("🧩 ARP Proxy OFF", "window.zte_arp_proxy(false)", "danger") +
      '<div style="grid-column:1/-1;font-size:10px;color:#78909C;text-align:center;">ARP proxy: <b id="zte_arp_state">—</b></div>' +
      btn("🔄 Reboot Router", "window.zte_reboot()", "danger full") +
      "</div></div>" +
      // ── NETWORK MODE ──
      '<div class="zte_sec"><div class="zte_sec_title">Network Mode</div><div class="zte_btn_grid">' +
      Object.keys(NET_MODES).map(function (m) {
        return '<button class="zte_btn" id="zte_mode_' + m + "\" onclick=\"window.zte_set_net_mode('" + m + "')\">" + NET_MODES[m] + "</button>";
      }).join("") +
      btn("✏ Custom...", "window.zte_set_net_mode(null)", "full") +
      "</div></div>" +
      // ── LTE BANDS ──
      '<div class="zte_sec">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
      '<span class="zte_sec_title" style="margin-bottom:0;white-space:nowrap;flex-shrink:0;">LTE Bands</span>' +
      '<span style="font-size:10px;text-align:right;min-width:0;margin-left:10px;overflow-wrap:anywhere;">Lock: <span id="zte_lte_band_lock_status" style="font-weight:700">—</span></span></div>' +
      '<div id="zte_lte_chips">' + band_chips("lte") + "</div>" +
      '<button class="zte_btn danger" style="width:100%;margin-top:7px;" onclick="window.zte_lte_band_unlock()">🔓 Remove LTE Band Lock</button>' +
      '<div style="font-size:10px;color:#78909C;margin-top:6px;overflow-wrap:anywhere;">Supported bands: <span id="zte_lte_supported">reading…</span></div>' +
      "</div>" +
      // ── 5G BANDS ──
      '<div class="zte_sec">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
      '<span class="zte_sec_title" style="margin-bottom:0;white-space:nowrap;flex-shrink:0;">5G Bands (NR)</span>' +
      '<span style="font-size:10px;text-align:right;min-width:0;margin-left:10px;overflow-wrap:anywhere;">Lock: <span id="zte_nr_band_lock_status" style="font-weight:700">—</span></span></div>' +
      '<div id="zte_nr_chips">' + band_chips("nr") + "</div>" +
      '<div style="font-size:10px;color:#78909C;margin-top:5px;">NSA lock type in use: <b id="zte_nr_lock_type">—</b> (found automatically)</div>' +
      '<button class="zte_btn danger" style="width:100%;margin-top:7px;" onclick="window.zte_nr_band_unlock()">🔓 Remove NR Band Lock</button>' +
      '<div style="font-size:10px;color:#78909C;margin-top:6px;overflow-wrap:anywhere;">Supported bands: <span id="zte_nr_supported">reading…</span></div>' +
      '<div class="zte_btn_grid">' +
      btn("🧪 Probe 5G NSA lock", "window.zte_probe_nr_nsa()", "warn") +
      btn("🔎 Find band-lock API", "window.zte_find_lock_api()") +
      "</div>" +
      "</div>" +
      // ── GLOBAL RESET ──
      '<div class="zte_sec"><div class="zte_sec_title">Band Lock — Global Reset</div>' +
      '<button class="zte_btn danger" style="width:100%;" onclick="window.zte_unlock_all_bands()">🔓 Remove ALL Band Locks (LTE + NR)</button></div>' +
      // ── CELL LOCK ──
      '<div class="zte_sec"><div class="zte_sec_title">Cell Lock</div>' +
      '<div style="font-size:10px;color:#78909C;margin-bottom:4px;" id="zte_cell_lock_state">—</div>' +
      '<div style="font-size:10px;color:#78909C;margin-bottom:6px;">Prompts are prefilled with the current cell. After locking/unlocking, toggle network mode or reboot to apply.</div>' +
      '<div class="zte_btn_grid">' +
      btn("🔒 LTE Lock", "window.zte_lte_cell_lock(false)") +
      btn("🔓 LTE Unlock", "window.zte_lte_cell_lock(true)", "danger") +
      btn("🔒 5G Lock", "window.zte_nr_cell_lock(false)") +
      btn("🔓 5G Unlock", "window.zte_nr_cell_lock(true)", "danger") +
      btn("♻ Reset ALL band & cell locks (firmware)", "window.zte_reset_band_cell()", "danger full") +
      "</div></div>" +
      // ── TRAFFIC ──
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
      // ── DEVICE ──
      '<div class="zte_sec"><div class="zte_sec_title">Device Info</div>' +
      '<div class="zte_sub" style="margin-top:0">System</div><div id="zte_dev_system"></div>' +
      '<div class="zte_sub">WAN</div><div id="zte_dev_wan"></div>' +
      '<div class="zte_btn_grid">' +
      btn("📶 SIM Info", "window.zte_sim_info()") +
      btn("ℹ️ HW / SW Version", "window.zte_hw_sw_info()") +
      btn("✉ SMS Storage", "window.zte_wms_info()") +
      btn("🧾 Raw netinfo", "window.zte_dump_netinfo()") +
      btn("📡 APN", "window.zte_apn_info()", "full") +
      "</div></div>" +
      // ── GPS ──
      '<div class="zte_sec" id="zte_gnss_wrap"><div class="zte_sec_title">GPS</div>' +
      vrow("GPS", "zte_gnss_status") +
      '<div id="zte_gnss_data" style="display:none;">' +
      '<div id="zte_dev_gps_wrap" style="display:none;"><div class="zte_sub">Position</div><div id="zte_dev_gps"></div></div>' +
      "</div>" +
      '<div class="zte_btn_grid">' +
      '<button class="zte_btn full" id="zte_gnss_refresh_btn" onclick="window.zte_gps_refresh()">🛰 Refresh position</button>' +
      "</div></div>" +
      // ── WIFI ──
      '<div class="zte_sec" id="zte_wifi_sec"><div class="zte_sec_title">WiFi</div><div class="zte_btn_grid">' +
      btn("ℹ️ WiFi Info", "window.zte_wifi_info()", "full") +
      btn("📡 Set TX Power", "window.zte_wifi_txpower()") +
      btn("🌍 Set Country", "window.zte_wifi_country()", "warn") +
      "</div></div>" +
      // ── ADVANCED ──
      '<div class="zte_sec"><div class="zte_sec_title">Advanced</div><div class="zte_btn_grid">' +
      btn("🔑 Auto Login", "window.zte_enable_auto_login()") +
      btn("🗑 Forget Password", "window.zte_forget_password()", "danger") +
      '<div style="grid-column:1/-1;font-size:10px;color:#78909C;text-align:center;">Auto login: <b id="zte_autologin_state">—</b></div>' +
      btn("🛠 Developer Login", "window.zte_developer_login()") +
      btn("📋 Copy Signal", "window.zte_copy_signal()", "ok") +
      '<button class="zte_btn" id="zte_hidden_btn" onclick="window.zte_hidden_toggle()">👁 Hidden Menus: OFF</button>' +
      btn("📄 Hidden pages…", "window.zte_hidden_pages()") +
      '<button class="zte_btn ok full" id="zte_rec_btn" onclick="window.zte_rec_toggle()">📼 Record router UI calls</button>' +
      btn("🔍 Search recorded calls…", "window.zte_rec_search()", "full") +
      '<div id="zte_rec_count" style="grid-column:1/-1;font-size:10px;color:#78909C;text-align:center;">0 calls recorded</div>' +
      btn("🔎 Find API by keyword…", "window.zte_find_api()") +
      btn("🧪 Custom ubus call…", "window.zte_custom_ubus()", "warn") +
      "</div></div>" +
      // ── HIDDEN SETTINGS (shown only if the router supports them) ──
      '<div class="zte_sec" id="zte_sys_sec" style="display:none;"><div class="zte_sec_title">Hidden Settings</div>' +
      '<div class="zte_row" id="zte_sys_timeout_row" style="display:none;"><span class="zte_label">Session timeout</span>' +
      '<span class="zte_value" id="zte_sys_timeout">\u2014</span></div>' +
      '<div class="zte_btn_grid" id="zte_sys_timeout_btns" style="margin-bottom:6px;">' +
      btn("\u270f Change session timeout\u2026", "window.zte_set_login_timeout()", "full") + "</div>" +
      '<div class="zte_row" id="zte_sys_thermal_row" style="display:none;"><span class="zte_label" id="zte_thermal_label">Temperature control</span>' +
      '<span class="zte_value" id="zte_sys_thermal">\u2014</span></div>' +
      '<div class="zte_btn_grid">' +
      '<button class="zte_btn ok" id="zte_thermal_on_btn" onclick="window.zte_thermal(true)">\ud83c\udf21 On</button>' +
      '<button class="zte_btn danger" id="zte_thermal_off_btn" onclick="window.zte_thermal(false)">\ud83c\udf21 Off</button>' +
      '<div id="zte_thermal_note" style="grid-column:1/-1;font-size:10px;color:#78909C;">Keep it on.</div>' +
      "</div></div>" +
      // ── TIP ──
      (CFG.bmac
        ? '<div class="zte_sec" style="text-align:center;background:#FFF8E1;border-color:#FFE082;">' +
          '<div style="font-size:11px;color:#78909C;margin-bottom:8px;">This panel builds on the work of Cerix and Thomas Pöchtrager.<br>If it helps you, consider a small tip to them ☕</div>' +
          '<a href="https://buymeacoffee.com/cerix" target="_blank" rel="noopener noreferrer" ' +
          'style="display:inline-block;background:#FFDD00;color:#000;font-weight:700;font-size:13px;padding:9px 22px;' +
          'border-radius:8px;text-decoration:none;border:2px solid #F0C800;">☕ Buy Me a Coffee — Cerix</a>' +
          '<div style="font-size:10px;color:#90A4AE;margin-top:8px;">ZTE-Script-NG (ubus API) by Thomas Pöchtrager — PayPal tips: t.poechtrager@gmail.com</div>' +
          "</div>"
        : "") +
      "</div>" +
      '<div id="zte_footer">ZTE Panel NG v' + CFG.version + " · based on Cerix's panel and ZTE-Script-NG · AGPLv3 · drag header to move</div>";

    document.body.appendChild(panel);
    make_draggable(panel);
    make_minimizable(panel);
  }

  // ─────────────────────────────────────────────
  //  DRAG & MINIMIZE
  // ─────────────────────────────────────────────
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
      body.style.display = col ? "none" : "";
      foot.style.display = col ? "none" : "";
      b.textContent = col ? "+" : "−";
      hdr.style.borderRadius = col ? "12px" : "12px 12px 0 0";
    });
  }

  // ─────────────────────────────────────────────
  //  API RECORDER
  //  Logs the ubus calls the router's OWN web pages make (XHR + fetch), so a
  //  value you see on screen (GPS, bridge mode, …) can be traced to its call.
  //  The panel's own calls are excluded; login passwords are never stored.
  // ─────────────────────────────────────────────
  S.rec = { on: false, items: [] };

  function rec_push(reqBody, respText) {
    if (!S.rec.on || typeof reqBody !== "string") return;
    var calls, resp;
    try { calls = JSON.parse(reqBody); } catch (e) { return; }
    try { resp = JSON.parse(respText); } catch (e) { resp = respText; }
    var arr = Array.isArray(calls) ? calls : [calls];
    var rarr = Array.isArray(resp) ? resp : [resp];
    arr.forEach(function (c) {
      if (!c || !Array.isArray(c.params) || c.params.length < 3) return;
      var meth = String(c.params[2]);
      var params = /login|password|passwd/i.test(meth) ? "(hidden)" : c.params[3];
      var r = rarr.find(function (x) { return x && x.id === c.id; });
      S.rec.items.push({
        time: new Date().toLocaleTimeString(),
        call: c.params[1] + " / " + meth,
        params: params,
        result: /login/i.test(meth) ? "(hidden)" : r ? (r.result !== undefined ? r.result : r.error) : null,
      });
    });
    if (S.rec.items.length > 1500) S.rec.items.splice(0, S.rec.items.length - 1500);
    zset("zte_rec_count", S.rec.items.length + " calls recorded");
  }

  function install_recorder() {
    if (window._zteRecorderInstalled) return;
    window._zteRecorderInstalled = true;
    var oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      this._zteUrl = String(u || "");
      return oOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      if (S.rec.on && (/ubus/i.test(this._zteUrl || "") || (typeof body === "string" && body.indexOf('"jsonrpc"') > -1))) {
        var x = this;
        x.addEventListener("load", function () { try { rec_push(body, x.responseText); } catch (e) {} });
      }
      return oSend.apply(this, arguments);
    };
    var oFetch = window.fetch;
    window.fetch = function (input, init) {
      var p = oFetch.apply(this, arguments);
      try {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        // skip the panel's own calls (marked with a double "t" parameter)
        if (S.rec.on && init && typeof init.body === "string" && !/[?&]t=\d+&t=\d+/.test(url) &&
          (/ubus/i.test(url) || init.body.indexOf('"jsonrpc"') > -1)) {
          var body = init.body;
          p.then(function (r) { return r.clone().text(); }).then(function (t) { rec_push(body, t); }).catch(function () {});
        }
      } catch (e) { /* never break the page */ }
      return p;
    };
  }

  window.zte_rec_toggle = function () {
    // Hooks into the router page's XHR/fetch are installed only on first use
    install_recorder();
    S.rec.on = !S.rec.on;
    var b = zel("zte_rec_btn");
    if (b) {
      b.textContent = S.rec.on ? "⏹ Stop recording" : "📼 Record router UI calls";
      b.classList.toggle("active", S.rec.on);
    }
    zset("zte_rec_count", S.rec.items.length + " calls recorded");
    toast(S.rec.on
      ? "Recording — now open the router's own page that shows what you're looking for (e.g. Device details)."
      : "Recording stopped (" + S.rec.items.length + " calls).", "info");
  };

  // Paths inside a result where the search text appears
  function find_paths(obj, needle, path, out) {
    out = out || [];
    if (out.length >= 8 || obj === null || obj === undefined) return out;
    if (typeof obj !== "object") {
      if (String(obj).toLowerCase().indexOf(needle) > -1) out.push(path + " = " + String(obj).slice(0, 80));
      return out;
    }
    Object.keys(obj).forEach(function (k) {
      var p = path ? path + (Array.isArray(obj) ? "[" + k + "]" : "." + k) : k;
      if (k.toLowerCase().indexOf(needle) > -1 && typeof obj[k] !== "object") out.push(p + " = " + String(obj[k]).slice(0, 80));
      else find_paths(obj[k], needle, p, out);
    });
    return out;
  }

  window.zte_rec_search = function () {
    if (!S.rec.items.length) {
      toast("Nothing recorded yet — press 📼 Record, then open the router's own page.", "warn");
      return;
    }
    var q = prompt("Search recorded calls for a value or word you see on the router's page\n" +
      "(e.g. the first digits of the GPS latitude like 37.9, or 'bridge').\nLeave empty to list every call.", "");
    if (q === null) return;
    var needle = q.trim().toLowerCase();
    // also try the value without its decimal point, and with a comma
    var needles = needle ? [needle, needle.replace(/[.,]/g, ""), needle.replace(".", ",")]
      .filter(function (v, i, a) { return v && a.indexOf(v) === i; }) : [];
    function hit(text) {
      text = text.toLowerCase();
      return needles.some(function (n) { return text.indexOf(n) > -1; });
    }
    // latest occurrence of each distinct call+params
    var seen = {}, list = [];
    for (var i = S.rec.items.length - 1; i >= 0; i--) {
      var it = S.rec.items[i];
      var key = it.call + JSON.stringify(it.params);
      if (seen[key]) continue;
      seen[key] = 1;
      if (needle && !hit(JSON.stringify(it))) continue;
      list.push(it);
    }
    var html = list.length
      ? list.slice(0, 40).map(function (it) {
          var paths = [];
          needles.forEach(function (n) { find_paths(it.result, n, "").forEach(function (x) { if (paths.indexOf(x) < 0) paths.push(x); }); });
          return '<div class="zte_sec"><div class="zte_sec_title" style="text-transform:none;letter-spacing:0;">' + esc(it.call) + "</div>" +
            '<div style="font-size:10px;color:#78909C;">params: ' + esc(JSON.stringify(it.params)) + " · " + esc(it.time) + "</div>" +
            (paths.length ? '<div style="font-size:11px;color:#E65100;font-weight:700;margin-top:4px;">' + paths.map(esc).join("<br>") + "</div>" : "") +
            '<details style="margin-top:4px;"><summary style="font-size:10px;cursor:pointer;color:#1976D2;">full result</summary>' +
            '<pre style="white-space:pre-wrap;word-break:break-all;font-size:10px;margin:0;user-select:text;">' + esc(JSON.stringify(it.result, null, 2)) + "</pre></details></div>";
        }).join("")
      : '<div class="zte_sec" style="color:#78909C;">No recorded call contains “' + esc(q) + "”.</div>";
    var ov = show_modal(
      "Recorded calls" + (needle ? " matching “" + q + "”" : "") + " — " + list.length,
      '<div class="zte_btn_grid" style="margin:0 0 8px;">' +
        '<button class="zte_btn ok" id="zte_rec_copy">📋 Copy full results</button>' +
        '<button class="zte_btn" id="zte_rec_names">📋 Copy call names only</button></div>' +
        '<div style="font-size:10px;color:#78909C;margin-bottom:8px;">' + S.rec.items.length + " calls recorded in total · " +
        list.length + " distinct shown. “Call names only” contains no personal values.</div>" + html,
    );
    ov.querySelector("#zte_rec_copy").onclick = function () {
      copy_text(JSON.stringify({ search: q, results: list.slice(0, 40) }, null, 2), "Copied");
    };
    ov.querySelector("#zte_rec_names").onclick = function () {
      var names = [];
      S.rec.items.forEach(function (it) {
        var n = it.call + " " + JSON.stringify(it.params);
        if (names.indexOf(n) < 0) names.push(n);
      });
      copy_text(names.join("\n"), names.length + " call names copied");
    };
  };

  // ─────────────────────────────────────────────
  //  INIT
  // ─────────────────────────────────────────────
  function start_panel() {
    if (S.init_done) return;
    if (zel("zte_panel")) { // an older copy without the guard below got there first
      toast("Another ZTE panel script is already running on this page.\nKeep only one enabled in your userscript manager.", "warn");
      return;
    }
    S.init_done = true;
    S.started_at = Date.now();
    try { sessionStorage.removeItem(TRIED_KEY); } catch (e) { /* ignore */ } // logged in: an automatic login, if any, worked
    stamp(sessionStorage, SEEN_KEY);
    inject_html();
    update_login_state();
    // Leaving the page with the session token already removed = the Logout button was used
    window.addEventListener("beforeunload", function () {
      var ct = null;
      try { ct = sessionStorage.getItem("ct"); } catch (e) { /* ignore */ }
      if (!ct) stamp(localStorage, LOGOUT_KEY);
    });
    poll_loop();
    try { localStorage.removeItem("ZtePanelGpsSource"); } catch (e) {} // left over from older versions
    setTimeout(read_sys_settings, 5000); // session timeout + temperature control, shown only if supported
    setTimeout(check_wifi, 3500); // hides the WiFi section on routers without WiFi
    setTimeout(update_gps, 6000); // one GPS read; afterwards only via "🛰 Refresh GPS"
    setTimeout(update_arp_state, 8000); // one read; afterwards only when the ARP proxy is switched
    setTimeout(load_ant_ui, 3000); // antenna options + names from the router's own UI (once)
    setTimeout(load_band_caps, 2500); // the bands this router has (once)
    start_hidden_menus();
    toast("ZTE Panel NG v" + CFG.version + " active", "ok");
    console.log("[ZTE] Panel NG started, polling every", CFG.pollInterval, "ms");
  }

  // Let the router's own page finish loading before the panel starts talking to the router:
  // resolves once the page is loaded and has requested nothing new for a moment (5 s at most).
  function wait_page_settled() {
    return new Promise(function (resolve) {
      var start = Date.now(), last = -1, quietSince = Date.now();
      (function tick() {
        var n = performance.getEntriesByType("resource").length;
        if (n !== last) { last = n; quietSince = Date.now(); }
        var quiet = document.readyState === "complete" && Date.now() - quietSince >= 800;
        if (quiet || Date.now() - start >= 5000) return resolve();
        setTimeout(tick, 200);
      })();
    });
  }

  async function bootstrap() {
    // Only one copy may run on a page (Full and Lite together, or an old and a new install)
    if (window.__ztePanelNG) {
      toast("Another ZTE panel script (v" + window.__ztePanelNG + ") is already running on this page.\nKeep only one enabled in your userscript manager.", "warn", 12000);
      return;
    }
    window.__ztePanelNG = CFG.version;
    console.log("[ZTE] Panel NG v" + CFG.version + " loaded (ubus API)");

    // Versions up to ng1.23 kept the password hash under this name
    try { localStorage.removeItem("ScriptPasswordHash"); } catch (e) { /* ignore */ }

    // Let the router's own page load first.
    await wait_page_settled();
    var logged_in = await check_login();
    // Right after an automatic login the router may answer "Access denied" once although the
    // login worked (it does that now and then). Ask a few more times before giving up.
    for (var n = 0; !logged_in && n < 4 && ms_since(sessionStorage, TRIED_KEY) < 60000; n++) {
      await new Promise(function (r) { setTimeout(r, 700); });
      logged_in = await check_login();
    }
    if (logged_in) return start_panel();

    // Nobody is logged in. Use the saved password — once, and only on a page that was just opened.
    if (saved_hash()) {
      if (just_logged_out()) {
        toast("Logged out. Auto login is skipped right after a logout —\nreload the page to log in automatically.", "info", 8000);
      } else if (ms_since(sessionStorage, TRIED_KEY) < 60000) {
        // The page was reloaded after an automatic login and is still logged out: do not try again
        toast("Auto login was just tried and the router page is still logged out.\nLog in on the router page.", "warn", 10000);
      } else {
        stamp(sessionStorage, TRIED_KEY);
        var result = "error";
        try { result = await router_login(saved_hash()); } catch (e) { console.warn("[ZTE] Auto login error:", e.message); }
        if (result === "ok") {
          // Reload once, so that the router's own page starts up with this session
          toast("Logged in with the saved password — reloading…", "ok", 3000);
          if (/login/i.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
          location.reload();
          return;
        }
        if (result === "rejected") {
          try { localStorage.removeItem(PW_KEY); } catch (e) { /* ignore */ }
          toast("Auto login failed — the router rejected the saved password, so it was removed.\nLog in on the router page, then save it again with 🔑 Auto Login.", "error", 15000);
        } else {
          toast("Auto login did not go through. Log in on the router page.", "warn", 10000);
        }
      }
    }

    // Wait until somebody logs in on the router page.
    var busy = false;
    var t = setInterval(async function () {
      if (busy) return;
      busy = true;
      if (await check_login()) {
        clearInterval(t);
        await wait_page_settled(); // the router loads its main page right after the login
        start_panel();
      }
      busy = false;
    }, CFG.loginWaitInterval);
  }

  bootstrap();
})();
