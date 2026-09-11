# Feedloom

Feedloom 面向个人阅读和可直接复制的知识分享、产品发现：独立管理转发内容，通过收集任务持续获得素材，再人工选材并按提示词生成 Feed。

## 当前状态

仓库包含已确认的 MVP PRD、五页桌面设计图和目标技术架构。旧版产品 Pitch Demo 已移除，历史实现保留在 Git 历史中。

当前没有可运行的应用、依赖清单或应用测试命令。Electron 桌面应用、Pi 集成、真实平台收集和 Feed 生成尚未实现；设计图与技术方案不代表运行验证。

## 文档

- [MVP 产品需求](docs/mvp-prd.md)：产品行为与验收场景。
- [页面设计](docs/design/README.md)：五页已确认的视觉参考。
- [项目规划](docs/project-plan.md)：交付阶段与产品边界。
- [技术架构](docs/technical-architecture.md)：已确认、待实施的技术方案。
- [文档政策](docs/documents.md)
- [Agent 开发约束](AGENTS.md)

## 验证

文档变更运行 `git diff --check`，并检查仓库内文档与图片链接指向存在的文件。应用代码落地时再建立对应的构建与测试命令。

## 开源许可

尚未选择开源许可证。公开可见不代表已授予复制、修改或分发许可。
