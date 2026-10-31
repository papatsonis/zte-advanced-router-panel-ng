#!/usr/bin/env python3
"""Build the Lite edition from the published full panel.

    python3 tools/build_lite.py [full.user.js] [lite.user.js]

Defaults: reads zte-advanced-panel-ng.user.js and writes zte-advanced-panel-ng-lite.user.js
next to it (the repository root). The Lite edition is the same script without the developer
tools (API finder, call recorder, custom ubus calls, raw dumps, 5G NSA lock probe, raw scan
copy) and without debug logging.

Every anchor is a line of code (the published scripts carry no comments), and every edit asserts
that its anchor is found exactly once, so the build fails loudly if the full script changes shape
instead of silently producing a broken Lite edition. At the end the output is checked: no
developer tool is left, nothing still calls a removed function, and it parses (node --check).
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "zte-advanced-panel-ng.user.js")
DST = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(SRC)), "zte-advanced-panel-ng-lite.user.js")
s = open(SRC, encoding="utf-8").read()
removed = []  # text of every removed block, for the final checks


def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f"anchor found {n}x (wanted {count}): {old[:80]!r}"
    s = s.replace(old, new)


def cut(start, end, insert="", must=()):
    """Remove from the start anchor up to (not including) the end anchor."""
    global s
    assert s.count(start) == 1, f"start anchor x{s.count(start)}: {start[:80]!r}"
    a = s.index(start)
    b = s.find(end, a + len(start))
    assert b > a, f"end anchor not found after {start[:60]!r}: {end[:60]!r}"
    for m in must:
        assert m in s[a:b], f"{m!r} not inside the block {start[:60]!r}"
    removed.append(s[a:b])
    s = s[:a] + insert + s[b:]


VER = re.search(r'version: "([^"]+)"', s).group(1)
assert "dev_ui: false," in s, "the input must be the published Full edition (dev_ui: false)"

# ── Header ─────────────────────────────────────────────────────────────
rep("// @name         ZTE Advanced Router Panel NG\n", "// @name         ZTE Advanced Router Panel NG Lite\n")
rep("hidden-page unlock, collapsible sections, plus developer tools.", "hidden-page unlock, collapsible sections. Lite edition without the developer tools.")
rep("/main/zte-advanced-panel-ng.user.js", "/main/zte-advanced-panel-ng-lite.user.js", count=2)  # @downloadURL, @updateURL
rep(
    " * ZTE Advanced Router Panel NG\n *\n",
    " * ZTE Advanced Router Panel NG — Lite edition\n *\n"
    " * The everyday features of the full panel, without the developer tools\n"
    " * (API finder, call recorder, custom ubus calls, raw dumps, lock probe).\n *\n",
)

# ── Config and state ───────────────────────────────────────────────────
rep('    nr_type_variants: ["1", "NSA", "nsa", "ENDC", "LTE_AND_5G"],\n', "")
rep("  var S = (window._ZTE_STATE = {", "  var S = {")
rep("    poll_tick: 0,\n  });", "    poll_tick: 0,\n  };")

# ── 5G band lock: same logic as the full edition; drop the NSA probe and the API finder ──
cut("  async function probe_nr_nsa_inner() {", "  function denied_msg(what, kw) {",
    must=("window.zte_probe_nr_nsa", "window.zte_find_api", "window.zte_find_lock_api"))
assert "function send_nr_bands" not in removed[-1]
rep('    zset("zte_nr_lock_type", nsa_type());\n', "")

# ── "refused" message without the API finder hint ──────────────────────
rep(
    '''  function denied_msg(what, kw) {
    return "The router refused " + what + " from the web login.\\nUse 🔎 Find API with keyword '" + kw + "' and report the result in the project's GitHub issues.";
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
          S.gps = { state: "encoded" };
          render_gps(null, null, "encoded by the router (cannot decode)");
          say("The router returns the position in an encoded form — please report what the console (F12) line '[ZTE] GPS:' says in the project's GitHub issues.", "warn");
''',
    '''          S.gps = { state: "encoded" };
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
rep('    gf_keep_btn("zte_copy_nbr");\n', "")

# ── Raw dump and custom ubus calls ─────────────────────────────────────
cut("  window.zte_dump_netinfo = function () {", "  function copy_text(text, msg) {", must=("window.zte_custom_ubus",))

# ── Call recorder ──────────────────────────────────────────────────────
cut("  S.rec = { on: false, items: [] };\n", "  function start_panel() {", must=("function rec_push", "window.zte_rec_toggle"))

# ── Panel markup ───────────────────────────────────────────────────────
rep(
    """'<h2><span id="zte_status_dot"></span>ZTE Advanced Router Panel NG</h2>' +""",
    """'<h2><span id="zte_status_dot"></span>ZTE Advanced Router Panel NG Lite</h2>' +""",
)
rep('''      btn("✏ Custom…", "window.zte_set_net_mode(null)", "full") +\n''', "")
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
# the Debug section (call recorder, API finder, custom calls) is Full only
cut("""      '<div class="zte_sec"><div class="zte_sec_title">Debug</div><div class="zte_btn_grid">' +\n""",
    "      GRP_CLOSE +\n      (CFG.bmac", must=("window.zte_rec_toggle()", "window.zte_custom_ubus()"))
rep("""'<div id="zte_footer">ZTE Panel NG v' +""", """'<div id="zte_footer">ZTE Panel NG Lite v' +""")

# the network-mode prompts are no longer reachable (no "Custom…" button)
cut("    if (!mode) {\n      mode = prompt(\n        \"Network mode (net_select):\\n\" +", '    var label = "Network mode → "')
cut("    if (!mode) {\n      mode = prompt(\"Network mode (net_select):\\n\" +", "    if (!mode) return;\n    var label = \"Network mode → \"")

# ── Start-up ───────────────────────────────────────────────────────────
rep('toast("ZTE Panel NG v" + CFG.version + " active", "ok");', 'toast("ZTE Panel NG Lite v" + CFG.version + " active", "ok");')
rep('toast("ZTE Panel NG v" + CFG.version + " active" + (CFG.dev_ui ? " — goform router" : ""), "ok");',
    'toast("ZTE Panel NG Lite v" + CFG.version + " active", "ok");')
rep('console.log("[ZTE] Panel NG v" + CFG.version + " loaded");', 'console.info("[ZTE] Panel NG Lite v" + CFG.version + " loaded");')

# ── Logging: drop every remaining debug console.log statement ──────────
before = s.count("console.log(")
s = re.sub(r'^[ \t]*console\.log\("\[ZTE\][^\n]*\);[ \t]*\n', "", s, flags=re.M)
# a block whose only statement was removed is left empty: drop an empty "else {}", and an empty
# "if (…) {}" whose condition has no call or assignment (so dropping it changes nothing)
s = re.sub(r"\} else \{\n[ \t]*\}", "}", s)
s = re.sub(r"^([ \t]*)if \(([^(){};=\n]|===|!==)*\) \{\n\1\}\n", "", s, flags=re.M)
left = s.count("console.log(")
assert left == 0, f"{left} console.log left"

# ── Checks on the output ───────────────────────────────────────────────
for dev in ("zte_find_api", "zte_find_lock_api", "zte_probe_nr_nsa", "zte_custom_ubus", "zte_dump_netinfo",
            "zte_copy_nbr", "zte_rec_", "rec_push", "nr_type_variants", "_ZTE_STATE", "Raw netinfo",
            "Find API", "Custom ubus", "Probe 5G", "Debug</div>"):
    assert dev not in s, f"developer tool left in Lite: {dev}"
# a function or window.zte_* handler removed above must not be used anywhere that is left
gone = set()
for blk in removed:
    gone.update(re.findall(r"^  (?:async )?function ([A-Za-z0-9_$]+)\s*\(", blk, re.M))
    gone.update("window." + n for n in re.findall(r"^\s*window\.(zte_[A-Za-z0-9_]+)\s*=", blk, re.M))
kept = set(re.findall(r"^  (?:async )?function ([A-Za-z0-9_$]+)\s*\(", s, re.M))
kept.update("window." + n for n in re.findall(r"window\.(zte_[A-Za-z0-9_]+)\s*=(?!=)", s))
for name in sorted(gone - kept):
    pat = re.escape(name) + r"\s*\(" if name.startswith("window.") else r"(?<![\w.$])" + re.escape(name) + r"\b"
    hits = [l.strip()[:90] for l in s.splitlines() if re.search(pat, l)]
    assert not hits, f"{name} was removed but is still used:\n  " + "\n  ".join(hits[:5])
# every onclick / call of a window.zte_* handler has a definition
used = set(re.findall(r"window\.(zte_[A-Za-z0-9_]+)\(", s))
defined = set(re.findall(r"window\.(zte_[A-Za-z0-9_]+)\s*=(?!=)", s))
assert not (used - defined), f"handlers called but never defined: {sorted(used - defined)}"

open(DST, "w", encoding="utf-8").write(s)
subprocess.run(["node", "--check", DST], check=True)
print(f"lite built: {VER}  ({len(s.splitlines())} lines, removed {before} debug logs)")
