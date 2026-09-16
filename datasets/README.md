# DisciMind 评审数据集

本目录提供可公开提交、可复现、无个人信息的最小评审数据。它用于验证知识检索、编排路由和在线编译，不用于训练或微调第三方基础模型。

| 文件 | 用途 |
| --- | --- |
| `knowledge-408.jsonl` | 计算机基础知识检索样例 |
| `multi-agent-evaluation.jsonl` | 多智能体 Planner/Skill/Tool 路由验收样例 |
| `compiler-cases.json` | C/Python 正常与异常沙箱验收样例 |

数据库内更完整的演示课程、知识点、题目、学习记录和智能体广场数据由 `backend/prisma/seed.js` 与 `backend/prisma/seed-judge-demo.js` 幂等生成。公共知识库长文本位于 `backend/prisma/seed-assets/408-public-knowledge.md`。

数据来源：团队依据公开教材知识点自行整理或程序化合成。数据不含真实学生、教师、联系方式、身份标识或生产行为日志，可用于软件杯评审和项目功能测试。
