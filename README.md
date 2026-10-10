# LEAP 交互式细胞谱系树（静态版）

**纯静态站点**，可直接用 GitHub Pages 公开托管，无需服务器、无需任何运行时。
交互（缩放 / 平移 / 框选 / 双击选子树 / 颜色图例联动 / 饼图 / 表格）全部在前端用
D3 + Plotly + DataTables 实现。

> 本文件夹 `LEAP_web/` 是一个**自包含、可独立发布**的项目，建议作为独立仓库推送到 GitHub。

## 目录结构

```
LEAP_web/
├─ docs/                 # ← 静态站点根目录（GitHub Pages 从这里发布）
│  ├─ index.html
│  ├─ css/style.css
│  ├─ js/app.js
│  ├─ data/              # 站点数据（JSON：数据集 + 颜色表 + 清单）
│  ├─ vendor/            # 内置前端库（离线自包含，无外部 CDN 依赖）
│  └─ .nojekyll          # 关闭 Jekyll 处理，保证原样发布
├─ .gitignore
└─ README.md
```

## 本地预览

静态站需通过 HTTP 打开（直接双击 `index.html` 会因浏览器 `file://` 跨域限制无法读取 JSON）。
任选一种本地服务器，根目录指向 `docs/`：

```powershell
# 方式 A：Python
cd docs; python -m http.server 8000
# 浏览器打开 http://localhost:8000

# 方式 B：Node
npx serve docs

# 方式 C：任意静态服务器，把站点根设为 docs/
```

## 发布到 GitHub Pages（让别人也能访问）

站点在 `docs/`，用 GitHub 自带的“从分支部署”即可，**零配置、无需 Actions**。

1. 在 GitHub 新建一个**公开**仓库（Public），例如 `LEAP-web`。
2. 进入本文件夹 `LEAP_web/` 初始化并推送：
   ```powershell
   cd LEAP_web
   git init
   git add .
   git commit -m "LEAP static site"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/LEAP-web.git
   git push -u origin main
   ```
3. 打开仓库 **Settings → Pages**：
   - Source 选 **Deploy from a branch**
   - Branch 选 **main**，目录选 **/docs**，点 **Save**
4. 约 1 分钟后，公开地址即：
   `https://<你的用户名>.github.io/LEAP-web/`

> 站点全部使用相对路径（`./data/...`、`./vendor/...`），挂在项目子路径 `/<repo>/` 下也能正常工作。
