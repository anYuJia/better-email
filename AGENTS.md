# Better Email — Project Instructions

## Git 提交规范

每次提交必须使用严格的 `feat:中文` 格式：

* 提交信息必须以 `feat:` 开头。
* `feat:` 后直接填写中文描述，不添加空格。
* 示例：`feat:修复邮件切换动画`

## UI/UX source of truth

All UI/UX implementation must follow:

* `docs/design/UI_UX_SPEC.md`
* `docs/design/reference/`

These files are the product design source of truth.

When working on UI, layout, responsive behavior, interaction, styling, navigation, settings, composer, inbox, reader, dialogs, empty states, loading states, or mobile UI, read the UI/UX specification before modifying code.

Do not invent a new visual language unless the task explicitly requests a redesign.

---

## Product design direction

Better Email is a professional, efficient, calm email client.

The interface must feel:

* clean
* restrained
* native
* efficient
* information-dense without feeling crowded
* professional rather than decorative
* consistent across desktop and mobile

The approved visual direction uses a restrained green accent on a neutral white / dark interface.

The email content is the product. UI chrome should stay visually quiet.

Avoid “AI-generated SaaS UI” styling.

---

## Non-negotiable UI rules

### 1. Consistency first

Existing approved screens define the design language.

When creating a new screen:

1. Reuse existing tokens.
2. Reuse existing components.
3. Reuse existing spacing.
4. Reuse existing typography.
5. Reuse existing interaction patterns.
6. Reuse existing navigation conventions.

Never create a visually different component for the same semantic action.

The same component must look and behave the same everywhere.

---

### 2. Desktop mail workspace

The normal desktop mail interface uses the three-pane structure:

* mailbox/navigation sidebar
* message list
* reading pane

The three panes must remain visually aligned and share the same vertical structure.

Do not convert normal rows into floating cards.

Do not add unnecessary background blocks, gradients, glass effects, or oversized shadows.

---

### 3. Settings is a separate product surface

Desktop Settings is NOT rendered inside the normal mail workspace.

When Settings is opened:

* the mail folder sidebar disappears
* the inbox/message list disappears
* the reading pane disappears
* Settings becomes a full application-level secondary surface

Settings has its own navigation and content layout.

Do NOT show:

* 收件箱
* 星标邮件
* 已发送
* 草稿箱
* 邮件文件夹
* mail list
* reading pane

inside the desktop Settings interface.

The Settings surface may retain only application-level chrome when appropriate.

This rule is mandatory.

---

### 4. Mobile is not a scaled desktop layout

Mobile screens must be designed natively for touch.

Use full-screen navigation.

A secondary settings page pushes onto a new screen.

Do not place desktop sidebars on mobile.

Do not squeeze desktop multi-column layouts into a phone width.

---

## Approved UI hierarchy

Primary surfaces:

* Inbox / message list
* Mail reader
* Composer
* Search / filtering
* Settings
* Account management

Secondary surfaces:

* Appearance & layout
* Writing preferences
* Notifications
* Security & privacy
* Storage & attachments
* Advanced settings
* About / help

---

## Visual rules

Use:

* neutral backgrounds
* subtle 1px separators
* restrained green accent
* strong typography hierarchy
* generous whitespace where content needs focus
* compact controls for productivity workflows
* subtle hover and selected states

Avoid:

* gradients
* glassmorphism
* excessive shadows
* excessive pills
* excessive rounded cards
* floating decorative containers
* large empty hero areas
* colored backgrounds without semantic purpose
* arbitrary icon sizes
* arbitrary corner radii

---

## Interaction rules

Every interactive element must have appropriate states:

* default
* hover
* pressed
* focus
* disabled
* selected
* loading when applicable

Keyboard navigation must remain usable on desktop.

Touch targets must remain usable on mobile.

Do not hide essential functionality behind hover-only interactions on touch devices.

---

## Responsive rules

Every UI change must be checked at minimum at:

Desktop:

* 1440×900
* 1280×800
* 1024×768 when supported

Mobile:

* 390×844
* 393×852
* 430×932

Also check:

* long Chinese text
* long English text
* empty content
* large content
* 125% / 150% text scaling where applicable

---

## Before implementing UI changes

Before editing UI code:

1. Inspect the current component.
2. Inspect neighboring components.
3. Read `docs/design/UI_UX_SPEC.md`.
4. Check the relevant reference images.
5. Identify existing reusable primitives and design tokens.
6. Preserve existing functional behavior unless the task explicitly changes it.

Do not solve local UI problems by adding one-off CSS overrides if the issue belongs in a shared component or token.

---

## After implementing UI changes

Verify:

* visual hierarchy
* spacing consistency
* typography consistency
* icon consistency
* selected/hover/focus states
* responsive behavior
* light/dark behavior
* keyboard navigation
* mobile touch interaction
* empty/loading/error states

Run the project's existing format, lint, analysis, test, and UI regression commands relevant to the changed area.

Do not claim visual completion without checking the actual rendered interface.

---

## UI decision priority

When requirements conflict, use this order:

1. Explicit task requirements
2. `docs/design/UI_UX_SPEC.md`
3. Approved reference images
4. Existing shared design system
5. Existing implementation
6. New design invention

Prefer removing visual complexity over adding decoration.
