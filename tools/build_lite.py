#!/usr/bin/env python3
"""Build the Lite edition from the full panel.

    python3 tools/build_lite.py

Reads zte-advanced-panel-ng.user.js and writes zte-advanced-panel-ng-lite.user.js:
the same script without the developer tools (API finder, call recorder, custom
ubus calls, raw dumps, 5G lock probe) and without debug logging.

Edit only the full script, then run this. Every edit below asserts that its
anchor exists exactly once, so the build fails loudly if the full script changes
shape instead of silently producing a broken Lite edition.
"""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "zte-advanced-panel-ng.user.js")
DST = os.path.join(ROOT, "zte-advanced-panel-ng-lite.user.js")
s = open(SRC, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f"anchor found {n}x (wanted {count}): {old[:80]!r}"
    s = s.replace(old, new)


def cut(start, end, insert=""):
    """Remove from the start anchor up to (not including) the end anchor."""
    global s
    assert s.count(start) == 1, f"start anchor: {start[:80]!r} x{s.count(start)}"
    a = s.index(start)
    b = s.index(end, a + len(start))
    s = s[:a] + insert + s[b:]


def banner_before(title):
    """Index of the '// ────' line that opens the banner containing `title`."""
    i = s.index(title)
    return s.rfind("  // ─────", 0, i)


def cut_section(title, next_title, insert=""):
    """Remove a whole banner section, up to the banner of the next section."""
    global s
    a, b = banner_before(title), banner_before(next_title)
    assert 0 <= a < b
    s = s[:a] + insert + s[b:]


VER = re.search(r'version: "([^"]+)"', s).group(1)
LITE = VER  # both editions carry the same version number

# ── Header ─────────────────────────────────────────────────────────────
rep("// @name         ZTE Advanced Router Panel NG (ubus)", "// @name         ZTE Advanced Router Panel NG Lite (ubus)")
rep("traffic stats, GPS, QoS speed cap, TR-069 remote-management toggles, hidden-page unlock, collapsible sections, plus developer tools.", "traffic stats, GPS, QoS speed cap, TR-069 remote-management toggles, hidden-page unlock, collapsible sections. Lite edition without the developer tools.")
rep("/main/zte-advanced-panel-ng.user.js", "/main/zte-advanced-panel-ng-lite.user.js", count=2)  # @downloadURL, @updateURL
rep(
    " * ZTE Advanced Router Panel NG\n *\n",
    " * ZTE Advanced Router Panel NG — Lite edition\n *\n"
    " * The everyday features of the full panel, without the developer tools\n"
    " * (API finder, call recorder, custom ubus calls, raw dumps, lock probe).\n *\n",
)

# ── Config and state ───────────────────────────────────────────────────
rep('    nr_type_variants: ["1", "NSA", "nsa", "ENDC", "LTE_AND_5G"], // extra values tried by "Probe 5G NSA lock"\n', "")
rep("  var S = (window._ZTE_STATE = {", "  var S = {")
rep("    poll_tick: 0,\n  });", "    poll_tick: 0,\n  };")

# (Developer Login is kept in the Lite edition.)

# ── 5G band lock: same logic as the full edition; drop the probe and the API finder ──
a = s.index("  // Developer tool: try several nr5g_type values")
b = banner_before("  //  EXTRA FEATURES")
assert "window.zte_probe_nr_nsa" in s[a:b] and "window.zte_find_api" in s[a:b] and "send_nr_bands" not in s[a:b]
s = s[:a] + s[b:]
rep('    zset("zte_nr_lock_type", nsa_type());\n', "")

# ── Section banner and "refused" message ───────────────────────────────
rep(
    '''  //  EXTRA FEATURES
  //  Calls taken from community reverse-engineering of ZTE's ZWRT firmware
  //  (open-u60-pro / zte-u60-pro-mu5250-manager, ZTE U60 Pro). Those tools call
  //  ubus as root on the device; from the web login some may be refused.
''',
    '''  //  CONNECTION, SCAN, DNS, BRIDGE MODE, GPS, TRAFFIC, APN
  //  The calls are the ones the router's own web interface uses.
''',
)
rep(
    '''  function denied_msg(what, kw) {
    return "The router refused " + what + " from the web login.\\nUse 🔎 Find API with keyword '" + kw + "' and send me the result.";
  }''',
    '''  function denied_msg(what) {
    return "The router refused " + what + ".\\nLog in to the router again and retry.";
  }''',
)
s, n = re.subn(r'denied_msg\(("[^"]*"), "[^"]*"\)', r"denied_msg(\1)", s)
assert n == 2, n
rep(
    'msg: "The router did not apply the DNS change — see the console for details." };',
    'msg: "The router did not apply the DNS change." };',
)

# ── GPS: no diagnostics ────────────────────────────────────────────────
rep(
    '''      if (!S.gps_keys_logged) {
        S.gps_keys_logged = true;
        console.log("[ZTE] GPS fields returned by the router:", Object.keys(d).join(", ") || "(none)");
      }
''',
    "",
)
rep(
    '''          var sv = String(lat);
          console.log("[ZTE] GPS: position is encoded — length " + sv.length + ", " +
            (/^[0-9a-f]+$/i.test(sv) ? "hex" : /^[A-Za-z0-9+\\/=]+$/.test(sv) ? "base64-like" : "other format"));
          S.gps = { state: "encoded" }; // only an encrypted value the panel could not decode
          render_gps(null, null, "encoded by the router (cannot decode)");
          say("The router returns the position in an encoded form — tell me what the console (F12) line '[ZTE] GPS:' says.", "warn");
''',
    '''          S.gps = { state: "encoded" }; // only an encrypted value the panel could not decode
          render_gps(null, null, "not readable on this router");
          say("This router returns the GPS position in a form the panel cannot read.", "warn");
''',
)

# ── Neighbor scan: no raw-data copy ────────────────────────────────────
cut("  window.zte_copy_nbr = function () {", "  window.zte_force_lock = async function (i) {")
rep(
    '''      '<div class="zte_btn_grid">' +
      btn("🔍 Start Scan", "window.zte_nbr_scan()", "ok") +
      btn("📋 Copy raw scan data", "window.zte_copy_nbr()") +
      "</div>" +
''',
    '''      '<button class="zte_btn ok" style="width:100%;" onclick="window.zte_nbr_scan()">🔍 Start Scan</button>' +
''',
)

# ── Raw dumps and custom calls ─────────────────────────────────────────
a = s.index("  // Raw dump of every netinfo field")
b = banner_before("  //  MISC ACTIONS")
assert "window.zte_custom_ubus" in s[a:b]
s = s[:a] + s[b:]

# raw "neighbor cells" field viewer (panel section + its update code)
cut("    // ── Neighbour cells (only if the firmware exposes such a field) ──\n", "    update_traffic();\n")
rep(
    '''      // ── NEIGHBOUR CELLS (shown only if exposed by firmware) ──
      '<div class="zte_sec" id="ngbr_cells" style="display:none"><div class="zte_sec_title">Neighbor Cells (raw)</div>' +
      '<div id="ngbr_cell_info_content"></div></div>' +
''',
    "",
)

# ── Call recorder ──────────────────────────────────────────────────────
cut_section("  //  API RECORDER", "  //  INIT")

# ── Panel markup ───────────────────────────────────────────────────────
rep(
    """'<h2><span id="zte_status_dot"></span>ZTE Advanced Router Panel NG</h2>' +""",
    """'<h2><span id="zte_status_dot"></span>ZTE Advanced Router Panel NG Lite</h2>' +""",
)
rep('''      btn("✏ Custom...", "window.zte_set_net_mode(null)", "full") +\n''', "")
rep(
    '''      '<div style="font-size:10px;color:#78909C;margin-top:5px;">NSA lock type in use: <b id="zte_nr_lock_type">—</b> (found automatically)</div>' +
''',
    "",
)
rep(
    '''      '<div class="zte_btn_grid">' +
      btn("🧪 Probe 5G NSA lock", "window.zte_probe_nr_nsa()", "warn") +
      btn("🔎 Find band-lock API", "window.zte_find_lock_api()") +
      "</div>" +
''',
    "",
)
rep(
    '''      btn("✉ SMS Storage", "window.zte_wms_info()") +
      btn("🧾 Raw netinfo", "window.zte_dump_netinfo()") +
      btn("📡 APN", "window.zte_apn_info()", "full") +
''',
    '''      btn("✉ SMS Storage", "window.zte_wms_info()") +
      btn("📡 APN", "window.zte_apn_info()") +
''',
)
rep(
    '''      // ── ADVANCED ──
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
''',
    '''      // ── LOGIN & TOOLS ──
      '<div class="zte_sec"><div class="zte_sec_title">Login &amp; Tools</div><div class="zte_btn_grid">' +
      btn("🔑 Auto Login", "window.zte_enable_auto_login()") +
      btn("🗑 Forget Password", "window.zte_forget_password()", "danger") +
      '<div style="grid-column:1/-1;font-size:10px;color:#78909C;text-align:center;">Auto login: <b id="zte_autologin_state">—</b></div>' +
      btn("🛠 Developer Login", "window.zte_developer_login()") +
      btn("📋 Copy Signal", "window.zte_copy_signal()", "ok") +
      '<button class="zte_btn" id="zte_hidden_btn" onclick="window.zte_hidden_toggle()">👁 Hidden Menus: OFF</button>' +
      btn("📄 Hidden pages…", "window.zte_hidden_pages()") +
      "</div></div>" +
''',
)
rep("""'<div id="zte_footer">ZTE Panel NG v' +""", """'<div id="zte_footer">ZTE Panel NG Lite v' +""")

# network-mode prompt is no longer reachable (no "Custom…" button)
cut("    if (!mode) {\n      mode = prompt(\n", '    return run_action("Network mode → "')

# ── Start-up ───────────────────────────────────────────────────────────
rep('    try { localStorage.removeItem("ZtePanelGpsSource"); } catch (e) {} // left over from older versions\n', "")
rep('toast("ZTE Panel NG v" + CFG.version + " active", "ok");', 'toast("ZTE Panel NG Lite v" + CFG.version + " active", "ok");')
rep(
    'console.log("[ZTE] Panel NG v" + CFG.version + " loaded (ubus API)");',
    'console.info("[ZTE] Panel NG Lite v" + CFG.version + " loaded");',
)

# ── Logging: drop every remaining debug console.log statement ──────────
before = s.count("console.log(")
s = re.sub(r'^[ \t]*console\.log\("\[ZTE\][^\n]*\);[ \t]*\n', "", s, flags=re.M)
left = s.count("console.log(")
assert left == 0, f"{left} console.log left"

open(DST, "w", encoding="utf-8").write(s)
print(f"lite built: {LITE}  ({len(s.splitlines())} lines, removed {before} debug logs)")
