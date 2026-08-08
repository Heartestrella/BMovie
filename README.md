# BMovie

BMovie 是一个 Android 私人媒体库应用。应用通过 Capacitor 运行 Vue 前端，并在 APK 内启动独立的 OpenList 服务，用统一目录访问网盘和本地存储。

## 已实现

- OpenList sidecar 自动启动、健康检查、管理员初始化与登录
- 动态读取 OpenList 驱动定义，添加、列出和删除存储
- 文件目录浏览、刷新、直链播放
- MP4 等浏览器原生格式与 HLS 播放
- 同名 SRT/VTT 字幕自动加载
- 媒体目录递归扫描、搜索与本地持久化
- 播放进度、断点续播、首页继续观看
- TMDB 专用/综合搜索、翻译与别名校验，并按 TMDB → Bangumi → TVmaze 自动降级
- TMDB 海报缺失时使用 OpenList 视频缩略图，完全无画面时显示统一媒体占位

## 开发

```powershell
pnpm install
pnpm dev
pnpm build
pnpm android:sync
pnpm android:run
```

Android 包目前只包含 `arm64-v8a` OpenList 二进制。调试 APK 输出到 `android/app/build/outputs/apk/debug/app-debug.apk`。

## 首次使用

1. 打开“设置 → 网盘存储”。
2. 选择 OpenList 驱动并填写驱动要求的字段。
3. 打开“媒体库”并执行扫描。
4. 可选：在“设置 → TMDB 元数据”中配置 API Read Access Token。

管理员凭据由应用随机生成并保存在应用私有存储中。OpenList 仅监听设备回环地址。
