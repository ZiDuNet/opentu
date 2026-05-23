# 图片生成 API 参数兼容性与比例转换修复经验

## 问题概述

本次修复涉及三个关联问题，全部为项目预存代码问题，非近期修改引入：

1. **rix API 400 错误**：`response_format` 参数不被 rix API 支持，导致图片生成失败
2. **非 1:1 比例全部生成 1:1**：用户选择 16:9、4:3 等比例时，API 实际生成正方形图片
3. **图片插入画布后强制 1:1 显示**：`foreignObject` 容器始终 400x400，竖版长图被压缩

---

## 一、架构背景

### 请求路由架构

```
用户输入 → AI Input Parser → Workflow Engine → Image Generation Service
                                                    ↓
                                          executorParams (size/quality/...)
                                                    ↓
                                         Fallback Executor
                                               ↙        ↘
                              buildImageRequestBody     resolveAdapterForInvocation
                              (通用请求体构建)          (专用适配器路由)
                                    ↓                        ↓
                              providerTransport.send    gpt-image-adapter.ts
                              → 直接 fetch 到 API       → 专项处理 request body
```

### 关键设计点

- **`buildImageRequestBody`** 是统一的请求体构建函数，被 `fallback-executor.ts` 和 `generateImageSync` 两个路径调用
- **适配器层**（`gpt-image-adapter.ts`、`tuzi-gpt-image-adapter.ts`）有独立的 `response_format` 处理逻辑，只在使用专属适配器时生效
- **提供商路由**（`provider-transport.ts`）直接将请求 fetch 到外部 API 服务商，不做参数转换

---

## 二、问题 1：`response_format` 硬编码导致 rix API 报错

### 错误日志

```
[TaskQueueService] Task execution failed: Error: Image generation failed: 400 -
{"error":{"message":"Unknown parameter: 'response_format'.",
 "type":"rix_api_error","param":"response_format","code":"unknown_parameter"}}
```

### 根因

`buildImageRequestBody` 无条件向请求体中添加了 `response_format: 'url'`：

```typescript
// image-api.ts L54-61（修复前）
export function buildImageRequestBody(params: ImageGenerationParams) {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    model: params.model,
    response_format: 'url',   // ← 硬编码，rix API 不支持
  };
```

该参数是 OpenAI 官方 API 的专有参数。当 `provider-transport.ts` 将请求路由到 rix API 提供商时，服务端不识别此参数，返回 400。

### 修复

```typescript
// image-api.ts L54-60（修复后）
export function buildImageRequestBody(params: ImageGenerationParams) {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    model: params.model,
  };
  // response_format 已移除，由各适配器自行处理
```

### 影响范围审计

| 代码路径 | 是否受影响 | 说明 |
|---------|-----------|------|
| `fallback-executor.ts` L267 → `buildImageRequestBody` | 已修复 | 不再发送 `response_format` |
| `image-api.ts` L151 → `generateImageSync` → `buildImageRequestBody` | 已修复 | 不再发送 `response_format` |
| `gpt-image-adapter.ts` L176-179 | **不受影响** | 有自己的 `getGPTImageResponseFormat` 处理，只在用户显式传入时才添加 |
| `tuzi-gpt-image-adapter.ts` | **不受影响** | 继承 GPT Image 适配器逻辑 |
| `image-api.ts` L35-48 `normalizeImageResultUrl` | **不受影响** | 同时支持 `url` 和 `b64_json` 两种返回格式 |

### 风险评估

**零风险**。原因：

1. OpenAI API 的 `response_format` **默认值就是 `'url'`**，不传等效于传 `'url'`
2. `parseImageResponse` + `normalizeImageResultUrl` 兼容 `url` 和 `b64_json` 两种格式
3. GPT Image 适配器有自己的 `response_format` 处理，不依赖 `buildImageRequestBody`

---

## 三、问题 2：非 1:1 比例全部生成 1:1

### 现象

用户选择 16:9，但 API 生成 816x816 正方形图片，下方内容空白。下载后图片确实是正方形。

### 根因分析：参数链路断裂

```
用户选 16:9
  → normalizeSize('16:9') → '16x9'
  → ParsedGenerationParams.size = '16x9'
  → step.args.size = '16x9'
  → workflow engine: options.size = '16x9'
  → image-generation-service: executorParams.size = '16x9'
  → fallback-executor: params.size = '16x9'
  → buildImageRequestBody({ size: '16x9' })
  → body.size = '16x9'                    ← BUG：比例字符串当作像素尺寸
  → API 收到 size: '16x9'                 ← 无效像素尺寸，回退默认 1:1
```

`buildImageRequestBody` 的逻辑缺陷：

```typescript
// 修复前
if (params.size) {
  body.size = params.size;           // 直接透传，无论内容是比例还是像素
} else if (params.aspectRatio) {
  body.size = aspectRatioToSize(params.aspectRatio);  // 转换只在这个分支
}
```

上游链路将比例格式（`'16x9'`）放进 `size` 字段，导致 `aspectRatioToSize` 转换分支被跳过。

### 全部受影响比例

| 用户选择 | 传入 size | 期望尺寸 | 修复前实际 |
|---------|----------|---------|-----------|
| 16:9 | `16x9` | `1792x1024` | 1:1 |
| 9:16 | `9x16` | `1024x1792` | 1:1 |
| 4:3 | `4x3` | `1536x1152` | 1:1 |
| 3:4 | `3x4` | `1152x1536` | 1:1 |
| 3:2 | `3x2` | `1536x1024` | 1:1 |
| 2:3 | `2x3` | `1024x1536` | 1:1 |
| 4:5 | `4x5` | `1024x1280` | 1:1 |
| 5:4 | `5x4` | `1280x1024` | 1:1 |
| 21:9 | `21x9` | `1792x768` | 1:1 |
| 1:4 | `1x4` | `512x2048` | 1:1 |
| 4:1 | `4x1` | `2048x512` | 1:1 |

仅 `1:1` → `1x1` → `1024x1024` 碰巧正常。

### 修复

```typescript
// image-api.ts L66-69（修复后）
if (params.size) {
  body.size = aspectRatioToSize(params.size) || params.size;
  //          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //          先尝试比例→像素转换，失败则透传（认为是像素尺寸）
} else if (params.aspectRatio) {
  body.size = aspectRatioToSize(params.aspectRatio);
}
```

### `aspectRatioToSize` 安全分析

| 输入 | 查表结果 | 最终输出 | 正确？ |
|------|---------|---------|--------|
| `'16x9'` | `'1792x1024'` | `'1792x1024'` | ✓ |
| `'1024x1024'` | `undefined` | `'1024x1024'` | ✓ |
| `'1920x1080'` | `undefined` | `'1920x1080'` | ✓ |
| `undefined` | 函数短路返回 `undefined` | 不进入 if 块 | ✓ |
| `'auto'` | 函数短路返回 `undefined` | 不进入 if 块 | ✓ |

### 风险评估

**零风险**。`||` 运算符确保任何无法转换的值都会透传原值。

### 跨 AI 提供商兼容性分析

核心问题：OpenAI 需要像素尺寸（如 `1792x1024`），其他 AI 可能不同，修改后会不会影响其他 AI？

**答案：不会。** 反过来，修改**前**发送的 `'16x9'` 才是对所有 API 都无效的值。

#### 三种 `size` 格式与各 API 接受情况

| 格式类型 | 示例 | 接受的 API |
|---------|------|-----------|
| 像素尺寸 | `1792x1024`、`1024x1024` | OpenAI、Gemini、Flux、Midjourney、rix 等几乎所有 API |
| 比例字符串（冒号） | `16:9`、`4:3` | 少数国产模型 API |
| 混合格式（x 分隔） | `16x9`、`4x3` | **没有 API 接受这种格式** |

#### 修改前后对比

| 阶段 | 用户选择 | 发送给 API | API 行为 |
|------|---------|-----------|---------|
| 修改前 | 16:9 | `'16x9'`（无效格式） | 任何 API 都不认，统一回退 1:1 |
| 修改后 | 16:9 | `'1792x1024'`（标准像素） | 所有 API 都支持 |

#### 为什么修改前不是发送 `'16:9'` 而是 `'16x9'`？

链路中有一步 `normalizeSize` 将用户输入的 `'16:9'` 转为 `'16x9'`，这一步本身没有问题（统一格式）。但 `buildImageRequestBody` 收到 `'16x9'` 后直接透传给 API，没有调用 `aspectRatioToSize` 将其转为 `'1792x1024'`。`'16x9'` 这个格式对任何 API 都不是合法参数——它既不是像素尺寸，也不是标准比例格式。

#### 原始设计意图本身就是转换像素

原代码中 `aspectRatio` 分支已经正确地调用了 `aspectRatioToSize`：

```typescript
} else if (params.aspectRatio) {
  body.size = aspectRatioToSize(params.aspectRatio);  // 转换为像素尺寸
}
```

说明原始设计的意图就是**发送像素尺寸给 API**。问题只是上游把比例字符串错放进 `size` 字段，跳过了 `aspectRatio` 这个转换分支。本次修复只是**把被跳过的转换补回来**，并没有改变语义——最终发送的仍然是像素尺寸。

**结论**：修改前发送的是无效值（所有 API 都不认），修改后发送的是标准像素尺寸（所有 API 都认）。不存在跨提供商兼容性问题。

---

## 四、问题 3：图片插入画布后强制 1:1 显示

### 现象

`foreignObject` 容器始终 400x400，非正方形图片被压缩。图片加载瞬间显示正确比例，随后缩为 1:1。

### 根因

`insertImageFromUrl` 的 `lockReferenceDimensions` 参数为 `true` 时，跳过图片加载后的尺寸更新：

```typescript
// image.ts L399
shouldUpdateSizeAfterLoad = !lockReferenceDimensions; // true → false，不更新
```

### 修复

将所有自动插入场景的 `lockReferenceDimensions` 改为 `false`：

| 文件 | 行号 | 场景 | 修改 |
|------|------|------|------|
| `canvas-insertion.ts` | 226 | Services 批量插入 | `true` → `false` |
| `handler.ts` | 231, 311 | SW 自动插入 | 明确 `false` |
| `mcp/tools/canvas-insertion.ts` | 225 | MCP 协议插入 | `true` → `false` |

### 全部插入路径审计

```
insertImageFromUrl 调用者 17 处
│
├── 自动插入场景（lockReferenceDimensions=false）
│   ├── canvas-insertion.ts:226      ✓ false
│   ├── handler.ts:231               ✓ false
│   ├── handler.ts:311               ✓ false
│   ├── mcp/tools/canvas-insertion.ts:225  ✓ false（本次补修）
│   └── media-quick-insert.ts:67     ✓ undefined（等同 false）
│
├── 用户手动插入场景（lockReferenceDimensions 不传/undefined）
│   ├── useWorkflowSubmission.ts:103  ✓ undefined（图片尺寸已知）
│   ├── useWorkflowSubmission.ts:112  ✓ undefined
│   ├── drawnix.tsx:1307             ✓ undefined（传入 naturalWidth/Height）
│   ├── popup-toolbar.tsx:2551       ✓ undefined（传入 naturalWidth/Height）
│   ├── quick-creation-toolbar.tsx:211 ✓ 不传
│   ├── creation-toolbar.tsx:295      ✓ 不传
│   ├── MediaLibraryGrid.tsx:1280     ✓ 不传
│   ├── MediaLibraryGrid.tsx:1324     ✓ 不传
│   ├── VideoAnalyzer.tsx:122         ✓ 不传
│   ├── TaskQueuePanel.tsx:607        ✓ 不传
│   ├── TaskQueuePanel.tsx:974        ✓ 不传
│   └── DialogTaskList.tsx:229        ✓ 不传
```

**说明**：手动插入场景传入的是图片 `naturalWidth`/`naturalHeight`（已加载的真实尺寸），无需 `lockReferenceDimensions=false` 也能正确显示。`lockReferenceDimensions` 主要影响使用固定参考尺寸（400x400）的自动插入场景。

### 尺寸更新机制

`updateImageSizeAfterLoad`（[image.ts#L522-590](file:///d:/工作/opentu_new/packages/drawnix/src/data/image.ts#L522-L590)）：

1. 异步加载图片获取 `naturalWidth`/`naturalHeight`
2. 计算实际宽高比与参考宽高比差异（< 1% 跳过）
3. 以参考宽度为基准重新计算高度
4. 通过 `Transforms.setNode` 更新元素 `points`（影响 `foreignObject` 尺寸）

### 风险评估

**低风险**。影响仅限画布渲染层：
- 不影响 API 调用、图片生成流程
- 初始 400x400 是暂时的，图片加载后异步更新
- 极端网络条件下 `updateImageSizeAfterLoad` 可能加载失败（已有 `.catch` 保护），自动降级为参考尺寸

---

## 五、修改文件清单

| 文件 | 修改内容 | 影响范围 |
|------|---------|---------|
| `packages/drawnix/src/services/media-api/image-api.ts` | 删除 `response_format: 'url'`；`size` 参数增加比例→像素自动转换 | API 请求体构建 |
| `packages/drawnix/src/services/canvas-operations/canvas-insertion.ts` | `lockReferenceDimensions: false` | 批量图片插入 |
| `packages/drawnix/src/services/sw-capabilities/handler.ts` | 2 处 `lockReferenceDimensions: false` | SW 自动插入 |
| `packages/drawnix/src/mcp/tools/canvas-insertion.ts` | `lockReferenceDimensions: true → false` | MCP 协议插入 |

### 未修改的文件（已验证不受影响）

- `packages/drawnix/src/services/model-adapters/gpt-image-adapter.ts` — 自有 `response_format` 处理
- `packages/drawnix/src/services/model-adapters/tuzi-gpt-image-adapter.ts` — 继承 GPT 适配器
- `packages/drawnix/src/services/media-api/utils.ts` — 仅 `aspectRatioToSize` 被引用，逻辑不变
- `packages/drawnix/src/hooks/useWorkflowSubmission.ts` — 手动插入场景，传入真实尺寸
- 其他手动插入路径 — `lockReferenceDimensions` 未传或使用真实尺寸

---

## 六、经验总结

### 关键设计原则

1. **不要硬编码特定提供商的参数**：`response_format: 'url'` 对 OpenAI 是默认值，对 rix 是致命错误
2. **API 边界做参数规范化**：上游可能传入比例格式（`'16x9'`）或像素尺寸（`'1792x1024'`），应在发送前统一转换
3. **`||` 降级模式比 `if/else` 更安全**：`aspectRatioToSize(x) || x` 保证无法转换的值会透传
4. **异步尺寸更新优于同步锁定**：`lockReferenceDimensions=false` 允许图片加载后自适应，用户体验更好

### 排查方法论

- **参数链路追踪**：从 UI → Parser → Engine → Service → Executor → API Body，逐层验证
- **边界层防御**：在 API 边界（`buildImageRequestBody`）做参数校验和转换，不依赖上游正确性
- **全局调用审计**：修改参数签名后需 grep 全部调用者，确保所有路径一致