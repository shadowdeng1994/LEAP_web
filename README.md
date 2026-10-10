# LEAP Interactive Cell Lineage Tree

An interactive, in-browser visualization of zebrafish **cell lineage trees**. Each tree
shows how individual cells relate across development, with every node colored by its
cell type. Explore the lineage, select cells in several ways, and instantly see how the
cell-type composition of your selection is distributed.

**Live demo:** https://shadowdeng1994.github.io/LEAP_web/

No installation or login required — everything runs locally in your browser.

---

## Features

- **30 lineage trees** to choose from (e.g. `ZF_1.HMF1` … `ZF_15.HMF2`), switchable from a dropdown.
- **Circular lineage tree** with nodes colored by cell type; hover any node for its name and annotation.
- **Smooth zoom & pan** — scroll to zoom, drag to pan.
- **Multiple ways to select cells** — click, box-select, double-click a subtree, or select by cell type from the legend.
- **Interactive color legend** — select all cells of a given type in one click, and even recolor types on the fly.
- **Live cell-type distribution** — pie charts update instantly to show the composition of your selection.
- **Detailed data table** of the selected nodes with search, sorting and pagination.
- **Display options** — grayscale mode and a log-transform of branch depth.

---

## How to use

### 1. Choose a tree
Use the **dataset dropdown** in the left sidebar to load a different lineage tree.

### 2. Navigate
- **Zoom:** scroll the mouse wheel.
- **Pan:** click and drag the background.
- **Inspect a node:** hover over it to see its name and annotation in a tooltip.

### 3. Select cells
There are several ways to build a selection (all of them update the table and pie charts below):

| Action | Result |
| --- | --- |
| **Click** a node | Toggle that single node in / out of the selection |
| **Shift + drag** | Draw a rectangle to box-select every node inside it |
| **Double-click** a node | Select that node **and all of its descendants** (the whole subtree) |
| **Esc** key or the **Cancel selection** button | Clear the current selection |

Selected nodes are highlighted in red.

### 4. Use the color legend (select by cell type)
The left sidebar lists every color and the cell type(s) it represents.

- **Click a legend name** to select all cells of that color. Clicking repeatedly **cycles** through four modes:
  1. **Tip** — only terminal cells (tips) of that type
  2. **Internal** — only internal nodes of that type
  3. **Tip + Internal** — all nodes of that type
  4. **Internal + Desc** — internal nodes of that type **plus all of their descendants**
- **Click the color swatch** to open a color picker and recolor that cell type in the tree.

### 5. Inspect your selection
Open the **“Selected node details”** panel at the bottom:

- **Left — data table:** one row per selected node (`node`, `label`, `isTip`, `TipAnn`,
  `Depth`, `branch.length`, `ParentLabel`, `ParentAnn`), with search, column sorting and pagination.
- **Right — pie charts:** the **cell-type distribution** of your selection, shown separately for
  selected **tips** and selected **internal** nodes. Hover a slice for counts and percentages
  (the internal-node chart also breaks each type down by developmental stage, in hpf).

### 6. Display options
- **Grayscale:** toggle **“置灰显示 / Grayscale”** to render all nodes in gray (useful for focusing on tree shape).
- **Log-transform:** the slider applies a log transform (with a pseudocount offset) to branch depth,
  which compresses long branches and spreads out short ones.

---

## Notes

- The page is fully static and self-contained (D3 + Plotly + DataTables); it works offline once loaded.
- If the tree looks empty on first open, give it a moment to load the dataset.
