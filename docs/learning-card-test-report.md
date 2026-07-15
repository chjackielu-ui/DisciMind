# LearningCard 平台测试报告

测试日期：2026-07-16

## 自动化与构建

- `test/learning-card-platform.test.js`：11/11，通过协议/XSS、ChartSpec、评分与多样性、冷启动、事件单槽刷新、缓存键、原子缓存/SWR、AI 降级、LaTeX 修复及端到端接线契约。
- 后端全量：515/515，21 suites，0 失败、0 跳过，79.84 秒。
- 前端生产构建：966 modules，通过；仅保留项目既有大 chunk 与 ineffective dynamic import 警告。
- Prisma：schema valid；50 个 migration；数据库 up to date；应用入口加载通过。

## 真实 Qwen3.7 Plus

使用当前真实配置、`enable_thinking=false` 完成 7 类生成：纯文本、Markdown 表格、LaTeX、ECharts 折线图、个性化掌握度雷达、任务提醒、错题修复。7/7 满足 LearningCard 1.0 严格 Schema，均有真实来源且未输出推理 token。另验证模型失败保留规则卡、数据库错误不被吞掉。

## 推荐、缓存与业务闭环

- 真实学生数据生成 5 张，槽位为 WEAKNESS / WRONG / CONCEPT / TASK / PROGRESS；同类型不超过 2，相邻知识点不同。
- 同一快照连续生成使用不同 generation token；旧任务不能覆盖新卡组。
- 学习事件只向 Worker 发送 1 个目标卡 ID，至少 4 个槽位保持原序；手动“换一组”仍生成完整轮换。
- 内存 + 原子 JSON + 数据库缓存可命中；stale 先返回旧卡，后台刷新；页面刷新不重复调用 Qwen。
- 详情、收藏幂等切换、加入计划幂等、开始练习、携卡问 AI、保存成果均完成真实 API 闭环。

## 浏览器验收

- 1440 桌面显示 5 张扇形卡；933 平板和 390 手机显示 3 张；均无横向溢出。
- 键盘方向键、箭头、分页点、触摸布局、详情焦点圈、Escape、移动端底部抽屉、reduced-motion 均可用。
- Markdown 表格、KaTeX 和 ECharts 懒初始化通过；图表有 6 行无障碍数据表、全屏与 PNG 动作，并在关闭时销毁。
- 主页、学习中心、Trainer 等待、错题修复、AI Artifact、课程卡片库及每日通知回跳均实际打开验证。
- 修复了异步收藏导致焦点落到 body、通知标已读后弹窗关闭、窄屏“换一组”纵排和 JSON 控制转义破坏 LaTeX 四个浏览器回归问题。

## 性能与清理

规则卡同步返回，AI 只增强 1–3 张；ECharts 仅在详情打开后加载，ResizeObserver 节流并在关闭时 dispose；扇形曝光按卡片实例去重。验收结束后精确删除 34 张测试卡、1 个每日卡组、5 个槽位、12 个状态、382 个事件、1 条通知、1 个任务及平台缓存；后续增量验证也再次清零，未删除真实业务数据。
