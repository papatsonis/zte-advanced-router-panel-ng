# ZTE Advanced Router Panel NG

A floating control panel for **newer ZTE 4G/5G routers** — the ones whose web interface talks to the router through the ubus JSON-RPC API (ZTE MC7520, MC7523/G5TC, MC7530 and later). It is a userscript: it runs inside the router's own web page and adds signal details, band and cell locking, a neighbor scan, bridge mode, DNS, traffic statistics and more.

This brings the [ZTE Advanced Router Panel](https://github.com/Cerix/zte-advanced-router-panel) design by **Cerix** to the newer **ubus** routers, built on the ubus foundation of [ZTE-Script-NG](https://github.com/tpoechtrager/ZTE-Web-Script) by **Thomas Pöchtrager**, and adds a large set of controls on top. Ported and extended by **[papatsonis](https://github.com/papatsonis)** — see [What this fork adds](#what-this-fork-adds) and [Credits](#credits).

> **Older routers (MC888, MC889, MC7010 …)** use a different API. For those, use [Cerix's original panel](https://github.com/Cerix/zte-advanced-router-panel) or the [legacy ZTE-Script](https://github.com/tpoechtrager/ZTE-Web-Script).

![The Lite edition with demo data: the default view, and with the three groups opened](img/panel-lite.png)

*The Lite edition with demo data: how it opens (left) and with the three groups unfolded (right).*

## Two editions

| Edition | For | Install |
|---|---|---|
| **Lite** | Everyday use. All the controls, none of the developer tools. | [zte-advanced-panel-ng-lite.user.js](https://raw.githubusercontent.com/papatsonis/zte-advanced-router-panel-ng/main/zte-advanced-panel-ng-lite.user.js) |
| **Full** | Everything in Lite, plus tools for exploring the router's API. | [zte-advanced-panel-ng.user.js](https://raw.githubusercontent.com/papatsonis/zte-advanced-router-panel-ng/main/zte-advanced-panel-ng.user.js) |

Install one of them. If you install both, keep only one enabled at a time.

## Install

1. Install a userscript manager in your browser: [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Click one of the install links in the table above and confirm the installation.
3. Open your router's web page and log in. The panel appears in the top-left corner a moment after the page has loaded.

The script runs on `192.168.0.1`, `192.168.1.1`, `192.168.8.1` and `192.168.254.1`. If your router uses another address, add a matching `@match` line at the top of the script.

## Features

The panel has four groups: **Dashboard** (always open), **RF Tuning & Locks**, **Router Settings** and **Advanced Tools**. The last three fold away; the folded RF bar shows which band and cell locks are active.

| Section | What it does |
|---|---|
| **Network** | Provider, network type, active bands, total bandwidth, LTE and 5G carrier aggregation, eNodeB / gNodeB, cell IDs, WAN IP, temperature, session time with a countdown to the next IP renewal |
| **Signal** | One card per LTE and 5G carrier: RSRP, RSRQ, SINR, RSSI, (E)ARFCN, PCI, bandwidth, frequency; copy a signal report |
| **ODU antenna selection** | Automatic, directional (front), directional wide beam (rear) or omnidirectional. The options and their names are read from the router's own Developer options page. Shown only on models that have this setting |
| **Neighbor scan & force connect** | Runs the router's built-in neighbor scan and lets you lock to any cell it finds |
| **Connection** | Reconnect mobile data, DNS (manual or operator), bridge mode on/off, ARP proxy on/off, reboot |
| **Network mode** | 5G SA, 5G NSA, 4G/5G auto, LTE only |
| **LTE bands / 5G bands** | One-click band locks with live status. Each frame lists the bands your router supports (read from the router); a button that needs a band it does not have is left out, and such a band is refused in "Custom". A 5G lock is written to both the SA and the NSA list and read back to confirm it was saved |
| **Cell lock** | Lock or unlock an LTE cell (PCI + EARFCN) or a 5G cell (PCI + ARFCN + band); reset all locks. An LTE cell lock is applied in steps — LTE only, lock, back to the mode you were in — because a lock set directly in 5G NSA stalls the connection |
| **Traffic statistics** | Live speeds, session, monthly and all-time totals; reset the monthly counters; set the automatic reset day |
| **Device info** | CPU temperature and load, memory, uptime, WAN details, SIM info, hardware/software versions, SMS storage, APN (view and switch profile) |
| **GPS** | Whether the router has GPS, and its position with a map link. Says "not available on this router" when it has none |
| **WiFi** | Radio info, transmit power, country. Hidden on routers without WiFi (outdoor units such as the MC7530) |
| **Remote management & QoS** | QoS global speed cap (upload/download limit) with the router's own priority profiles read live from it (automatic, game, web page, video), and TR-069 (ACS) control: turn CWMP on or off, and turn Periodic Inform on or off, with both states shown. QoS appears only in router mode; both appear only where the router answers |
| **Login** | Optional auto login, developer login, and the session timeout (how long until the router logs you out; shown only if the router supports it) |
| **Temperature control** | The firmware's overheating protection, on or off. Shown only if the router supports it |
| **Hidden menus & pages** | Shows menu entries the router's web interface hides, and lists pages the firmware has but links no menu entry for — which the panel can open |

**Full edition only:** API finder (searches the router's own web code for a keyword), call recorder (logs the calls the router's pages make), custom ubus call, raw netinfo dump, raw scan data, 5G NSA lock probe.

## Compatibility

Tested on a **ZTE MC7530**, an **MC8532B** and a **G5TC** (B07 firmware). For 1.36 the controls were run through on all three, except bridge mode, reboot and the TR-069 switches, which were not toggled on every unit. For 1.37 automatic login, the guided cell lock and the reconnect were run again on all three. The basic calls come from ZTE-Script-NG, which was written for the G5TC and later models; the rest were taken from the MC7530's own web interface. Other ubus-based ZTE routers may work fully or only partly — firmware differs between models and operators.

## Things to know before you click

- **Everything stays local.** The script only talks to your router. The only outside links are the ones you click yourself (the map link and the tip links).
- **You log in on the router's own page.** The panel starts once you are in and pauses whenever you are logged out.
- **Auto login is optional and off by default.** If you turn it on (🔑 Auto Login), a SHA-256 hash of the router password is kept in the browser's storage for the router's address. Anyone who can use that browser profile can then open the router page, and the hash itself is enough to log in — so do not turn it on on a shared computer. "Forget Password" removes it.
- **Band and cell locks stay in place** until you remove them. "Remove band lock" works by locking to all bands of your router. The panel reads that list from the router; only if the router reports none does it use the lists in the `CFG` block.
- **Locking to a cell of another operator** leaves the router without service until you unlock it. An LTE cell lock is applied for you in steps (LTE only → lock → back to your mode); expect the connection to drop for 10–20 seconds. A 5G cell lock takes effect after you switch network mode or reboot.
- **Bridge mode** turns the router's routing off: the device on the LAN port gets the mobile IP directly, and Wi-Fi clients may lose internet. Try it from a computer connected by cable.
- **ARP proxy** is a hidden setting of the firmware. The router accepts the switch only in a developer session, so the panel asks for the router password if none is saved. The panel shows the stored setting; if nothing changes on your network after switching, reboot the router.
- **Hidden Menus** shows menu entries and page parts that the router's own web interface hides (marked with a dashed outline). **Hidden pages** lists pages the firmware has but links no menu entry for — such as the TR-069 config and Developer options pages — and can open them: the web interface is a single-page app that loads a page without checking the menu, so the panel asks it to load the page directly and the router draws it as it normally would. Some of these belong to features your model does not have, so a page may come up empty; opening a page only displays it — the router's own access rules still decide what any control on it may change.
- **QoS** sets one global speed cap for the whole router (an upload and a download limit) using the firmware's own priority profiles, whose names are read live from the router. It is a router-mode feature, so the panel hides it in bridge mode, and shows it only on models that answer the QoS calls.
- **TR-069 (ACS)** is how an operator manages the router remotely. The panel can turn CWMP on or off and turn Periodic Inform on or off independently, and shows both states. It never reads or handles the ACS password — changes round-trip through the firmware's own functions, which keep the password inside the router. It is shown only where the router answers.
- **Groups and sections fold away.** Click a group bar or a section title to collapse or expand it (▾ / ▸). The panel opens with Network and Signal expanded and the rest folded, and remembers your choice per router. Collapsing does not stop anything from updating — it just hides it.
- **The neighbor scan disconnects mobile data** while it runs (about 30 seconds). The panel turns it back on afterwards.
- **Reconnect** switches mobile data off and on again. On some firmware (seen on the MC7530, and on a G5TC in bridge mode) the router stops answering for a while and then ends the web session when it does that. With a saved password the panel logs in again and makes sure mobile data is back on by itself — this can take one or two page reloads and up to about a minute and a half. Without a saved password, log in again and the panel switches mobile data back on.
- **ODU antenna selection** is meant for debugging, according to ZTE: keep *Automatic switching* in normal use. A change may ask for the router password (developer session) and lasts until the next reboot.
- **Temperature control** is the firmware's protection against overheating; keep it on. If you turn it off, the router turns it back on after a restart.
- **Session timeout** accepts 60–86400 seconds. Setting it is not offered by the router's own web interface; the panel uses the firmware's own call for it.
- **Sections depend on the model.** The ODU antenna, WiFi and hidden-settings sections appear only when the router answers their calls, and GPS says "not available" on routers without it.

This project is not affiliated with ZTE. Use it at your own risk.

## Auto login

With a saved password, the panel logs in for you when you open the router page and nobody is logged in. It logs in once and then reloads the page once, so that the router's own page starts up already logged in — you see a short flash of the login form first.

- It is skipped for about a minute after you press **Logout** (and confirm it), so logging out works. Reload the page later to log in again.
- If the router itself ends the session while the page is open — a timeout, or a change that resets it — the panel reloads the page once and logs in again. A guided cell lock or a reconnect that was cut off by this is finished afterwards.
- Without a saved password the panel never logs in: it pauses and waits for you.
- If the router rejects the saved password, the panel removes it and tells you.

## Configuration

A small `CFG` block at the top of the script holds the settings most people might change:

```js
var CFG = {
  bmac: true,              // false hides the tip box
  pollInterval: 1000,      // ms between signal refreshes
  ip_cycle_hours: 4,       // countdown to the operator's IP renewal; 0 hides it
  lte_all_bands: [...],    // used only if the router does not report its own LTE bands
  nr_all_bands: [...],     // used only if the router does not report its own 5G bands
};
```

## Development

The Lite edition is generated from the full one. Edit only `zte-advanced-panel-ng.user.js`, then run:

```sh
python3 tools/build_lite.py
```

The build stops with an error if the full script has changed in a way it does not expect, rather than producing a broken Lite edition.

## What this fork adds

This fork brings together **Cerix's panel** (designed for ZTE's older routers) and the **ubus foundation of ZTE-Script-NG** (a monitoring-and-locking panel for the newer G5TC-and-later models), then extends it with a large set of **control** features — tested across the MC7530, MC8532B and G5TC.

From ZTE-Script-NG it inherits the ubus groundwork: signal monitoring, band and cell locking, network-mode switching, traffic statistics, device info, WiFi and login handling.

On top of that, this fork adds the following — all capability-gated, so a control appears only if the router answers for it:

- **Connection controls** — reconnect mobile data, DNS settings, bridge mode on/off, reboot.
- **ARP proxy** on/off.
- **Neighbor scan & force connect** — run the router's scan and lock to any cell it finds.
- **APN** — view and switch profile.
- **ODU antenna selection** — option names read from the router's own developer page.
- **GPS / GNSS** — including models that lack the `zwrt_gnss` service.
- **Session timeout** and **temperature control**.
- **Band lists read from the router**, so only bands your model supports are offered.
- **QoS** — a global speed cap with the router's own priority profiles, read live.
- **TR-069 (ACS)** — CWMP and Periodic Inform toggles, without the panel ever handling the ACS password.
- **Hidden menus & pages** — reveals, and can open, pages the firmware hides (TR-069 config, Developer options).
- **Four groups with collapsible sections**, remembered per router, and a lock summary on the folded RF bar.
- **Guided LTE cell lock** — LTE only, lock, back to your mode, so the lock takes without stalling 5G NSA.
- **Recovery from a lost session** — with a saved password the panel logs in again when the router ends the session, and finishes a reconnect or cell lock that was cut off.
- **Two editions** — Lite (everyday) and Full (adds API-exploration tools), with Lite generated from Full by a build script.

### Version history

- **1.37** — a reconnect no longer leaves mobile data off when the router ends the session in the middle of it (seen on the MC7530): the panel keeps the step pending until the router has accepted it, and finishes it after the next login; calmer messages while that happens; on a narrow screen (a phone) the panel now fits the width instead of running off the side; narrower header when collapsed, to access ZTE's GUI options on top left corner.
- **1.36** — the panel is regrouped into Dashboard, RF Tuning & Locks, Router Settings and Advanced Tools, with the active locks shown on the folded RF bar; guided LTE cell lock; automatic re-login when the router ends the session, with an interrupted reconnect or cell lock finished afterwards; Logout is recognised through the router's confirmation dialog; the unused "Neighbor Cells (raw)" section is gone.
- **1.35** — credits and authorship (this section, header and footer).
- **1.34** — removed a redundant 5G carrier badge; ARP proxy shows its default.
- **1.33** — collapsible sections, remembered per router.
- **1.32** — QoS speed cap, TR-069 (CWMP + Periodic Inform) toggles, opening firmware-hidden pages.
- **1.31** — band buttons driven by the router's supported-band list, with a "Supported bands" line.
- **1.30** — GPS on models without `zwrt_gnss` (e.g. G5TC); band lists read from the router.
- **1.29** — reliable detection of a lost session on firmware that answers some calls without login.
- **1.28** — ODU antenna selection; GPS presence; session timeout; temperature control.
- **1.27** — ARP proxy on/off; hidden menus and hidden pages.
- **1.25** — fixed the logout right after login; safer auto-login.
- **1.21** — first public release on GitHub. Development began earlier at 1.0; pre-1.21 builds were private. At 1.21 the fork already had signal, band/cell lock, network mode, neighbor scan, bridge mode, DNS, APN, traffic stats, GPS, WiFi, auto-login, and the developer tools.

## Credits

This panel exists because of other people's work:

- **[papatsonis](https://github.com/papatsonis)** — this fork: the port to the ubus JSON-RPC API and the features in [What this fork adds](#what-this-fork-adds). Built on the work below; not maintained or endorsed by those authors. Tips: [paypal.me/skaranik](https://paypal.me/skaranik)
- **[Cerix](https://github.com/Cerix/zte-advanced-router-panel)** — *ZTE Advanced Router Panel* (MIT). The panel's design, layout and feature set come from it. Tips: [buymeacoffee.com/cerix](https://buymeacoffee.com/cerix)
- **[Thomas Pöchtrager](https://github.com/tpoechtrager/ZTE-Web-Script)** — *ZTE-Script-NG* (AGPLv3+). The ubus calls, login flow, signal parsing and frequency tables come from it. Tips: PayPal `t.poechtrager@gmail.com`
- **[open-u60-pro](https://github.com/jesther-ai/open-u60-pro)** by Jesther Silvestre and **[zte-u60-pro-mu5250-manager](https://github.com/faying/zte-u60-pro-mu5250-manager)** by faying (both MIT) — their research on the ZTE U60 Pro showed which ubus calls exist for the neighbor scan, mobile data on/off, DNS, APN, ARP proxy and resetting locks. Only the call and parameter names were used; no code from them is included.

This version is a separate, modified work. It is not maintained or endorsed by the original authors, so please report problems [here](https://github.com/papatsonis/zte-advanced-router-panel-ng/issues) and not to them.

## License

[GNU Affero General Public License v3.0 or later](LICENSE). Notices for the works this one is based on are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
