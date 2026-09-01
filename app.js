(function () {
  "use strict";

  var POLL_MS = 60000;
  var STALE_HOURS = 48;

  // "secondary" columns are hidden until "All columns" is on (default on at >=1024px).
  var COLS = [
    { key: "quotes_booked",        label: "Quotes booked",    fmt: "count",  secondary: true },
    { key: "quotes_completed",     label: "Quotes done",      fmt: "count",  secondary: true },
    { key: "ytd_gross",            label: "YTD gross #",      fmt: "count",  secondary: true },
    { key: "ytd_net",              label: "YTD net #",        fmt: "count" },
    { key: "est_remaining_gross",  label: "Est. remaining #", fmt: "count",  secondary: true },
    { key: "est_ye_net",           label: "Est. YE net #",    fmt: "count",  secondary: true },
    { key: "ye_budget",            label: "Budget #",         fmt: "count",  secondary: true },
    { key: "pct_of_budget",        label: "% of budget",      fmt: "pct",    secondary: true },
    { key: "ytd_net_dollars",      label: "YTD net $",        fmt: "money",  dollars: true },
    { key: "est_ye_net_dollars",   label: "Est. YE net $",    fmt: "money",  secondary: true },
    { key: "ye_budget_dollars",    label: "Budget $",         fmt: "money" },
    { key: "est_variance_dollars", label: "Variance $",       fmt: "money",  signed: true, secondary: true },
    { key: "est_variance_pct",     label: "Variance %",       fmt: "pct",    signed: true }
  ];

  var SECTIONS = [
    { key: "programs",    label: "Sales programs" },
    { key: "industrials", label: "Industrials" },
    { key: "addons",      label: "Add-on services" }
  ];

  var state = {
    index: null,
    current: null,
    data: {},
    updatedAt: {},
    sort: { key: null, dir: null }
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    main: $("main"), locations: $("locations"), status: $("status"), refresh: $("refresh"),
    summaryTitle: $("summary-title"),
    fYtd: $("f-ytd"), fEst: $("f-est"), fBudget: $("f-budget"), fVariance: $("f-variance"),
    nYtd: $("n-ytd"), nEst: $("n-est"), nBudget: $("n-budget"), nVariance: $("n-variance"),
    barWrap: $("bar-wrap"), bar: $("bar"), barFill: $("bar-fill"),
    search: $("search"), hideEmpty: $("hide-empty"), allCols: $("all-cols"), rowCount: $("row-count"),
    table: $("table"), heads: $("heads"), tbody: $("tbody"), notice: $("notice")
  };

  // ---------- formatting ----------

  var money0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  var int0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

  function fmt(v, col) {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v !== "number") return String(v);
    var sign = col.signed && v > 0 ? "+" : "";
    switch (col.fmt) {
      case "money": return sign + (v < 0 ? "\u2212" : "") + money0.format(Math.abs(v));
      case "pct":   return sign + (v < 0 ? "\u2212" : "") + Math.abs(v).toFixed(1) + "%";
      default:      return int0.format(v);
    }
  }

  function cellClass(v, col) {
    if (v === null || v === undefined || v === "") return "empty";
    if (v === 0) return "zero";
    if (col.signed) return v < 0 ? "negative" : "positive";
    return "";
  }

  function relTime(iso) {
    if (!iso) return "Not published yet";
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "Updated just now";
    if (mins < 60) return "Updated " + mins + " min ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return "Updated " + hrs + (hrs === 1 ? " hour ago" : " hours ago");
    var days = Math.round(hrs / 24);
    return "Updated " + days + (days === 1 ? " day ago" : " days ago");
  }

  function isEmptyRow(r) {
    return COLS.every(function (c) { return !r[c.key]; });
  }

  // ---------- fetching ----------

  function fetchJson(path) {
    return fetch(path + "?t=" + Date.now(), { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      return res.json();
    });
  }

  function loadIndex() {
    return fetchJson("data/index.json").then(function (idx) {
      state.index = idx;
      renderLocations();
      return idx;
    });
  }

  function findLocation(key) {
    if (!state.index) return null;
    for (var i = 0; i < state.index.locations.length; i++) {
      if (state.index.locations[i].key === key) return state.index.locations[i];
    }
    return null;
  }

  function loadLocation(key, force) {
    var entry = findLocation(key);
    if (!entry) return Promise.reject(new Error("Unknown location"));
    if (!force && state.data[key] && state.updatedAt[key] === entry.updated_at) {
      return Promise.resolve(state.data[key]);
    }
    return fetchJson("data/" + key + ".json").then(function (payload) {
      state.data[key] = payload;
      state.updatedAt[key] = entry.updated_at;
      return payload;
    });
  }

  // ---------- loading & notices ----------

  function setBusy(busy) {
    el.main.setAttribute("aria-busy", busy ? "true" : "false");
    el.refresh.classList.toggle("spinning", busy);
    el.refresh.disabled = busy;
  }

  function skeletonRows(n) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < n; i++) {
      var tr = document.createElement("tr");
      tr.setAttribute("aria-hidden", "true");
      var first = document.createElement("td");
      first.innerHTML = '<span class="skel skel-cell"></span>';
      tr.appendChild(first);
      COLS.forEach(function (c) {
        var td = document.createElement("td");
        td.innerHTML = '<span class="skel skel-cell"></span>';
        if (c.secondary) td.classList.add("col-secondary");
        if (c.dollars) td.classList.add("dollars-start");
        tr.appendChild(td);
      });
      frag.appendChild(tr);
    }
    return frag;
  }

  function showLoading() {
    ["fYtd", "fEst", "fBudget", "fVariance"].forEach(function (k) {
      el[k].innerHTML = '<span class="skel skel-value"></span>';
      el[k].className = "kpi-value";
    });
    ["nYtd", "nEst", "nBudget", "nVariance"].forEach(function (k) { el[k].textContent = ""; });
    el.barWrap.hidden = true;
    el.tbody.innerHTML = "";
    el.tbody.appendChild(skeletonRows(8));
    el.rowCount.textContent = "";
    el.notice.hidden = true;
  }

  function showNotice(title, body, isError, icon) {
    el.notice.className = "notice" + (isError ? " error" : "");
    el.notice.innerHTML =
      '<svg class="icon" aria-hidden="true"><use href="#' + (icon || (isError ? "i-alert" : "i-inbox")) + '"/></svg>' +
      '<p><strong></strong><span></span></p>';
    el.notice.querySelector("strong").textContent = title;
    el.notice.querySelector("span").textContent = body || "";
    el.notice.hidden = false;
  }

  // ---------- rendering ----------

  function renderLocations() {
    el.locations.innerHTML = "";
    state.index.locations.forEach(function (loc) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = loc.label;
      if (loc.key === state.current) b.setAttribute("aria-current", "page");
      b.addEventListener("click", function () { selectLocation(loc.key); });
      el.locations.appendChild(b);
    });
  }

  function renderStatus() {
    var entry = findLocation(state.current);
    if (!entry) { el.status.textContent = ""; return; }
    el.status.textContent = relTime(entry.updated_at);
    el.status.title = entry.updated_at ? new Date(entry.updated_at).toLocaleString() : "";
    var ageHrs = entry.updated_at ? (Date.now() - new Date(entry.updated_at).getTime()) / 3600000 : Infinity;
    el.status.classList.toggle("stale", ageHrs > STALE_HOURS);
  }

  function renderSummary(payload) {
    var total = null, programs = null;
    payload.rows.forEach(function (r) {
      if (r.is_total && r.section === "all") total = r;
      if (r.is_total && r.section === "programs") programs = r;
    });
    el.summaryTitle.textContent = payload.label + " summary";
    var m = { fmt: "money" };
    if (!total) {
      [el.fYtd, el.fEst, el.fBudget, el.fVariance].forEach(function (n) { n.textContent = "\u2014"; });
      return;
    }
    el.fYtd.textContent = fmt(total.ytd_net_dollars, m) || "\u2014";
    el.fEst.textContent = fmt(total.est_ye_net_dollars, m) || "\u2014";
    el.fBudget.textContent = fmt(total.ye_budget_dollars, m) || "\u2014";

    if (programs && typeof programs.ytd_net === "number") {
      el.nYtd.textContent = int0.format(programs.ytd_net) + " net program customers so far";
    }
    if (programs && typeof programs.ye_budget === "number" && programs.ye_budget > 0) {
      el.nBudget.textContent = int0.format(programs.ye_budget) + " program customers budgeted";
    }

    var est = total.est_ye_net_dollars, budget = total.ye_budget_dollars;
    if (typeof est === "number" && typeof budget === "number" && budget > 0) {
      var pct = est / budget * 100;
      el.barWrap.hidden = false;
      el.bar.setAttribute("aria-valuenow", Math.round(Math.min(pct, 100)));
      el.barFill.style.width = Math.min(pct, 100) + "%";
      el.barFill.classList.toggle("over", pct >= 100);
      el.nEst.textContent = pct.toFixed(1) + "% of budget";
    } else {
      el.barWrap.hidden = true;
    }

    var v = total.est_variance_dollars, p = total.est_variance_pct;
    el.fVariance.className = "kpi-value " + (v > 0 ? "positive" : v < 0 ? "negative" : "");
    el.fVariance.textContent = fmt(v, { fmt: "money", signed: true }) || "\u2014";
    if (typeof p === "number") {
      el.nVariance.textContent = fmt(p, { fmt: "pct", signed: true }) +
        (v > 0 ? " ahead of budget" : v < 0 ? " behind budget" : " on budget");
    }
  }

  function renderHeads() {
    el.heads.innerHTML = "";
    el.heads.appendChild(headCell({ key: "category", label: "Category" }, "col-cat"));
    COLS.forEach(function (c) {
      var cls = (c.secondary ? "col-secondary " : "") + (c.dollars ? "dollars-start" : "");
      el.heads.appendChild(headCell(c, cls.trim()));
    });
  }

  function headCell(col, cls) {
    var th = document.createElement("th");
    th.scope = "col";
    if (cls) th.className = cls;
    th.dataset.key = col.key;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "sort-btn";
    b.innerHTML = '<span></span><svg class="icon" aria-hidden="true"><use href="#i-sort"/></svg>';
    b.querySelector("span").textContent = col.label;
    b.setAttribute("aria-label", "Sort by " + col.label);
    b.addEventListener("click", function () { toggleSort(col.key); });
    th.appendChild(b);
    return th;
  }

  function toggleSort(key) {
    var s = state.sort;
    if (s.key !== key) { s.key = key; s.dir = key === "category" ? "asc" : "desc"; }
    else if (s.dir === "desc") s.dir = "asc";
    else if (s.dir === "asc" && key !== "category") { s.key = null; s.dir = null; }
    else { s.key = null; s.dir = null; }
    renderSortState();
    renderTable(state.data[state.current]);
  }

  function renderSortState() {
    Array.prototype.forEach.call(el.heads.children, function (th) {
      var active = th.dataset.key === state.sort.key;
      if (active) th.setAttribute("aria-sort", state.sort.dir === "asc" ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
      th.querySelector("use").setAttribute("href",
        active ? (state.sort.dir === "asc" ? "#i-up" : "#i-down") : "#i-sort");
    });
  }

  function sortRows(rows) {
    var s = state.sort;
    if (!s.key) return rows;
    var dir = s.dir === "asc" ? 1 : -1;
    return rows.slice().sort(function (a, b) {
      var x = a[s.key], y = b[s.key];
      if (s.key === "category") return dir * String(x).localeCompare(String(y));
      var xn = typeof x === "number", yn = typeof y === "number";
      if (!xn && !yn) return 0;
      if (!xn) return 1;   // blanks always sink to the bottom
      if (!yn) return -1;
      return dir * (x - y);
    });
  }

  function renderTable(payload) {
    if (!payload) return;
    var q = el.search.value.trim().toLowerCase();
    var hideEmpty = el.hideEmpty.checked;
    var frag = document.createDocumentFragment();
    var shown = 0;

    SECTIONS.forEach(function (sec) {
      var rows = payload.rows.filter(function (r) {
        if (r.section !== sec.key || r.is_total) return false;
        if (q && r.category.toLowerCase().indexOf(q) === -1) return false;
        if (hideEmpty && isEmptyRow(r)) return false;
        return true;
      });
      var total = q ? null : payload.rows.filter(function (r) {
        return r.section === sec.key && r.is_total;
      })[0];
      if (!rows.length && !total) return;

      var head = document.createElement("tr");
      head.className = "section-head";
      var label = document.createElement("td");
      label.textContent = sec.label;
      head.appendChild(label);
      var rest = document.createElement("td");
      rest.colSpan = COLS.length;
      head.appendChild(rest);
      frag.appendChild(head);

      sortRows(rows).forEach(function (r) { frag.appendChild(renderRow(r)); shown++; });
      if (total) frag.appendChild(renderRow(total));
    });

    if (!q) {
      payload.rows.forEach(function (r) {
        if (r.section === "all" && r.is_total) {
          var tr = renderRow(r);
          tr.classList.add("grand");
          frag.appendChild(tr);
        }
      });
    }

    el.tbody.innerHTML = "";
    el.tbody.appendChild(frag);
    el.rowCount.textContent = shown + (shown === 1 ? " category" : " categories") + (q ? " match" : "");

    if (!shown) {
      showNotice("No categories match \u201c" + el.search.value + "\u201d",
        "Try a shorter word, or turn off \u201cHide empty rows\u201d.");
    } else {
      el.notice.hidden = true;
    }
  }

  function renderRow(r) {
    var tr = document.createElement("tr");
    if (r.is_total) tr.classList.add("total");
    var first = document.createElement("td");
    first.textContent = r.category;
    first.title = r.category;
    if (r.is_total) { first.setAttribute("scope", "row"); }
    tr.appendChild(first);
    COLS.forEach(function (c) {
      var td = document.createElement("td");
      var v = r[c.key];
      td.textContent = fmt(v, c);
      var cls = cellClass(v, c);
      if (cls) td.classList.add(cls);
      if (c.secondary) td.classList.add("col-secondary");
      if (c.dollars) td.classList.add("dollars-start");
      tr.appendChild(td);
    });
    return tr;
  }

  function renderAll() {
    var payload = state.data[state.current];
    if (!payload) return;
    renderSummary(payload);
    renderTable(payload);
    renderStatus();
  }

  // ---------- flow ----------

  function selectLocation(key) {
    if (state.current !== key) { state.sort = { key: null, dir: null }; renderSortState(); }
    state.current = key;
    if (location.hash !== "#" + key) history.replaceState(null, "", "#" + key);
    renderLocations();
    renderStatus();
    document.title = "Budget OS \u2014 " + ((findLocation(key) || {}).label || "");
    showLoading();
    setBusy(true);
    loadLocation(key).then(function () {
      renderAll();
    }).catch(function (err) {
      el.tbody.innerHTML = "";
      [el.fYtd, el.fEst, el.fBudget, el.fVariance].forEach(function (n) { n.textContent = "\u2014"; });
      showNotice("No data for " + ((findLocation(key) || {}).label || "this location") + " yet",
        "It will appear once the publisher has run on the office PC. (" + err.message + ")", true);
    }).finally(function () { setBusy(false); });
  }

  function refresh(userTriggered) {
    if (userTriggered) setBusy(true);
    return loadIndex().then(function () {
      var entry = findLocation(state.current);
      if (userTriggered || (entry && entry.updated_at !== state.updatedAt[state.current])) {
        return loadLocation(state.current, userTriggered).then(renderAll);
      }
      renderStatus();
    }).catch(function (err) {
      if (userTriggered) showNotice("Couldn\u2019t refresh", err.message, true);
    }).finally(function () { if (userTriggered) setBusy(false); });
  }

  function init() {
    renderHeads();
    if (window.matchMedia("(min-width: 1024px)").matches) el.allCols.checked = true;
    el.table.classList.toggle("show-all", el.allCols.checked);
    el.tbody.appendChild(skeletonRows(8));

    el.search.addEventListener("input", function () { renderTable(state.data[state.current]); });
    el.hideEmpty.addEventListener("change", function () { renderTable(state.data[state.current]); });
    el.allCols.addEventListener("change", function () {
      el.table.classList.toggle("show-all", el.allCols.checked);
    });
    el.refresh.addEventListener("click", function () { refresh(true); });
    window.addEventListener("hashchange", function () {
      var key = location.hash.slice(1);
      if (key && key !== state.current && findLocation(key)) selectLocation(key);
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && state.current) refresh(false);
    });

    loadIndex().then(function (idx) {
      var wanted = location.hash.slice(1);
      var first = idx.locations.length ? idx.locations[0].key : null;
      if (!first) {
        setBusy(false);
        showNotice("No locations published yet", "Run the publisher on the office PC to get started.");
        return;
      }
      selectLocation(findLocation(wanted) ? wanted : first);
      setInterval(function () { refresh(false); }, POLL_MS);
    }).catch(function (err) {
      setBusy(false);
      el.tbody.innerHTML = "";
      showNotice("Couldn\u2019t load the location list", err.message + ". Reload to try again.", true);
    });
  }

  init();
})();
