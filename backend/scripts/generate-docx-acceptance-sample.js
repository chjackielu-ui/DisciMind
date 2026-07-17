const fs = require('fs/promises');
const path = require('path');
const { Packer } = require('docx');
const service = require('../src/services/teacher-preparation-document.service');

const OUTPUT_PATH = path.resolve(__dirname, '../storage/acceptance/机器学习课程教案-DOCX专项验收.docx');

async function buildAcceptanceDocument() {
  const logo = await fs.readFile(path.resolve(__dirname, '../../frontend/public/logo.png'));
  const markdown = `# 机器学习课程教学设计

## 课程信息

课程：机器学习；主题：线性回归与梯度下降；课时：90 分钟。

## 教学目标

1. 理解线性回归的假设空间与损失函数。
2. 能够推导并实现批量梯度下降。
3. 能够解释学习率对收敛过程的影响。

## 教学重点与难点

- 重点：从误差度量过渡到优化目标。
- 难点：梯度方向、步长与收敛性的关系。

## 教学过程

| 教学阶段 | 时间 | 教师活动 | 学生活动 |
| --- | ---: | --- | --- |
| 情境导入 | 10 分钟 | 展示房价预测案例并提出问题 | 观察数据并提出可解释变量 |
| 原理讲解 | 25 分钟 | 推导损失函数与梯度 | 完成行内推导并互相校验 |
| 编程实践 | 35 分钟 | 演示训练循环并巡视指导 | 分组实现与调参 |
| 评价总结 | 20 分钟 | 组织展示、点评常见错误 | 汇报结果并完成反思 |

## 模型示意图

![图 1 DisciMind 教学材料标识](data:image/png;base64,${logo.toString('base64')})

*图 1　机器学习教学材料示意图*

## 公式与原理

线性模型可写为 $h_\\theta(x)=\\theta^Tx$，其中 $\\theta$ 为待学习参数，$e$ 表示残差。

$$J(\\theta)=\\frac{1}{2m}e^2$$

## 代码示例

\`\`\`python
for epoch in range(max_epochs):
    gradient = X.T @ (X @ theta - y) / len(y)
    theta = theta - learning_rate * gradient
\`\`\`

## 教学实施步骤

1. 使用真实小数据集建立基线。
2. 观察损失曲线并调整学习率。
3. 比较标准化前后的训练表现。

> 教学提示：课程资料与模型输出均需核验；不得用测试集参与训练。

<hr data-page-break="true">

## 参考资料

- 周志华：《机器学习》。
- Andrew Ng, Machine Learning course notes.
`;
  const html = service.markdownToHtml(markdown);
  const rich = service.normalizeRichDocument({ html, title: '机器学习课程教案', metadata: { acceptanceFixture: true } });
  return { document: service.buildEditableDocxDocument(rich.title, rich.contentJson), rich };
}

async function main() {
  const { document } = await buildAcceptanceDocument();
  const bytes = await Packer.toBuffer(document);
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, bytes);
  console.log(JSON.stringify({ output: OUTPUT_PATH, bytes: bytes.length }));
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = { OUTPUT_PATH, buildAcceptanceDocument };
