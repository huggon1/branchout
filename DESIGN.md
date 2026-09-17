---
name: nature-feed
description: "现代参考阅览室：安静的纸面与清晰的操作反馈"
colors:
  canvas: "#fbfcfa"
  surface: "#ffffff"
  subtle: "#f3f5f1"
  ink: "#202a26"
  secondary: "#49594f"
  muted: "#627168"
  accent: "#35705a"
  accent-hover: "#285943"
  selected: "#e7eee9"
  line: "#dce3dc"
  control-line: "#a6b3a9"
  focus: "#35705a"
  success: "#286147"
  success-bg: "#eaf3ed"
  warning: "#855914"
  warning-bg: "#faf1df"
  danger: "#a13f36"
  danger-bg: "#f9eeeb"
typography:
  brand:
    fontFamily: "\"Newsreader\", serif"
    fontSize: "23px"
    fontWeight: 600
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "19px"
    fontWeight: 670
  reading-title:
    fontFamily: "\"Newsreader\", \"Songti SC\", \"Noto Serif CJK SC\", serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "14px"
    fontWeight: 400
  reading-body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.9
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "12px"
rounded:
  control: "10px"
  surface: "12px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "7px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  navigation-active:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "{spacing.3}"
  status-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success}"
    rounded: "6px"
    padding: "5px 8px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.surface}"
    padding: "25px"
---
# Design System: nature-feed

## Overview

**Creative North Star: "现代参考阅览室"**

现代参考阅览室以近白纸面、墨绿文字和松绿操作构成安静的工作环境。细边界与淡绿选中态让内容、来源和执行状态易于区分；衬线只为字标与阅读标题提供轻微的出版物气质。

控件参考 Claude 公开登录页已观察到的轻边界、整行展开与克制反馈；仍保留本站松绿配色与中文内容层级。当前品牌为 nature-feed，含 Feedloom 的旧风格图仅供历史视觉参考，不提供名称、布局、文案或参数依据。

用户确认的是视觉语言，不是固定布局、整页效果图、示例文案或图中参数。阅读、探索与产出没有全产品的固定主次，各页面按任务决定密度与操作位置。本文记录当前桌面实现；产品规则见 [PRODUCT.md](PRODUCT.md) 与 [MVP PRD](docs/mvp-prd.md)，持续设计和验收按 [设计流程](docs/design/workflow.md) 执行。

**Key Characteristics:**

- 近白纸面与细线分区，常驻容器保持平面。
- 松绿操作、淡绿选中态和独立的语义状态色。
- 无衬线界面与正文，克制的衬线阅读标题。
- 轮廓 SVG 图标、折叶品牌标记与 nature-feed 字标。

## Colors

主色是克制的松绿，底色为接近纸白的中性绿灰。精确值以页首令牌为准，运行时来源为 [tokens.css](src/ui/tokens.css)。Sidecar 中的色阶是供面板展示的推导色阶，不是新增运行时配色。

### Primary

`accent` 用于主要操作、链接、导航选中与轮廓图标；`accent-hover` 使主要操作悬停时加深，`selected` 承载淡绿选中底。`focus` 与主色同值，但保留独立的焦点角色。

### Neutral

`canvas` 是工作区底色，`surface` 是白色容器，`subtle` 用于侧栏和次级分区。`ink` 承载正文，`secondary` 与 `muted` 处理次级信息；`line` 划分区域，`control-line` 强化悬停边界、引用线与滚动条。

成功、警告和失败分别使用对应前景与背景令牌；执行中沿用主色和选中底。语义色并非额外品牌主色，不能只靠颜色表达状态。

## Typography

Newsreader 字体随应用打包，授权见 [字体许可证](src/ui/fonts/OFL-Newsreader.txt)。它承担拉丁字标与阅读标题中的拉丁字形；中文阅读标题回退到目标 macOS 已安装的 Songti SC，其后保留 Noto Serif CJK SC 与通用衬线回退。中文字体没有随应用打包，不保证跨平台字形完全一致。

界面、表单、素材列表标题与正文使用系统无衬线栈。阅读详情标题使用 `reading-title`；正文使用 `reading-body`。普通页面标题使用 `headline`，区域标题使用 `title`。字阶按任务设置，不是等比缩放体系。

阅读正文限制在 72ch，正文中的一级、二级标题分别为 25px 与 21px 并使用阅读字体，三级标题保留无衬线。素材标题实际为 15px，摘要为 13px，状态与辅助信息通常为 12px。导航的默认字重为 540，选中为 650；统计数字使用等宽数字特性。

## Layout

当前实现采用固定左侧目录和可伸缩工作区。默认侧栏为 208px，主区内边距为 36px 40px 64px，最大宽度为 1900px；这些是现有外壳尺寸，不是对未来页面构图的授权限制。

列表与详情、探索配置、素材与编排分别采用适合任务的网格。通用间距变量以 4px 为起点，组件中仍存在 9px、10px、13px、18px、20px、25px 等情境值，不能宣称所有距离都遵循单一倍数。筛选区以细线分隔，默认四列，生成页三列。

在 1250px 以下，侧栏为 190px，主区横向留白为 24px，顶部为 32px，通用面板内边距为 21px；连接设置在 1150px 以下收紧目录和内边距。1000px 以下生成页转为单列、编排取消粘性定位，部分表格辅助列隐藏。这些是窗口收缩策略；首版验收仍为桌面，尺寸与页面职责见 [页面设计入口](docs/design/README.md)。

## Elevation & Depth

常驻面板、列表和表单没有投影，用背景层次、细边框和留白分区。弹窗和展开的选择菜单是明确的例外。选择菜单使用轻量投影，弹窗使用更深投影：使用 `--shadow-overlay`，遮罩为半透明墨绿并带 4px 背景模糊；弹窗最高 90vh，内部可滚动。阴影和遮罩精确值记录在配套 sidecar。

按钮对背景和边框执行短促反馈，使用运行时的反馈时长与缓动；输入、勾选和展开控件也使用同一时长，但当前没有显式指定同一缓动。当前没有页面入场动画；系统减少动态效果偏好会关闭过渡。

## Shapes

按钮、输入框与多数交互容器使用控制圆角，面板使用表面圆角。边框通常为 1px；引用与时间线也用细线组织。并非所有形状统一圆角：标签和复选框为 5px，状态为 6px，菜单选项为 7px，折叠标题与选择行为 8px，行内代码为 4px，标题链接为 3px，圆点为圆形；原有本地状态徽标保留 20px 圆角但背景透明且无边框。版本信息、筛选条与统计分区可以完全无圆角。

通用图标采用 24×24 视框、20px 显示尺寸与 1.6px 圆头轮廓线；外链图标在来源操作内缩小。品牌标记为独立的折叶图形：侧栏使用 28×32 SVG 与 2px 线条，[应用图标源文件](assets/brand.svg) 使用松绿圆角底与浅色折叶轮廓。应用和菜单栏复用该品牌形态，不用导航图标充当 Logo。

## Components

### Buttons

主要按钮使用松绿底与白字，次要按钮为白底细边框，轻操作为透明底与次级文字。悬停改变背景和边框，按下强调主色边框；禁用透明度为 0.45 并显示不可用光标。键盘焦点使用 3px 外轮廓与 3px 偏移。轻按钮仍继承通用悬停与焦点行为。

### Inputs / Fields

输入框、选择框与文本域为白底轻边界，最小高度为 40px，内边距见页首。悬停加深边框，焦点使用松绿边框、2px 淡绿轮廓与 1px 偏移。禁用为次级底与文字，不可用光标；`aria-invalid="true"` 显示危险色边框，但具体表单仍需保留可读错误提示。占位文字使用次级文字色，光标为松绿；文本域允许纵向调整。

选择菜单在支持 `appearance: base-select` 的运行时使用自定义弹出层、选中勾号与旋转箭头。菜单选项使用淡底悬停和淡绿选中；不支持时保留原生菜单，并用内嵌 SVG 绘制闭合箭头。展开态与键盘选择必须按实际 Electron 版本验证，不能只检查闭合外观。

复选框保留原生输入语义，自绘未选、已选、半选和禁用外观；已选勾号与半选横线均由 SVG 绘制。仓库与角度选择标签提供整行命中、悬停底与选中底，不把小方框作为唯一点击入口。

折叠区使用原生 `details` / `summary`，标题整行可操作，右侧细线箭头随展开转向；悬停或展开时出现次级底，展开后正文与标题分离。键盘焦点仍使用通用可见轮廓。

### Navigation

目录使用图标加文字，选中态为淡绿底和加深字重；悬停继承按钮边框反馈。设置入口靠近侧栏底部。连接目录采用图标列与文字列，名称允许折行，使用中状态置于文字下方，避免挤压名称。

### Chips

来源标签是低对比小矩形，状态标签按成功、进行中、部分成功、失败等语义选择配色。普通标签、可点击筛选与状态不共用同一种行为：静态状态没有虚构的悬停反馈；筛选按钮继承按钮交互。

### Cards / Containers

通用面板为白底、细线、小圆角，默认内边距见页首，窄窗口会收紧。素材表格靠分隔线、悬停底与选中底辨认行；选中行不通过投影抬高。弹窗的深度见上一节。

### Reading / Evidence

原文使用宽松行高，AI 摘要使用淡底与细侧线，发现依据保留引用与来源。代码块与宽表格可独立横向滚动。内容中的语义标记不构成新增装饰性眉题的通用许可。

## Do's and Don'ts

### Do:

- Do：复用运行时变量与已有组件，按页面任务安排阅读、控制和产出。
- Do：为交互保留可见焦点；状态同时写明含义，长标题与错误信息允许换行。
- Do：沿用统一轮廓 SVG；品牌标记保持独立。
- Do：用当前 Electron 页面验收桌面尺寸、中文内容、空状态和异常状态，并实际展开菜单、操作半选框与折叠区。

### Don't:

- Don’t：把风格板或当前页面网格当作用户批准的固定布局。
- Don’t：把所有标题和正文改成衬线，或用大面积高饱和装饰替代内容层级。
- Don’t：给每张静态卡片加阴影，或用字符代替动作图标。
- Don’t：把原文、AI 摘要、发现理由和运行状态混成无法辨认的一段。
