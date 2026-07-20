<!--
# AGENTS.md — BODR-Image-Prompt 项目顶层宪法 (mm7 实例)

> 本档 = BODR-Image-Prompt 项目在 mm7 上的"项目书 + 顶层宪法".
> 适用范围: BODR-Image-Prompt 项目内任何 agent (Codex / OpenClaw / 未来新平台) 接到该项目的任务时第一必读.
> 镜像: muse/data/bundles/okf-bundle/memory/ProjectBook/BODR-Image-Prompt.md (OKF 派发, 元数据 + 链本档).

[BODR-Image-Prompt 项目根]: /home/mm7/BODR-Image-Prompt/
[上游仓库]: https://github.com/yfxdwc/BODR-Image-Prompt
[mm7 端口]: 8880 (独立于 new6 8870)
[mm7 db]: BODR_CRM.db (项目内路径, mm7 owned)
[mm7 venv]: /home/mm7/.venvs/bodr/

变更约定: 改本档必须同步改 OKF 派发体; 反之亦然.
-->

---
name: BODR主站服务-web8870-bodr-web-service
description: "BODR 主站项目书 + mm7 端口/DB/venv 硬规。8880 独占,mm7 db 跟 new6 8870 完全独立,venv 单独建 .venvs/bodr,systemd 真自愈已落地。"
trigger: "BODR 主站, BODR 服务, 8880, bodr-web, BODR CRM, bodr 启动/停止/重启, bodr 端口冲突"
tags:
- bodr
- bodr-web
- web8880
- crm
- flask
- sqlite
- project-handbook
- mm7-port-registry
created: 2026-07-02
updated: 2026-07-02
category: code-execution
layer: L2
domain: bodr-web
type: Skill
agent_owner: main
security_class: internal
timestamp: 2026-07-02T14:30:00+08:00
---

# BODR 主站项目书 — mm7 8880 端口（2026-07-02 部署）

> **本 skill 是 BODR 主站在 mm7 上的"单一入口"**——BODR 在 mm7 这处就是这处。
> 收到任何 BODR 任务时**先读本 skill**，再按 SOP 走。

## 1. 项目定位（一句话）

**BODR 主站 (mm7 镜像)** = BODR CRM Web 系统的 mm7 副本。
Flask + SQLite + PIL + MiniMax image gen。**mm7 这份跟 new6 8870 镜像完全独立**（端口不同 + db 不同 + venv 不同）。

- **mm7 端口**：8880（0.0.0.0:8880）
- **new6 端口**：8870（0.0.0.0:8870）—— 跟 mm7 互不影响
- 数据库：mm7 副本 = 10MB BODR_CRM.db（mm7 owned），new6 副本独立
- venv：`/home/mm7/.venvs/bodr/`（flask 3.1.3 + pillow）

## 2. 工作目录 + 路径硬规

| 项 | 路径 |
|---|---|
| **项目根** | `/home/mm7/.openclaw/skills/BODR主站服务-web8870-bodr-web-service/` |
| **代码目录** | `code/`（含 app.py, db.py, image_gen.py） |
| **venv** | `/home/mm7/.venvs/bodr/`（独立 venv, 不跟 muse/openhands 混） |
| **数据库** | `/home/mm7/.openclaw/skills/BODR主站服务-web8870-bodr-web-service/code/BODR_CRM.db`（10MB, mm7 owned） |
| **ensure-alive** | `/home/mm7/.openclaw/deploy/bodr-web/ensure-alive.sh` |
| **systemd** | `~/.config/systemd/user/mm7-bodr-web.{service,timer}` |
| **logs** | `/home/mm7/.openclaw/deploy/bodr-web/logs/bodr-web.log` |

### 2.1 关键路径硬规

- **端口 8880 永远留给 mm7 BODR 主站**（避开 3000 OH / 3002 open-webui / 3092 GPT / 19801 OKF）
- **db 路径必须在 db.py 默认指向 mm7 副本**（防 new6 8870 写锁冲突，见 §37.1）
- venv 必须独立建 `.venvs/bodr`（BODR 依赖轻 flask+PIL，单独建轻量 venv，见 §37.2）

## 3. 端口拓扑（mm7 一侧）

```
┌──────────────────────────────────────────────────────────┐
│ 192.168.1.200 (mini 主机) — mm7 用户端口                  │
├──────────────────────────────────────────────────────────┤
│ 19789 → OpenClaw Gateway (systemd 常驻)                │
│ 3000  → OpenHands agent-server (mm7 systemd 治本)        │
│ 3092  → GPT Researcher (mm7 systemd 治本)                │
│ 8880  → BODR 主站 (mm7 镜像, Flask + SQLite)            │  ← 本 skill 入口
│ 19801 → OKF serve (supervisor.py 真自愈)                │
│ 3091  → IPL (new6 占用, mm7 不用)                       │
│ 8870  → BODR 主站 (new6 占用, mm7 镜像独立)             │  ← 跟 mm7 8880 零冲突
└──────────────────────────────────────────────────────────┘
```

### 3.1 BODR 端口硬规

- **mm7 BODR 永远绑 8880**（不要绑 8870，会跟 new6 冲突）
- **db 永远指向 mm7 副本**（`/home/mm7/.../BODR_CRM.db`），不要指向 new6 路径
- 服务必须监听 `0.0.0.0:8880`（mm7 顶层 IP 是 192.168.1.200）

## 4. systemd 真自愈配置（§36 §37 标准）

| 单元 | 路径 |
|---|---|
| service | `~/.config/systemd/user/mm7-bodr-web.service` |
| timer | `~/.config/systemd/user/mm7-bodr-web.timer` |

### 4.1 service 关键配置

```ini
[Unit]
Description=mm7 BODR Web 8880 ensure-alive (per-shot)
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/home/mm7
ExecStart=/bin/bash -c '/home/mm7/.openclaw/deploy/bodr-web/ensure-alive.sh >> /home/mm7/.openclaw/logs/bodr-web-timer.log 2>&1'
Environment="PATH=/home/mm7/.local/bin:/usr/local/bin:/usr/bin:/bin"
KillMode=process
```

### 4.2 timer 关键配置

```ini
[Unit]
Description=mm7 BODR Web timer (every 2 minutes, offset 45s)

[Timer]
OnBootSec=45s
OnUnitActiveSec=120s
AccuracySec=5s
Persistent=true

[Install]
WantedBy=timers.target
```

### 4.3 ensure-alive.sh 关键模式

- `ss -tln | grep ":8880 "` → 在听？
- 在听 + 根路由 200 → ✅ already alive
- 不在听 → `setsid nohup $VENV/bin/python3 app.py > $LOG 2>&1 &`（防 SIGTERM 继承）
- 等 30s 200，最多 30 次 sleep 1
- chmod +x 必做一次到位（ensure-alive.sh + venv/bin/*）

## 5. 启动/停止/重启 SOP

### 5.1 手动拉起

```bash
bash /home/mm7/.openclaw/deploy/bodr-web/ensure-alive.sh
```

### 5.2 看 systemd 状态

```bash
systemctl --user status mm7-bodr-web.{service,timer}
systemctl --user list-timers mm7-bodr-web.timer
```

### 5.3 立即触发一次 service

```bash
systemctl --user start mm7-bodr-web.service
```

### 5.4 真自愈验证

```bash
PID=$(ss -tlnp | grep ":8880 " | grep -oP 'pid=\K\d+' | head -1)
kill -9 $PID
sleep 130  # 等 timer 触发 (120s + 启动时间)
curl -s http://127.0.0.1:8880/api/orders | head -c 100
```

## 6. API 路由速查

| 路由 | 用途 |
|---|---|
| `GET /` | 健康检查 (200 OK) |
| `GET /api/orders` | 订单列表（mm7 副本 17365 单） |
| `GET /api/customers` | 客户列表 |
| `GET /api/products` | 产品列表 |
| `GET /api/p2` | P2 客户（订货周期 > 0 且最后订单 > 周期 且 <=300天） |
| `GET /api/p3` | P3 客户（最后订单 > 300天） |
| `GET /api/dashboard` | 仪表盘 |

## 7. 防冲突 SOP

### 7.1 跟 new6 8870 完全独立（§37.1）

- **端口不同**（8880 vs 8870）
- **db 不同**（mm7 owned 10MB vs new6 owned 10MB，不同 mtime）
- **venv 不同**（mm7 .venvs/bodr vs new6 .hermes-venv）
- **进程不同**（mm7 systemd timer 守护 vs new6 systemd service）

**严禁**：跨用户共享 db 路径（写锁冲突 → 数据损坏）

### 7.2 systemd 启服务必做

1. chmod +x ensure-alive.sh
2. chmod +x venv/bin/* （关键！systemd 第一次跑 venv 还没 +x 失败 status=126）
3. ensure-alive.sh 里 `setsid nohup`（防 SIGTERM 继承）
4. service 加 `KillMode=process`（不杀衍生子进程）

## 8. 跟 new6 镜像的差异表

| 项 | mm7 8880 (本 skill) | new6 8870 (主人原版) |
|---|---|---|
| 端口 | 8880 | 8870 |
| 路径 | `/home/mm7/.openclaw/skills/...` | `/home/new6/.hermes/skills/...` |
| venv | `.venvs/bodr` (mm7 owned) | `.hermes-venv` (new6 owned) |
| db | mm7 owned BODR_CRM.db (10MB) | new6 owned BODR_CRM.db (10MB) |
| 守护 | systemd timer (mm7 §37) | systemd service (new6 自管) |
| OKF 入口 | 不接（mm7 OKF 是不同项目） | 不接 |

**两个完全独立，可同时跑，互不冲突**。

## 9. 相关 skill / 引用

- SOUL §37 — mm7 systemd 单元推广标准（37.1 跨用户改端口必改 db / 37.2 独立 venv / 37.3 timer 错开）
- SOUL §36 — mm7 systemd oneshot + KillMode=process + setsid 三件套
- 项目书 web3091 — IPL 项目书（参考 SKILL.md 模板）

## 10. 验收 checklist（部署后 30 秒勾选）

- [x] 端口 8880 监听（`ss -tlnp | grep 8880`）
- [x] Flask 服务起来（curl / 200）
- [x] mm7 db 跟 new6 8870 db 独立（不同 mtime + md5）
- [x] systemd timer active（`systemctl --user list-timers`）
- [x] 真自愈验证通过（kill -9 → 130s 后拉回新 PID）
- [x] venv 独立（`.venvs/bodr`，不跟 muse/openhands 混）
- [x] ensure-alive.sh chmod +x
- [x] API 返回真实数据（`/api/orders` 返回 17365 单）
---

## 11. 治本附录：跨用户项目改端口必改全部路径引用（§37.1 加强 2026-07-02 15:38）

> **本节是踩坑记录**：14:25 改端口时只改了 `db.py` 一个文件，结果 15:38 发现图片路由全 404。
> 根因：`image_gen.py` + `blueprints/uploads.py` 还有 `BASE_DIR = "/home/new6/.hermes/..."` 残留。

### 11.1 改端口/迁移项目时的必查清单

```bash
cd /home/mm7/.openclaw/skills/<project>/code/
grep -rn "/home/原用户/" . --include="*.py" --include="*.sh" --include="*.md" --include="Makefile" --include="*.json" 2>&1
# 找出所有指向原用户路径的引用，全部 sed 替换成 mm7 自己的路径
```

### 11.2 跨用户项目必查 5 类文件

| 文件类型 | 常见引用 | 改法 |
|---|---|---|
| `*.py` (主代码) | `BASE_DIR` / `DB_PATH` / `LOG_DIR` | sed 替换 |
| `blueprints/*.py` | `BASE_DIR` / 上传路径 / static 路径 | sed 替换 |
| `*.md` (文档) | 端口号 / 路径说明 | sed 替换 |
| `plan.json` / 配置文件 | 端口号 + 启动命令 | sed 替换 |
| `Makefile` / `*.sh` | 启动脚本端口 + 路径 | sed 替换 |

### 11.3 验证三步走

1. **grep 干净**：`grep -rn "/home/原用户/" . --include="*.py"` 应只剩调试/备份脚本
2. **重启验证**：kill 服务 → systemd timer 拉回 → curl 所有路由 (200/PNG 不是 HTML)
3. **前端实际路径测试**：前端调 `/api/order/<id>/modal-image-v2` 不是 `/order/<id>/modal-image-v2`（看蓝图 url_prefix）

### 11.4 调试脚本豁免清单（不改）

- `test_debug.py` / `debug_coord.py` / `backups/.../db.py` — 这些是开发工具/备份快照，**不影响运行**，可保留 new6 路径作为历史参考。

---

## 12. 治本附录：订单图片文本换行 + 卡片自动增高（§19.2 强化 2026-07-04 18:42）

> **踩坑背景**：订单图片 modal-image-v2 (竖图) 渲染时，**地址 / 备注超长会被截断**，**且卡片不会增高** —— 后续卡片直接覆盖到溢出文本上。
> **根因**：`image_gen._wrap_text` 原始实现只按空格切词（英文逻辑），中文长段没有空格 = 整段当 1 行返回 1 行，但卡片高度又按这个假 1 行算 → 视觉上溢出截断。
> **治本**：重写 `_wrap_text` 三层回退 = ①按 `\n` 拆段 ②空格/中文标点 token 切 ③单 token 超宽 → 字符级硬切（一个一个字符加，超宽就 break）。
> **同时** `customer_card_h` / `note_h` 已经按 `len(_wrap_text(...))` 真行数算，所以改完 `_wrap_text` 后卡片**自动同步增高**，**不需要改任何高度公式**。

### 12.1 改 image_gen.py / 任何图片生成时的必查 3 项

```bash
cd /home/mm7/.openclaw/skills/BODR\ CRM服务-web8880-crm-service/code/
grep -n "_wrap_text\|H_NOTE_BASE\|H_NOTE_PER_LINE\|H_BODY_LINE\|customer_card_h\|note_h" image_gen.py | head -20
```

- `_wrap_text` 必须支持中文 + 混合（无空格中文长段不截断）
- 字段高度公式必须**调用** `_wrap_text` 算真行数（如 `len(_wrap_text(text, font, w))`）
- 不能写死 `H_NOTE` / `H_INFO` 单行固定高度，除非所有展示文本 ≤ 1 行 (BODR 现已全部按行数算)

### 12.2 验证 4 件套（每次改图片生成逻辑后必跑）

```bash
# 1) 找 3 个真实超长订单（地址 OR 备注任一超过 30 字符）
sqlite3 BODR_CRM.db "SELECT id, length(备注), length(街道) FROM 订单 o LEFT JOIN 收货地址 a ON o.地址id=a.id WHERE length(备注)>30 OR length(街道)>30 ORDER BY id DESC LIMIT 3;"

# 2) curl 拉 v2 图
for id in X X X; do curl -s "http://127.0.0.1:8880/api/order/$id/modal-image-v2?t=$(date +%s)" -o /tmp/fix_$id.png; done

# 3) 看图（mm7 image 工具解析）—— 验证
#    - 文本完整不截断
#    - 卡片增高 + 后续卡片自动下移不重叠
#    - 短文本订单无视觉变化（回归保护）

# 4) 拿 1 个短文本订单 + 1 个超长订单，diff 前后图大小（size 增加 = 卡片增高生效）
ls -la /tmp/fix_*.png
```

### 12.3 不要做的事（防回退）

- ❌ **不要**改回按空格切词的旧 `_wrap_text`（中文环境必坏）
- ❌ **不要**写死 `H_NOTE`/`H_INFO` 单行固定高度（任何超长文本场景都会炸）
- ❌ **不要**为单订单硬编码 wrap 宽度（卡片宽度随时改）
- ❌ **不要**改 `_wrap_text` 后忘了 `image_gen` 单实例缓存 → 服务必须重启（Flask use_reloader=False，dev 改完得手动 kill + 起）

### 12.4 历史背景

- 2026-07-04 18:38 主人报告 "8880 订单图片地址/备注超长被截断 + 卡片不增高"
- 2026-07-04 18:41 主人拍 A 方案 = `_wrap_text` 治本（不再列 3 选项担误时间）
- 2026-07-04 18:42 mm7 直接 A 干完，验证 17058/17077/17522 三单（短/超长备注/超长地址）全过

### 12.5 备注/地址多行行间距规则（§12 增补 2026-07-04 18:52）

- **多行文本字号 ÷ 行间距 ≥ 1.0**才不压字 — 现网参数：
  - `S_FONT['note'] = 27`，`H_NOTE_PER_LINE = 34` （比例 1.26 合规）
  - `S_FONT['body'] = 21`，`addr_lines × (H_BODY_LINE + 4) = 30 + 4 = 34` （比例 1.62 合规）
- **修改任一行间距常量时重扫**：
  ```bash
  grep -n "H_NOTE_PER_LINE\|H_BODY_LINE\|H_NAME_LINE\|H_CONFIG_LINE" /home/mm7/.openclaw/skills/BODR\ CRM服务-web8880-crm-service/code/image_gen.py
  ```
  - 顺算 ratio (`H_FONT / Per_LINE`)， < 1.2 = 报警不准
- **P1 报告召回**：2026-07-04 18:52 主人报 "备注多行接一起了" = `H_NOTE_PER_LINE = 23` （ratio 27/23=1.17 临界），加到 34 后主人再扫留中不报。
- **防止 _wrap_text 留下孤立符号单行**：现在 v2 输出可能含 "|" / "/" / "。" 单字符 1 行 — 主人若报 "备注中 有跨行只买 X 的现象" 才动 `wrap_text` 分享规则；现在不动。


