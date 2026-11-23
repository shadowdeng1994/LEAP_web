/* LEAP 交互式细胞谱系树 —— 静态版
 * 交互：滚轮缩放 / 拖动平移 / Shift 框选 / 单击切换 /
 * 双击选子树 / 颜色图例联动(Tip/Internal/两者/Internal+子节点, 换色) / 置灰 /
 * 选中节点表格 + Tip/Internal 的 CellType 占比饼图。
 * 数据来自 ./data/<species>/<database>/*.json。
 */
(function () {
  "use strict";

  var DATA = "./data/";
  var GRAY = "grey50";
  var FALLBACK = "#B0B0B0";

  // ---- 全局状态 ----
  var state = {
    // 目录结构：Species -> Database -> [Dataset, ...]
    speciesList: [], speciesId: "", speciesName: "",
    databases: [], databaseId: "", databaseName: "",
    datasets: [],
    reqSeq: 0,             // 异步请求序号，用于丢弃过期响应
    colorMap: {},          // CellType -> 默认颜色（有序）
    overrides: {},         // 换色覆盖 CellType -> #hex
    gray: false,
    logTrans: 0,
    // 当前数据集
    name: "", n: 0, nTips: 0, rootIdx: -1, maxDepth: 0,
    node: null, parent: null, label: null, isTip: null,
    x: null, y: null, col: null, tipAnn: null, branchLen: null, parentLabel: null,
    angle: null, r: null, bx: null, by: null, _xr: null,
    byId: null, children: null, labelIndex: null, labelToAnn: null,
    idxArray: null,
    // 视图
    R: 200, t: null,
    // 选择
    selected: new Set(),
    // 图例
    legendColor: null, legendMode: 1,
    // 交互
    box: null, downPos: null,
    dt: null, piesReady: false, accOpen: false
  };

  // ---- DOM ----
  var $ = function (id) { return document.getElementById(id); };
  var treeBody, treeStage, svgNode, viewport, overlay, tooltip;
  var svgSel, viewportSel;

  // =========================================================================
  // 工具
  // =========================================================================
  function colorBase(c) {
    return state.overrides[c] || state.colorMap[c] || FALLBACK;
  }
  function circleColor(c) { return state.gray ? GRAY : colorBase(c); }

  function parseAnn(a) {
    if (!a) return { ct: "(unlabeled)", stage: null };
    var li = a.lastIndexOf("|"), fi = a.indexOf("|");
    var ct = li < 0 ? a : a.slice(li + 1);
    var stage = fi < 0 ? null : a.slice(0, fi);
    return { ct: ct, stage: stage };
  }

  function arcPoint(r, a) {
    var sa = a - Math.PI / 2;
    return { x: r * Math.cos(sa), y: r * Math.sin(sa) };
  }

  // 从 startIdx 出发的整棵子树（含自身）的 label 数组
  function descendantLabels(startIdx) {
    if (startIdx == null || startIdx < 0) return [];
    var out = [], stack = [startIdx];
    while (stack.length) {
      var i = stack.pop();
      out.push(state.label[i]);
      var ch = state.children[i];
      if (ch) for (var k = 0; k < ch.length; k++) stack.push(ch[k]);
    }
    return out;
  }

  // =========================================================================
  // 几何布局
  // =========================================================================
  function computeLayout() {
    var s = state.logTrans, R = state.R, n = state.n;
    var rmin = 0, rmax = state.maxDepth;
    if (s > 0) {
      var off = Math.pow(10, -s), mn = Infinity, mx = -Infinity;
      for (var i = 0; i < n; i++) {
        var xr = Math.log10(state.x[i] + off);
        state._xr[i] = xr;
        if (xr < mn) mn = xr;
        if (xr > mx) mx = xr;
      }
      rmin = mn; rmax = mx;
    }
    var span = (rmax - rmin) || 1;
    for (var j = 0; j < n; j++) {
      var r = s > 0 ? (state._xr[j] - rmin) / span * R : state.x[j] / (state.maxDepth || 1) * R;
      state.r[j] = r;
      var sa = state.angle[j] - Math.PI / 2;
      state.bx[j] = r * Math.cos(sa);
      state.by[j] = r * Math.sin(sa);
    }
  }

  function branchPath(i) {
    var p = state.byId[state.parent[i]];
    var rp = state.r[p], rn = state.r[i];
    var ap = state.angle[p], an = state.angle[i];
    var tip = arcPoint(rn, an);
    if (rp < 1e-9) return "M0,0L" + tip.x + "," + tip.y;
    var a1 = arcPoint(rp, ap), a2 = arcPoint(rp, an);
    var dA = an - ap;
    var large = Math.abs(dA) > Math.PI ? 1 : 0;
    var sweep = dA > 0 ? 1 : 0;
    return "M" + a1.x + "," + a1.y +
           "A" + rp + "," + rp + " 0 " + large + " " + sweep + " " + a2.x + "," + a2.y +
           "L" + tip.x + "," + tip.y;
  }

  // =========================================================================
  // 场景构建 / 更新
  // =========================================================================
  // 节点形状：terminal node = 三角形，internal node = 圆形
  var SYM_CIRCLE = d3.symbol().type(d3.symbolCircle).size(16);
  var SYM_TRI = d3.symbol().type(d3.symbolTriangle).size(24);
  function symbolD(i) { return state.isTip[i] ? SYM_TRI() : SYM_CIRCLE(); }
  function nodeTransform(i) {
    var s = state.selected.has(state.label[i]) ? 1.7 : 1;
    return "translate(" + state.bx[i] + "," + state.by[i] + ") scale(" + s + ")";
  }

  function buildScene() {
    viewportSel.selectAll("*").remove();
    var nonRoot = state.idxArray.filter(function (i) { return i !== state.rootIdx; });

    viewportSel.append("g").attr("class", "branches")
      .selectAll("path").data(nonRoot).join("path")
      .attr("class", "branch");

    viewportSel.append("g").attr("class", "nodes")
      .selectAll("path").data(state.idxArray).join("path")
      .attr("class", "node")
      .attr("d", symbolD)
      .attr("fill", function (i) { return circleColor(state.col[i]); })
      .attr("transform", nodeTransform)
      .on("mouseover", function (ev, i) {
        if (!this.classList.contains("selected")) d3.select(this).attr("fill", "#F1C40F");
        showTooltip(ev, i);
      })
      .on("mousemove", function (ev) { moveTooltip(ev); })
      .on("mouseout", function (ev, i) {
        if (!this.classList.contains("selected")) d3.select(this).attr("fill", circleColor(state.col[i]));
        hideTooltip();
      })
      .on("click", function (ev, i) {
        ev.stopPropagation();
        if (state.downPos && (Math.abs(ev.clientX - state.downPos.x) > 4 ||
                              Math.abs(ev.clientY - state.downPos.y) > 4)) return;
        toggleSelect(state.label[i]);
        clearLegendActive();
      })
      .on("dblclick", function (ev, i) {
        ev.stopPropagation(); ev.preventDefault();
        setSelection(descendantLabels(i));
        clearLegendActive();
      });
  }

  function updatePositions() {
    viewportSel.select(".branches").selectAll("path").attr("d", branchPath);
    viewportSel.select(".nodes").selectAll("path").attr("transform", nodeTransform);
  }

  function updateColors() {
    viewportSel.select(".nodes").selectAll("path")
      .attr("fill", function (i) {
        return this.classList.contains("selected") ? "#E74C3C" : circleColor(state.col[i]);
      });
  }

  // =========================================================================
  // 选择
  // =========================================================================
  function setSelection(labels) {
    state.selected = new Set(labels);
    applySelection();
  }
  function toggleSelect(label) {
    if (state.selected.has(label)) state.selected.delete(label);
    else state.selected.add(label);
    applySelection();
  }
  function selectedIndices() {
    var out = [];
    state.selected.forEach(function (lb) {
      var i = state.labelIndex[lb];
      if (i != null) out.push(i);
    });
    return out;
  }
  function applySelection() {
    var nodes = viewportSel.select(".nodes").selectAll("path")
      .classed("selected", function (i) { return state.selected.has(state.label[i]); })
      .attr("fill", function (i) {
        return state.selected.has(state.label[i]) ? "#E74C3C" : circleColor(state.col[i]);
      })
      .attr("transform", nodeTransform);
    // 把选中的节点提到最上层，避免被相邻节点遮挡
    nodes.filter(function (i) { return state.selected.has(state.label[i]); }).raise();
    if (state.accOpen) { updateTable(); updatePies(); }
  }

  // =========================================================================
  // Tooltip
  // =========================================================================
  function showTooltip(ev, i) {
    tooltip.innerHTML = "<b>Node:</b> " + esc(state.label[i]) +
                        "<br><b>Type:</b> " + esc(state.tipAnn[i] || "");
    tooltip.style.display = "block";
    moveTooltip(ev);
  }
  function moveTooltip(ev) {
    var br = treeBody.getBoundingClientRect();
    var x = ev.clientX - br.left + 14, y = ev.clientY - br.top + 14;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }
  function hideTooltip() { tooltip.style.display = "none"; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // =========================================================================
  // 缩放 / 平移 / 框选
  // =========================================================================
  function setupZoom() {
    state.zoom = d3.zoom()
      .scaleExtent([0.25, 50])
      .filter(function (ev) {
        if (ev.type === "wheel") return true;
        if (ev.type === "mousedown" || ev.type === "touchstart") return !ev.shiftKey;
        return true;
      })
      .on("zoom", function (ev) {
        state.t = ev.transform;
        viewportSel.attr("transform", ev.transform);
      });
    svgSel.call(state.zoom).on("dblclick.zoom", null);
  }
  function centerView() {
    var w = treeStage.clientWidth, h = treeStage.clientHeight;
    state.t = d3.zoomIdentity.translate(w / 2, h / 2);
    svgSel.call(state.zoom.transform, state.t);
  }

  function setupBoxSelect() {
    treeStage.addEventListener("mousedown", function (e) {
      if (e.button !== 0 || !e.shiftKey) return;
      e.preventDefault(); e.stopPropagation();
      state.box = { active: true, moved: false, sx: e.clientX, sy: e.clientY };
      overlay.style.display = "block";
      overlay.style.left = "0px"; overlay.style.top = "0px";
      overlay.style.width = "0px"; overlay.style.height = "0px";
    }, true);

    window.addEventListener("mousemove", function (e) {
      if (!state.box || !state.box.active) return;
      var br = treeBody.getBoundingClientRect();
      var x = Math.min(e.clientX, state.box.sx), y = Math.min(e.clientY, state.box.sy);
      var w = Math.abs(e.clientX - state.box.sx), h = Math.abs(e.clientY - state.box.sy);
      if (w > 3 || h > 3) state.box.moved = true;
      overlay.style.left = (x - br.left) + "px";
      overlay.style.top = (y - br.top) + "px";
      overlay.style.width = w + "px";
      overlay.style.height = h + "px";
    }, true);

    window.addEventListener("mouseup", function (e) {
      if (!state.box || !state.box.active) return;
      var moved = state.box.moved, sx = state.box.sx, sy = state.box.sy;
      state.box.active = false;
      overlay.style.display = "none";
      if (!moved) return;
      var minX = Math.min(sx, e.clientX), maxX = Math.max(sx, e.clientX);
      var minY = Math.min(sy, e.clientY), maxY = Math.max(sy, e.clientY);
      var sr = svgNode.getBoundingClientRect(), t = state.t;
      var ids = [];
      for (var i = 0; i < state.n; i++) {
        var cx = sr.left + t.applyX(state.bx[i]);
        var cy = sr.top + t.applyY(state.by[i]);
        if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) ids.push(state.label[i]);
      }
      setSelection(ids);
      clearLegendActive();
    }, true);

    // 记录按下位置（用于区分点击与拖动）
    treeStage.addEventListener("mousedown", function (e) {
      state.downPos = { x: e.clientX, y: e.clientY };
    }, true);

    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { setSelection([]); clearLegendActive(); }
    });
  }

  // =========================================================================
  // 颜色图例
  // =========================================================================
  function buildLegend() {
    var present = {};
    for (var i = 0; i < state.n; i++) if (state.col[i]) present[state.col[i]] = true;

    var cols = Object.keys(state.colorMap).filter(function (c) { return present[c]; });
    Object.keys(present).forEach(function (c) { if (cols.indexOf(c) < 0) cols.push(c); });

    var annByCol = {};
    for (var j = 0; j < state.n; j++) {
      var c = state.col[j]; if (!c) continue;
      var a = state.tipAnn[j]; if (!a) continue;
      (annByCol[c] = annByCol[c] || {})[a] = true;
    }

    var host = $("colorLegendUI");
    host.innerHTML = "";
    cols.forEach(function (c) {
      var ann = Object.keys(annByCol[c] || {}).sort().join(", ");
      var row = document.createElement("div");
      row.className = "leap-legend-row";
      row.setAttribute("data-color", c);

      var sw = document.createElement("input");
      sw.type = "color";
      sw.className = "leap-color-picker";
      sw.setAttribute("data-color", c);
      sw.value = toHex6(colorBase(c));
      sw.title = "Click to recolor (pick a color or enter a #hex)";
      sw.addEventListener("click", function (e) { e.stopPropagation(); });
      sw.addEventListener("change", function () {
        state.overrides[c] = sw.value;
        updateColors();
      });

      var txt = document.createElement("div");
      txt.className = "leap-legend-text";
      var nm = document.createElement("span"); nm.className = "leap-legend-name"; nm.textContent = c;
      var an = document.createElement("span"); an.className = "leap-legend-ann"; an.textContent = ann;
      txt.appendChild(nm); txt.appendChild(an);

      var mode = document.createElement("span"); mode.className = "leap-legend-mode";

      row.appendChild(sw); row.appendChild(txt); row.appendChild(mode);
      row.addEventListener("click", function () { legendClick(c); });
      host.appendChild(row);
    });
    state.legendColor = null; state.legendMode = 1;
  }
  function toHex6(col) {
    if (/^#[0-9a-fA-F]{6}$/.test(col)) return col;
    if (/^#[0-9a-fA-F]{3}$/.test(col)) {
      return "#" + col[1] + col[1] + col[2] + col[2] + col[3] + col[3];
    }
    return "#b0b0b0";
  }
  function legendClick(color) {
    if (color === state.legendColor) state.legendMode = state.legendMode % 4 + 1;
    else { state.legendColor = color; state.legendMode = 1; }
    var mode = state.legendMode;
    updateLegendActive(color, mode);

    var ids = [];
    if (mode === 1) {
      for (var i = 0; i < state.n; i++) if (state.col[i] === color && state.isTip[i]) ids.push(state.label[i]);
    } else if (mode === 2) {
      for (var a = 0; a < state.n; a++) if (state.col[a] === color && !state.isTip[a]) ids.push(state.label[a]);
    } else if (mode === 4) {
      var seen = new Set();
      for (var b = 0; b < state.n; b++) {
        if (state.col[b] === color && !state.isTip[b]) {
          descendantLabels(b).forEach(function (l) { seen.add(l); });
        }
      }
      ids = Array.from(seen);
    } else {
      for (var c2 = 0; c2 < state.n; c2++) if (state.col[c2] === color) ids.push(state.label[c2]);
    }
    setSelection(ids);
  }
  function updateLegendActive(color, mode) {
    var rows = document.querySelectorAll(".leap-legend-row");
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], m = r.querySelector(".leap-legend-mode");
      if (color && r.getAttribute("data-color") === color) {
        r.classList.add("active");
        if (m) m.textContent = mode === 1 ? "Tip" : mode === 2 ? "Internal" : mode === 3 ? "Tip+Internal" : "Internal+Desc";
      } else {
        r.classList.remove("active");
        if (m) m.textContent = "";
      }
    }
  }
  function clearLegendActive() {
    state.legendColor = null; state.legendMode = 1;
    updateLegendActive(null, 1);
  }

  // =========================================================================
  // 表格 (DataTables)
  // =========================================================================
  function initTable() {
    if (state.dt) return;
    state.dt = jQuery("#selectedNodesTable").DataTable({
      pageLength: 10,
      lengthMenu: [10, 25, 50, 100],
      scrollX: true,
      dom: "lfrtip",
      order: [],
      language: { emptyTable: "Tip: Shift + drag to box-select, double-click to select a subtree, or click a color in the legend to select by cell type. Selected nodes appear here." }
    });
  }
  function updateTable() {
    if (!state.dt) return;
    var idx = selectedIndices();
    var rows = idx.map(function (i) {
      var pa = state.labelToAnn[state.parentLabel[i]] || "";
      return [
        state.node[i], state.label[i], state.isTip[i] ? "TRUE" : "FALSE",
        state.tipAnn[i], state.x[i], state.branchLen[i],
        state.parentLabel[i], pa
      ];
    });
    state.dt.clear().rows.add(rows).draw(false);
  }

  // =========================================================================
  // 饼图 (Plotly)
  // =========================================================================
  function initPies() {
    if (state.piesReady) return;
    Plotly.newPlot("pieTip", [], emptyLayout("Cell type distribution (selected tips)"), pieCfg());
    Plotly.newPlot("pieInternal", [], emptyLayout("Cell type distribution (internal nodes)"), pieCfg());
    state.piesReady = true;
  }
  function pieCfg() { return { displayModeBar: false, responsive: true }; }
  function emptyLayout(title) {
    return {
      title: { text: title, font: { size: 13 } }, margin: { l: 10, r: 10, t: 34, b: 10 },
      annotations: [{ text: "No data", showarrow: false, xref: "paper", yref: "paper", x: 0.5, y: 0.5, font: { size: 14, color: "#999" } }]
    };
  }
  function updatePies() {
    if (!state.piesReady) return;
    var idx = selectedIndices();
    var tips = idx.filter(function (i) { return state.isTip[i]; });
    var ints = idx.filter(function (i) { return !state.isTip[i]; });
    drawPie("pieTip", tips, "Cell type distribution (selected tips)", false);
    drawPie("pieInternal", ints, "Cell type distribution (internal nodes)", true);
  }
  function drawPie(divId, idx, title, stageBreakdown) {
    if (!idx.length) {
      Plotly.react(divId, [], emptyLayout(title), pieCfg());
      return;
    }
    var counts = {}, stageByCt = {}, total = 0;
    idx.forEach(function (i) {
      var p = parseAnn(state.tipAnn[i]);
      counts[p.ct] = (counts[p.ct] || 0) + 1; total++;
      if (p.stage) { (stageByCt[p.ct] = stageByCt[p.ct] || {})[p.stage] = (stageByCt[p.ct][p.ct] || 0) + 1; }
    });
    var cts = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var values = cts.map(function (c) { return counts[c]; });
    var colors = cts.map(function (c) { return colorBase(c); });
    var textinfo = cts.length <= 12 ? "label+percent" : "none";

    var trace = {
      type: "pie", labels: cts, values: values, textinfo: textinfo,
      textposition: "inside", showlegend: false, marker: { colors: colors }
    };
    if (stageBreakdown) {
      trace.hovertext = cts.map(function (ct) {
        var N = counts[ct], pct = (N / total * 100).toFixed(1);
        var st = stageByCt[ct] || {};
        var lines = Object.keys(st).sort(function (a, b) { return st[b] - st[a]; })
          .map(function (s) { return "&nbsp;&nbsp;&nbsp;&nbsp;" + s + ": " + (st[s] / N * 100).toFixed(1) + "%"; })
          .join("<br>");
        return "<b>" + ct + "</b><br>Count: " + N + "<br>Share: " + pct + "%" + (lines ? "<br>" + lines : "");
      });
      trace.hoverinfo = "text";
    } else {
      trace.hovertemplate = "%{label}<br>Count: %{value}<br>Share: %{percent}<extra></extra>";
    }
    Plotly.react(divId, [trace], {
      title: { text: title, font: { size: 13 } }, margin: { l: 10, r: 10, t: 34, b: 10 }, showlegend: false
    }, pieCfg());
  }

  // =========================================================================
  // 数据加载（Species -> Database -> Dataset）
  // =========================================================================
  // 数据来源：优先读取内嵌数据（本地单文件版 window.__LEAP_DATA__），
  // 否则回退到 fetch ./data/<species>/<database>/*.json（GitHub Pages 版）。
  //   key = "index"   -> 物种 / 数据库 / 数据集清单
  //   key = "colors"  -> 当前 Database 的配色
  //   其他 key        -> 当前 Database 下的某个 Dataset
  function normalizeIndex(index) {
    var list = (index && index.species) ? index.species : [];
    list.forEach(function (sp) {
      sp.id = sp.id || sp.name;
      sp.name = sp.name || sp.id;
      sp.databases = sp.databases || [];
      sp.databases.forEach(function (db) {
        db.id = db.id || db.name;
        db.name = db.name || db.id;
        db.datasets = db.datasets || [];
      });
    });
    return list;
  }

  function dataDir(speciesId, databaseId) {
    return DATA + encodeURIComponent(speciesId) + "/" + encodeURIComponent(databaseId) + "/";
  }

  function fetchJSON(key, speciesId, databaseId) {
    var emb = window.__LEAP_DATA__;
    if (emb) {
      if (key === "index") return Promise.resolve(emb.index);
      var ck = speciesId + "/" + databaseId;
      if (key === "colors") return Promise.resolve((emb.colors || {})[ck] || {});
      var dk = ck + "/" + key;
      if (emb.datasets && emb.datasets[dk]) return Promise.resolve(emb.datasets[dk]);
    }
    var url = key === "index" ? DATA + "index.json"
            : key === "colors" ? dataDir(speciesId, databaseId) + "colors.json"
            : dataDir(speciesId, databaseId) + encodeURIComponent(key) + ".json";
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " - " + url);
      return r.json();
    });
  }

  function loadDataset(name) {
    var seq = ++state.reqSeq;
    var sp = state.speciesId, db = state.databaseId;
    fetchJSON(name, sp, db)
      .then(function (d) {
        if (seq !== state.reqSeq) return;
        applyDataset(d);
      })
      .catch(function (e) {
        if (seq !== state.reqSeq) return;
        alert("Failed to load dataset: " + sp + "/" + db + "/" + name + "\n" + e);
      });
  }

  function fillSelect(sel, values, selected) {
    sel.innerHTML = "";
    values.forEach(function (v) {
      var o = document.createElement("option");
      o.value = typeof v === "string" ? v : v.id;
      o.textContent = typeof v === "string" ? v : v.name;
      sel.appendChild(o);
    });
    if (values.length) {
      var ids = values.map(function (v) { return typeof v === "string" ? v : v.id; });
      sel.value = selected != null && ids.indexOf(selected) >= 0 ? selected : ids[0];
    }
    sel.disabled = values.length === 0;
  }

  function loadSpecies(id) {
    state.reqSeq++;
    var sp = state.speciesList.filter(function (s) { return s.id === id; })[0] || null;
    state.speciesId = sp ? sp.id : "";
    state.speciesName = sp ? sp.name : "";
    state.databases = sp ? (sp.databases || []) : [];
    fillSelect($("selected_database"), state.databases, null);
    if (state.databases.length) {
      loadDatabase(state.databases[0].id);
    } else {
      state.databaseId = ""; state.databaseName = ""; state.datasets = [];
      fillSelect($("selected_dataset"), [], null);
      state.colorMap = {};
      buildLegend();
    }
  }

  function loadDatabase(id) {
    var seq = ++state.reqSeq;
    var db = state.databases.filter(function (d) { return d.id === id; })[0] || null;
    state.databaseId = db ? db.id : "";
    state.databaseName = db ? db.name : "";
    state.datasets = db ? (db.datasets || []) : [];
    fillSelect($("selected_dataset"), state.datasets, null);
    if (!state.datasets.length) {
      state.colorMap = {};
      buildLegend();
      return;
    }
    var sp = state.speciesId;
    fetchJSON("colors", sp, state.databaseId)
      .then(function (cm) {
        if (seq !== state.reqSeq) return;
        state.colorMap = cm || {};
        loadDataset(state.datasets[0]);
      })
      .catch(function (e) {
        if (seq !== state.reqSeq) return;
        state.colorMap = {};
        alert("Failed to load colours for database: " + sp + "/" + state.databaseId + "\n" + e);
        loadDataset(state.datasets[0]);
      });
  }

  function applyDataset(d) {
    state.name = d.name;
    state.n = d.nNodes; state.nTips = d.nTips;
    state.node = d.node; state.parent = d.parent; state.label = d.label;
    state.isTip = d.isTip; state.x = d.x; state.y = d.y;
    state.col = d.col; state.tipAnn = d.tipAnn;
    state.branchLen = d.branchLen || new Array(d.nNodes).fill(0);
    state.parentLabel = d.parentLabel || new Array(d.nNodes).fill("");

    state.angle = new Array(state.n);
    state.r = new Array(state.n); state.bx = new Array(state.n); state.by = new Array(state.n);
    state._xr = new Array(state.n);
    state.byId = {}; state.labelIndex = {}; state.labelToAnn = {};
    state.children = new Array(state.n);
    state.idxArray = new Array(state.n);
    state.maxDepth = 0; state.rootIdx = -1;

    for (var i = 0; i < state.n; i++) {
      state.idxArray[i] = i;
      state.byId[state.node[i]] = i;
      state.labelIndex[state.label[i]] = i;
      state.labelToAnn[state.label[i]] = state.tipAnn[i];
      state.angle[i] = (state.y[i] - 0.5) / state.nTips * 2 * Math.PI;
      if (state.x[i] > state.maxDepth) state.maxDepth = state.x[i];
      if (state.parent[i] === state.node[i]) state.rootIdx = i;
    }
    for (var c = 0; c < state.n; c++) {
      if (c !== state.rootIdx) {
        var p = state.byId[state.parent[c]];
        (state.children[p] = state.children[p] || []).push(c);
      }
    }
    if (state.rootIdx < 0) state.rootIdx = 0;

    state.overrides = {};
    state.selected = new Set();

    sizeStage();
    computeLayout();
    buildScene();
    updatePositions();
    updateColors();
    centerView();
    buildLegend();
    if (state.accOpen) { updateTable(); updatePies(); }
  }

  function sizeStage() {
    var w = treeStage.clientWidth, h = treeStage.clientHeight;
    svgSel.attr("width", w).attr("height", h);
    state.R = Math.max(50, Math.min(w, h) / 2 - 20);
  }

  // =========================================================================
  // 初始化
  // =========================================================================
  function init() {
    treeBody = $("treeBody");
    treeStage = $("treeGirafe");
    overlay = $("boxOverlay");
    tooltip = $("tooltip");
    // 把遮罩放进 tree-stage，坐标与 svg 对齐
    treeStage.appendChild(overlay);

    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    treeStage.appendChild(svg);
    svgNode = svg;
    svgSel = d3.select(svg);
    viewport = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.appendChild(viewport);
    viewportSel = d3.select(viewport);

    setupZoom();
    setupBoxSelect();

    // 控件
    $("tree_gray").addEventListener("change", function (e) {
      state.gray = e.target.checked; updateColors();
    });
    $("LogTrans").addEventListener("input", function (e) {
      state.logTrans = parseFloat(e.target.value);
      $("LogTransVal").textContent = e.target.value;
      computeLayout(); updatePositions();
    });
    $("resetSelection").addEventListener("click", function () {
      setSelection([]); clearLegendActive();
    });
    $("selected_species").addEventListener("change", function (e) {
      loadSpecies(e.target.value);
    });
    $("selected_database").addEventListener("change", function (e) {
      loadDatabase(e.target.value);
    });
    $("selected_dataset").addEventListener("change", function (e) {
      loadDataset(e.target.value);
    });
    $("accToggle").addEventListener("click", function () { toggleAccordion(); });

    window.addEventListener("resize", function () {
      sizeStage(); computeLayout(); updatePositions(); centerView();
      if (state.accOpen && state.piesReady) {
        Plotly.Plots.resize("pieTip"); Plotly.Plots.resize("pieInternal");
      }
    });

    // 载入物种 / 数据库 / 数据集清单
    fetchJSON("index").then(function (index) {
      state.speciesList = normalizeIndex(index);
      if (!state.speciesList.length) throw new Error("no species found in data/index.json");
      fillSelect($("selected_species"), state.speciesList, null);
      loadSpecies(state.speciesList[0].id);
    }).catch(function (e) {
      alert("Initialization failed (could not load data/index.json):\n" + e);
    });
  }

  function toggleAccordion() {
    state.accOpen = !state.accOpen;
    var acc = $("table_accordion"), body = $("accBody"), btn = $("accToggle");
    acc.classList.toggle("open", state.accOpen);
    body.hidden = !state.accOpen;
    btn.setAttribute("aria-expanded", String(state.accOpen));
    if (state.accOpen) {
      initTable(); initPies();
      setTimeout(function () {
        if (state.dt) state.dt.columns.adjust();
        if (state.piesReady) { Plotly.Plots.resize("pieTip"); Plotly.Plots.resize("pieInternal"); }
        updateTable(); updatePies();
      }, 60);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
