# Dify 前端模块

本模块封装前端对 Dify API 的调用。

- dify.api.js：封装 HTTP 请求（通过后端转发）
- dify.service.js：Dify 业务逻辑封装

注意：前端不能直接暴露 Dify API Key，必须通过后端转发。
