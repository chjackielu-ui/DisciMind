# AI Generate 模块

本模块负责 AI 内容生成功能。

子模块：
- text-generate.service.js：文本生成（文章、摘要、报告等）
- image-generate.service.js：图片生成
- video-generate.service.js：视频生成

文本生成走统一 AI Service；图片生成走 OpenAI 兼容接口；视频生成仅在供应商显式配置安全的相对接口路径且模型声明 `video_generation` 能力时启用。
