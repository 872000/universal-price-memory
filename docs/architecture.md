# 项目结构与修改指南

## 数据流程

```text
关键词 -> discover-products.js -> watch-products.txt
商品链接 -> collect-woolworths-prices.js -> SQLite
SQLite -> server.js API -> frontend/app.mjs
API 不可用或数据库为空 -> 前端 mock demo data
```

真实采集数据和前端 demo data 必须保持分开。collector 缺少 `stockcode`、商品名、当前价格或商品 URL 时必须失败，不能用 mock 值补齐后写入 SQLite。

## 模块职责

- `lib/cli.js`：命令行参数、数字选项和清单文件读取。
- `lib/woolworths.js`：Woolworths URL、stockcode、请求头、UI 版本和带超时的网络请求。
- `lib/db.js`：SQLite 初始化、查询和事务写入。
- `scripts/collect-woolworths-prices.js`：单个商品的数据提取与字段映射。
- `scripts/discover-products.js`：按关键词分页发现商品，只更新监控清单。
- `scripts/collect-batch.js`：批量调度单商品 collector 和每周去重。
- `server.js`：只读 API 和受限静态文件服务。
- `frontend/app.mjs`：页面状态、渲染编排和事件绑定。
- `frontend/catalog-data.mjs`：demo 商品、翻译和分类标签。
- `frontend/product-model.mjs`：价格计算、促销判断和 API 商品标准化。
- `frontend/api.mjs`：商品列表与历史价格 API。
- `frontend/price-chart.mjs`：SVG 价格曲线渲染。

## 常见改动

新增 Woolworths 请求规则时修改 `lib/woolworths.js`，避免在多个脚本复制请求头。新增采集字段时先修改 `data/schema.sql`，再更新 collector 映射、`lib/db.js` 写入和 API 查询，最后添加解析及数据库测试。

新增门店时继续使用 `store_id` 区分快照，不要为每个门店创建新商品。新增提醒或 AI 功能时从 `/api/products/:id/history` 读取真实快照，不要从页面文字反向解析价格。

## 修改后验证

```bash
npm run quality
npm run db:check
npm run db:audit
```

涉及真实采集时，再用一个已知商品运行：

```bash
npm run collect -- --url "商品链接" --debug
```

测试使用临时 SQLite，不会修改正式的 `data/price-tracker.sqlite`。
