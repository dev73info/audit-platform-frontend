# audit-platform-frontend —— 独立审核系统平台 · 管理控制台

多项目隔离的通用内容审核中台管理端：**Vue 3 + Vite + TypeScript + Element Plus**。

覆盖项目管理、审核定义、规则与动作配置、审核任务查询、开放 API 客户端、审计日志与运行看板。

配套的 Rust 后端：[`dev73info/audit-platform-backend`](https://github.com/dev73info/audit-platform-backend)

## 目录

| 路径 | 说明 |
| --- | --- |
| `src/views/` | 业务页面（项目、审核定义、任务、规则、开放 API、日志、看板） |
| `src/api/` | 接口封装与统一请求层 |
| `src/stores/` | Pinia 状态（登录态、当前项目等） |
| `src/components/` | 通用组件与布局 |
| `doc/` | 前端约定（共享资产、样式类、页面骨架、硬性规则） |

## 快速开始

```bash
pnpm install
pnpm dev        # http://127.0.0.1:5181
```

开发代理把 `/api` 与 `/open` 转发到 `http://127.0.0.1:8090`，后端按
[`audit-platform-backend`](https://github.com/dev73info/audit-platform-backend) 的说明启动即可。

默认管理员：`admin` / `Test@123456`（由后端 `db/seed.sql` 创建，上线前必须改）。

## 配置

`.env.development` 是可入库的默认值；本机覆盖写 `.env.local`（不入库）：

| 变量 | 说明 |
| --- | --- |
| `VITE_API_BASE_URL` | 留空走 Vite 代理；填完整地址则直连后端 |
| `VITE_ROUTER_MODE` | `history`（默认）或 `hash` |

## 校验

```bash
pnpm type-check   # vue-tsc --build，唯一类型校验入口
pnpm build        # 生产构建（不含类型检查）
```

## 约定

页面骨架、共享样式类、组件使用规则见 [`doc/前端约定.md`](doc/前端约定.md)。
