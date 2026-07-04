# 视频检索接口说明

> 本文档补充说明学生端新增的视频检索接口。

---

## 1. 搜索视频

```
POST /api/student/videos/search
```

**权限**：student（登录用户）

### 请求参数

```json
{
  "keyword": "PCA 主成分分析",
  "course_id": 1,
  "knowledge_point_id": 7,
  "limit": 10
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keyword | string | 否 | 搜索关键词（与 course_id/knowledge_point_id 至少有一个） |
| course_id | number | 否 | 课程 ID，按课程范围筛选 |
| knowledge_point_id | number | 否 | 知识点 ID，按知识点筛选 |
| limit | number | 否 | 返回数量上限，默认 10，最大 20 |

### 响应示例

```json
{
  "code": 0,
  "message": "视频搜索成功",
  "data": {
    "list": [
      {
        "video_id": 1,
        "title": "PCA 主成分分析通俗讲解",
        "bvid": "BV1xx411c7mD",
        "source": "bilibili",
        "embed_url": "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0",
        "video_url": "https://www.bilibili.com/video/BV1xx411c7mD",
        "cover_url": null,
        "author": null,
        "duration": 600,
        "knowledge_point_name": "PCA 主成分分析",
        "course_name": "机器学习",
        "recommend_reason": "关于PCA主成分分析的学习视频"
      }
    ],
    "total": 1,
    "keyword": "PCA 主成分分析",
    "suggestion": null
  }
}
```

### 返回字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| list | array | 视频结果列表 |
| list[].video_id | number | 视频 ID |
| list[].title | string | 视频标题 |
| list[].bvid | string | B 站视频 ID（B站唯一标识） |
| list[].source | string | 来源：bilibili / external / self_generated |
| list[].embed_url | string | **iframe 嵌入地址**，可直接用于 `<iframe src="...">` |
| list[].video_url | string | 原始视频页链接，用于跳转观看 |
| list[].cover_url | string | 封面图地址 |
| list[].author | string | 作者（预留字段，当前为 null） |
| list[].duration | number | 时长（秒） |
| list[].knowledge_point_name | string | 关联知识点名称 |
| list[].course_name | string | 关联课程名称 |
| list[].recommend_reason | string | 推荐理由 |
| total | number | 结果数量 |
| keyword | string | 搜索关键词 |
| suggestion | object | 无结果时的搜索建议（见下方） |

### 无结果时的 suggestion

```json
{
  "suggestion": {
    "title": "PCA 主成分分析 视频讲解",
    "search_url": "https://search.bilibili.com/all?keyword=PCA+主成分分析",
    "source": "bilibili_search",
    "note": "未在已收录资源中找到匹配视频，可点击搜索链接前往 B 站查找。"
  }
}
```

---

## 2. embed_url 生成规则

后端从 `video_resources` 表中检索已收录的视频，按以下优先级生成 `embed_url`：

1. 若数据库中有 `embed_url` → 直接使用
2. 若无 `embed_url` 但 `source = bilibili` 且 `bvid` 存在 → 自动构造：
   ```
   https://player.bilibili.com/player.html?bvid={bvid}&autoplay=0
   ```
3. 若上述都不满足 → `embed_url` 为空字符串，前端显示降级提示

---

## 3. 关键词提取规则（前端）

从错题数据的以下字段提取，按优先级取前 3 个不为空的字段拼接：

| 优先级 | 字段名 | 说明 |
|--------|--------|------|
| 1 | `knowledge_point_name` | 知识点名称 |
| 2 | `course_name` | 课程名称 |
| 3 | `title` | 题目标题 |
| 4 | `question_content`（前 40 字） | 题干内容（去 HTML 标签） |

---

## 4. embed_url 前端使用方式

```html
<iframe 
  src="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0" 
  style="width:100%;height:100%;border:none;" 
  allowfullscreen 
  allow="autoplay;fullscreen">
</iframe>
```

---

## 5. 平台限制说明

### 5.1 B 站 API 风控限制

B 站公开搜索接口存在 **412 安全风控策略**，会拒绝来自非浏览器环境的请求（包括服务器端 Node.js 请求）。这导致直接通过 B 站 API 检索视频无法稳定工作。

### 5.2 多级降级方案

| 层级 | 条件 | 行为 |
|------|------|------|
| 一级 | B 站 API 搜索成功且有结果 | ✅ 正常返回视频列表，每条含 `bvid` + `embed_url`，前端 iframe 播放 |
| 二级 | B 站 API 全部失败 | ⚠️ 返回 `suggestion` 对象，前端显示提示 + 「去 B 站搜索」按钮（跳转 `search.bilibili.com`） |
| 三级 | 接口调用异常 | ⚠️ 前端捕获异常，显示错误提示 + B 站搜索入口 |

### 5.3 iframe 可用性

- 若 API 返回了 `bvid`，`embed_url` 构造为 `https://player.bilibili.com/player.html?bvid={bvid}&autoplay=0`
- B 站 `player.bilibili.com` 域名支持 iframe 嵌入，无跨域限制
- iframe 设置了 `allowfullscreen` + `allow="autoplay;fullscreen"`

### 5.4 embed_url 生成规则
