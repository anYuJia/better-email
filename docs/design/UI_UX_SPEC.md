# Better Email UI/UX Design Specification

Version: 1.0
Status: Product UI source of truth

---

# 1. Product design philosophy

Better Email is a professional productivity email client.

The interface should make users feel:

**简洁 · 高效 · 专注 · 稳定 · 专业**

The design should resemble a mature desktop productivity application rather than a web dashboard.

The interface exists to support:

* scanning mail quickly
* reading without distraction
* composing efficiently
* handling multiple accounts
* processing large volumes of email
* switching between desktop and mobile without relearning the product

The UI should disappear behind the task.

---

# 2. Core design principles

## 2.1 Content first

Email content always has higher visual priority than application chrome.

Avoid making navigation, toolbars, borders, cards, or decorative elements visually louder than the message itself.

## 2.2 Calm density

Better Email is information-dense, but not visually crowded.

Density should come from good alignment and hierarchy, not smaller text everywhere.

## 2.3 Progressive disclosure

Do not permanently expose every capability.

Frequently used actions are immediately visible.

Secondary actions appear in:

* contextual menus
* overflow menus
* secondary screens
* expandable advanced sections

## 2.4 One semantic action, one visual language

The same action must use the same:

* icon
* name
* size
* color semantics
* interaction feedback

throughout the application.

## 2.5 Native interaction

Desktop should feel like a professional desktop client.

Mobile should feel like a native touch application.

Neither platform should look like a scaled version of the other.

---

# 3. Brand and color system

## Primary accent

Use a restrained professional green.

Recommended base:

* Primary: `#0F9F63`
* Primary hover: `#0B8A55`
* Primary pressed: `#08764A`
* Primary subtle: `#EAF7F0`
* Primary faint: `#F4FBF7`

The exact existing implementation token takes priority if already established.

Green is reserved for:

* primary action
* selected navigation
* active state
* success
* verified/trusted indicators
* focus emphasis where appropriate

Do not paint large areas green unnecessarily.

---

# 4. Neutral colors

Light mode:

* App background: `#FFFFFF`
* Secondary background: `#FAFBFC`
* Tertiary background: `#F6F7F8`
* Primary text: `#111827`
* Secondary text: `#667085`
* Tertiary text: `#98A2B3`
* Divider: `#E7E9ED`
* Strong divider: `#D9DDE3`

Dark mode should preserve the same hierarchy rather than simply invert colors.

Dark mode:

* Background around `#111315`
* Surface around `#171A1D`
* Elevated surface around `#1C2024`
* Primary text around `#F3F4F6`
* Secondary text around `#A7AFB9`
* Divider around `#292E34`

Accent hue must remain consistent between light and dark themes.

---

# 5. Semantic colors

Use colors semantically.

Success:

* green

Warning:

* amber/orange

Error / destructive:

* red

Information:

* blue

Neutral:

* gray

Labels may use additional colors but must remain low saturation.

Never use arbitrary colors only for decoration.

---

# 6. Typography

Use the platform-appropriate system font stack unless the project already defines another approved font.

Recommended hierarchy:

## Desktop

Page title:

* 22–24px
* weight 600–650

Section title:

* 16–18px
* weight 600

Mail sender:

* 14–15px
* weight 500 / 600 unread

Mail subject:

* 13.5–14.5px
* weight 500 / 600 unread

Preview:

* 12.5–13.5px
* regular

Reader title:

* 20–24px
* weight 600

Reader body:

* 14.5–15px
* line-height approximately 1.55–1.65

Metadata:

* 12–13px

## Mobile

Large page title:

* approximately 28–32px

Navigation title:

* approximately 17–20px

Mail sender:

* approximately 16px

Subject:

* approximately 15px

Preview:

* approximately 13–14px

Reader body:

* approximately 16–17px
* comfortable line-height

Do not use tiny typography to create artificial information density.

---

# 7. Spacing system

Use a consistent spacing scale.

Preferred scale:

* 4
* 8
* 12
* 16
* 20
* 24
* 32
* 40
* 48

Avoid arbitrary values unless technically required.

Common usage:

* icon/text gap: 8px
* compact control inner gap: 8px
* row side padding: 12–16px
* desktop section spacing: 20–24px
* mobile screen padding: 16–20px
* large content separation: 24–32px

---

# 8. Radius

Better Email is not a heavily rounded product.

Recommended:

* inline control: 6px
* input: 6–8px
* button: 6–8px
* popover: 10px
* modal / floating composer: 10–12px
* grouped mobile setting section: 12–14px

Normal email rows should not look like standalone floating cards.

Do not use exaggerated 16–24px radii throughout the interface.

---

# 9. Shadows

Default workspace surfaces:

**no shadow**

Use shadows only when representing elevation:

* popover
* dropdown
* floating composer
* modal
* transient overlay

Shadow should be subtle.

Do not use shadow to separate ordinary page sections.

Use dividers and hierarchy instead.

---

# 10. Icon system

Icons must share:

* one icon family
* consistent stroke character
* consistent visual size

Desktop visible glyph:

approximately 16–18px.

Touch target may remain 32–40px.

Mobile visible icon:

approximately 20–24px.

Touch target:

minimum approximately 44px.

Do not mix filled, outlined, cartoon, and platform-specific icon styles arbitrarily.

Use filled icons only for clear selected/active semantics when the icon system supports it.

---

# 11. Desktop application architecture

Normal desktop mail view uses a three-pane structure.

## Pane A — Mail navigation

Recommended width:

`220–244px`

Contains:

* Better Email branding
* Compose
* Inbox
* Starred
* Sent
* Draft
* Snoozed
* Archive
* Spam
* Trash
* folders
* smart folders
* labels
* account entry / app utilities

Visual behavior:

* flat navigation rows
* low contrast default state
* subtle green selection surface
* selected item uses green icon/text emphasis
* counts aligned on the trailing edge

Do not wrap each navigation item in a card.

## Pane B — Mail list

Recommended width:

approximately `360–410px`

Resizable where supported.

## Pane C — Reader

Fluid width.

Reader should receive the largest available width.

If reader width becomes too narrow, change layout mode instead of endlessly compressing content.

---

# 12. Desktop inbox header

Keep the mail list header compact.

Preferred structure:

Title / mail count

Search

Tabs / filters

Sort or view controls

Avoid stacking multiple permanent 50–60px toolbars.

Important goal:

Users should see the first mail quickly.

---

# 13. Desktop message list

Default density should be comfortable but efficient.

Recommended default row:

approximately 60–68px.

Alternative user density options may include:

* compact
* standard
* comfortable

Each row should prioritize:

1. Sender
2. Time
3. Subject
4. Preview
5. Essential status metadata

Optional metadata appears only when relevant.

Avoid permanently showing:

* multiple labels
* attachment text
* star
* checkbox
* badges
* indicators
* multiple action icons

all at once.

## Unread state

Use restrained signals.

Recommended:

* small unread dot
* sender/subject weight increase

Do not simultaneously exaggerate:

* background
* text weight
* border
* dot
* badge

unless specifically necessary.

## Selected state

Selected mail:

* very subtle green-tinted surface
* thin green leading indicator if needed

Avoid saturated green fills.

## Checkbox

Checkbox can appear:

* on hover
* after entering multi-select
* when keyboard selection mode requires it

Do not permanently sacrifice avatar space for a checkbox.

---

# 14. Desktop reader

Reader exists for calm reading.

## Header

Order:

1. subject
2. minimal status / label
3. sender identity
4. recipient information
5. time
6. essential actions

Permanent primary reader actions should be limited.

Recommended:

* Reply
* Archive
* Snooze
* More

Other operations may move into overflow.

## Content width

Reader pane can be wide.

Actual plain-text reading measure should remain approximately:

`680–760px`

HTML mail may use its original layout when required.

## Reader body

Avoid wrapping normal mail content inside decorative cards.

The email body itself is the primary surface.

---

# 15. Security and translation UI

Security information should be contextual.

Do not permanently display large security banners for normal mail.

Use a compact status row when:

* sender is verified
* images were blocked
* phishing risk exists
* remote content requires permission

Translation should appear contextually when another language is detected.

Example:

`检测到英文 · 翻译`

rather than occupying permanent toolbar space.

---

# 16. Quick Reply

Quick Reply is intentionally simple.

Preferred layout:

* lightweight editor
* optional attachment button
* expand to full composer
* send

Avoid unnecessary permanent UI such as:

* character count
* clear button
* advanced formatting toolbar
* template picker
* scheduling controls

Those belong in the full composer.

---

# 17. Desktop Composer

Desktop composer is a non-modal productivity window.

This rule is important.

Users must be able to:

* read another mail
* switch conversations
* copy information
* browse folders
* return to the draft

while the composer remains open.

Therefore desktop composer should NOT normally:

* block the entire application
* add a dark full-screen backdrop
* make the mail workspace inert

Recommended default:

* floating bottom-right or centered-right window
* approximately 640–720px wide
* approximately 520–640px high
* draggable
* minimizable
* expandable
* autosaved

## Composer hierarchy

Primary:

* From
* To
* Subject
* Body
* Attachments
* Send

Secondary:

* Cc / Bcc
* formatting
* signature
* templates
* schedule send

Advanced:

* delivery options
* encryption
* advanced headers
* AI writing tools

Use progressive disclosure.

---

# 18. Desktop Settings architecture

## Critical rule

Settings is a separate application-level surface.

When desktop Settings opens, the normal mail workspace is replaced.

Do not show the normal mail navigation/sidebar beside Settings.

In Settings:

NO Inbox navigation.

NO folders.

NO mail list.

NO reader.

NO Compose button belonging to the mailbox workspace.

Settings should feel like opening a dedicated preference workspace, similar to a mature desktop application.

---

# 19. Desktop Settings — root screen

Recommended structure:

Left side:

Settings navigation only.

Examples:

* Overview
* Account & Mailboxes
* Appearance & Layout
* Writing
* Reading
* Notifications
* Shortcuts
* Rules & Automation
* Security & Privacy
* Storage & Attachments
* Integrations
* Advanced
* About

Main area:

content of the selected category.

Top-level Settings should not become an oversized dashboard full of decorative cards.

Prefer clear rows, groups and panels.

---

# 20. Desktop Settings navigation

Recommended width:

approximately `220–250px`.

Selected item:

* subtle green background
* green icon / text
* no heavy border

Settings sidebar remains dedicated to Settings until Settings closes.

A visible exit/back action should return to the mail workspace.

---

# 21. Settings secondary pages

Settings follows:

**Settings → category → detailed controls**

Do not show all possible options on one screen.

Example:

Settings

→ Appearance & Layout

Then display:

* Theme
* Accent color
* Density
* Font size
* Reading pane position
* Preview lines
* Avatar visibility
* Unread indicator
* Reduce motion

This is preferable to showing every setting on the Settings root.

---

# 22. Settings control design

Setting row layout:

Left:

* setting name
* short explanation if necessary

Right:

* switch
* segmented control
* select
* button
* disclosure arrow

Avoid:

* giant controls
* large promotional cards
* excessive icons
* nested boxes around every individual setting

Use section dividers and grouped rows.

---

# 23. Mobile navigation architecture

Mobile is a full-screen stack.

Primary bottom navigation should remain consistent throughout main-level application screens.

Recommended destinations:

* Mail
* Starred / relevant primary area
* Compose
* Contacts or another approved primary product area
* Settings

Compose may use the central emphasized action.

Do not arbitrarily change bottom navigation between screens.

---

# 24. Mobile Inbox

Recommended structure:

Page title

Unread count

Search

Filter

Category tabs

Mail list

Bottom navigation

Mail row hierarchy:

* avatar
* unread indicator
* sender
* time
* subject
* preview
* trailing relevant state

Rows should be full-width with subtle separators.

Avoid mobile card stacks for each mail.

---

# 25. Mobile Reader

Reader opens as a dedicated screen.

Top:

* back
* archive
* delete
* snooze
* more

Then:

* subject
* sender
* recipient details
* time
* security/context information if relevant
* body

Bottom:

* reply
* forward
* more

or a compact reply surface depending on the context.

Email body should receive most of the screen.

---

# 26. Mobile Composer

Composer is full-screen.

Top:

* close/back
* title
* contextual overflow

Fields:

* recipient
* Cc/Bcc when expanded
* subject

Then body.

Attachments appear near body end.

Formatting and advanced functions live in a bottom toolbar or secondary sheet.

Primary Send action remains obvious.

Do not reproduce a desktop floating window on mobile.

---

# 27. Mobile Settings root

Settings root uses a native hierarchical settings pattern.

Structure:

Title

Account summary

Grouped setting categories

Examples:

Preferences:

* Account & Mailboxes
* Appearance & Layout
* Writing
* Notifications

Security & Data:

* Security & Privacy
* Storage & Attachments
* Advanced

Support:

* Help & Feedback
* About Better Email

The root screen displays categories, not all setting controls.

---

# 28. Mobile Settings secondary pages

Selecting a Settings category opens a new full-screen page.

Example:

`设置 → 外观与布局`

Header:

`< 设置      外观与布局`

Content contains only Appearance settings.

The main Settings list is no longer visible.

Do not create a side-by-side desktop-style settings layout on mobile.

---

# 29. Form controls

Use native-feeling controls.

Switch:

binary state.

Segmented control:

2–4 mutually exclusive short options.

Dropdown/select:

larger option sets.

Radio:

rare; use only where visually clearer than segmented control.

Checkbox:

independent multiple selections.

Do not use a switch for an action.

Do not use pill buttons for ordinary settings rows.

---

# 30. Buttons

Primary button:

green fill.

Secondary:

neutral surface / outline.

Destructive:

red text or restrained destructive outline.

Avoid multiple primary buttons in the same visual group.

Typical heights:

Desktop:
32–36px

Mobile:
44–48px touch area

---

# 31. Empty states

Empty states should explain:

* what happened
* what the user can do next

Do not create oversized illustrations unless they add real value.

Example:

`暂无邮件`

`新邮件会显示在这里。`

Optional action:
`刷新`

---

# 32. Loading state

Prefer skeleton loading for list/content surfaces.

Do not replace the entire application with a spinner when the existing shell can remain usable.

Synchronizing email should not unnecessarily block reading already downloaded mail.

---

# 33. Error / offline state

Offline and synchronization errors should preserve access to cached content when possible.

Use a compact persistent banner/status indicator rather than disruptive modal dialogs for recoverable errors.

Errors must communicate:

* what failed
* whether data is safe
* what the user can do

---

# 34. Destructive actions

Actions such as:

* delete account
* clear local data
* delete mailbox
* permanently delete messages

must use explicit destructive semantics.

Use red only here.

Confirmation should clearly state impact.

Do not use generic:

`确定？`

Use concrete text:

`永久删除账户`

---

# 35. Motion

Motion should communicate state change, not decorate the interface.

Recommended durations:

* micro feedback: ~120ms
* normal UI transition: ~180ms
* panel transition: ~240ms

Respect reduced-motion accessibility preferences.

Avoid:

* springy card animations
* exaggerated scale
* large parallax
* animated gradients
* unnecessary fade sequences

---

# 36. Accessibility

Must support:

* keyboard navigation on desktop
* visible focus
* screen reader semantics where supported
* sufficient contrast
* readable font scaling
* reduced motion
* touch-friendly mobile controls

Never remove focus outlines without supplying an accessible replacement.

---

# 37. Copywriting

Use concise interface text.

Avoid technical jargon unless the page is explicitly advanced/developer-facing.

Chinese labels should sound like native product copy rather than translated English.

Prefer:

`稍后处理`

over awkward technical terminology.

Descriptions should usually fit within one concise sentence.

---

# 38. Cross-platform visual consistency

Desktop and mobile are the same product.

The following must remain identical in meaning:

* accent hue
* status semantics
* icon meaning
* terminology
* account identity
* unread semantics
* mail state
* destructive semantics

Layouts may differ by platform.

Interaction model may differ by platform.

Visual identity must not.

---

# 39. Component reuse

Before creating a new UI primitive, search for an existing implementation.

Prefer shared primitives for:

* Button
* IconButton
* Input
* Search
* NavigationRow
* MailRow
* Avatar
* Badge
* Toggle
* SegmentedControl
* Select
* Menu
* Tooltip
* Modal
* Popover
* EmptyState
* ErrorState
* Skeleton
* SettingRow
* SectionHeader

One-off copies are discouraged.

---

# 40. CSS / styling rule

Do not solve systemic design problems with page-specific overrides.

Avoid accumulating:

* duplicate selectors
* unnecessary `!important`
* multiple competing style layers
* arbitrary hardcoded colors
* arbitrary spacing
* duplicate responsive logic

Fix the owning primitive/token/component whenever possible.

---

# 41. Visual regression rule

For substantial UI work, compare the finished implementation against the approved reference visuals.

At minimum inspect:

Desktop:

* inbox
* reader
* composer
* settings root
* settings secondary screen

Mobile:

* inbox
* reader
* composer
* settings root
* settings secondary screen

Do not validate only one viewport.

---

# 42. Design anti-pattern blacklist

Do NOT introduce:

* dashboardification of ordinary settings
* glassmorphism
* gradients as decoration
* excessive card nesting
* pill-everything UI
* huge corner radius
* strong box shadows
* neon colors
* oversized empty whitespace
* icon inconsistency
* duplicate navigation
* unnecessary modal dialogs
* desktop UI shrunk onto mobile
* mobile UI stretched onto desktop
* giant SaaS-style hero panels
* promotional visual noise inside productivity workflows

---

# 43. Final quality bar

A finished Better Email screen should pass these questions:

1. Is the primary task obvious within one second?
2. Is the content visually stronger than the chrome?
3. Is anything visible that the user does not currently need?
4. Does this use existing product components?
5. Does this look like the same application as the Inbox?
6. Does it remain coherent in dark mode?
7. Is the mobile version truly designed for touch?
8. Are keyboard and focus states correct?
9. Is the layout stable with long text?
10. Could removing something make the screen better?

If the answer to #10 is yes, prefer simplification.

---

# 44. Reference implementation rule

Approved screenshots stored under:

`docs/design/reference/`

are visual references, not pixel-perfect templates.

They define:

* hierarchy
* density
* component character
* visual language
* navigation model
* overall polish

When a screenshot conflicts with real usability, accessibility, platform behavior, or existing functionality, preserve the product behavior and apply the design language rather than blindly copying pixels.

---

# 45. Product identity summary

Better Email should feel:

**Professional without being corporate.**

**Minimal without being empty.**

**Dense without being crowded.**

**Modern without chasing trends.**

**Powerful without exposing every feature at once.**

**Native without blindly copying the operating system.**

The final visual principle is:

> 邮件是主角，界面退到背景。
