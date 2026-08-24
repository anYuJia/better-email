# Better Email UI/UX Specification

Status: final desktop workspace doctrine, Phase 1.1.

This document is the repository source of truth for Better Email visual and interaction decisions. The local visual probes in `docs/design/reference/` are evidence, not a license to copy pixels mechanically. When a reference image conflicts with product behavior, accessibility, or the rules below, preserve the product rule and record the difference.

## 1. Design philosophy

Better Email is a local-first, multi-account desktop mail client for people who process email continuously. The interface should feel like a mature desktop tool: calm, dense, explicit, and fast.

The governing principles are:

1. **Mail first.** Sender, subject, body, attachments, and the next safe action outrank decorative chrome.
2. **Context stays visible.** Account scope, folder, selection, sync state, and security state must be easy to identify.
3. **Familiar and precise.** Use established desktop-mail patterns and standard controls. Do not reinvent navigation for novelty.
4. **Quiet density.** Organize density with typography, rhythm, separators, and semantic surfaces instead of stacked cards.
5. **Trust through clarity.** High-risk actions, remote content, credentials, and cross-account operations need direct language and visible consequences.
6. **Performance is design.** First paint, list scrolling, reader navigation, resize, and compose interactions must remain stable before adding effects.

The product register is **product**, not brand campaign. Visual personality comes from restraint, green action states, cool neutral workspace planes, and careful text hierarchy.

## 2. Source of truth and change protocol

Use this order when making a UI decision:

1. This specification.
2. The relevant token, primitive, or shared component already in the repository.
3. The matching reference image in `docs/design/reference/`.
4. Existing accessibility and behavior contracts in tests.

Before editing a UI surface:

- Read this document and the relevant reference image.
- Inspect the owning component and its stylesheet.
- Prefer changing a shared token or owner stylesheet over adding an override file.
- Preserve DOM semantics, keyboard behavior, test selectors, and current product actions unless the task explicitly changes them.
- For a substantial change, capture real browser screenshots at the affected viewport sizes, compare the same data and selected item, and record meaningful deltas.
- Never add a screenshot, local design probe, temporary debug log, or browser artifact to the repository.

The files in `docs/design/reference/` are local ignored visual references. They are not product assets and must not be renamed, edited, force-added, or committed.

## 3. Green color system

The canonical accent is the Better Email green family. Components consume semantic `--ui-*` tokens, which resolve through `src/design-tokens.css`. Raw colors must not be scattered through component CSS.

### Accent roles

| Role | Token | Use |
| --- | --- | --- |
| Accent | `--ui-accent` | Primary action, current navigation, current mail indicator, selected text emphasis |
| Accent hover | `--ui-accent-hover` | Hover and pointer-over state |
| Accent pressed | `--ui-accent-pressed` | Active/pressed state |
| Accent soft | `--ui-accent-soft` | Quiet tint for selected or contextual surfaces |
| Focus | `--color-focus` / `--ui-focus-outline` | Keyboard focus, never a decorative glow |
| Text on accent | `--color-text-on-accent` | Text and icons on filled green controls |

The current primitive accent hue is 156. The light theme accent is close to Better Email green `#0F9F63`, represented in OKLCH tokens so the family can remain consistent across themes. Green is deliberate and limited: it carries action and current-state meaning, not every piece of decoration.

Rules:

- Filled green is reserved for the primary Compose action and similarly high-value actions.
- Current navigation may use green text, a quiet green-tinted surface, or a thin leading indicator.
- Do not use green as the sole signal for success, unread state, or risk. Pair it with text, iconography, or structure.
- Do not invent a second accent family for a component.
- Do not use CSS filters to recolor the official brand asset.

## 4. Neutral and surface system

The workspace uses cool neutral planes with a subtly warm reading surface. The reader is quieter than the list, not a floating card.

Canonical semantic surfaces:

- `--ui-bg`: application canvas and gaps.
- `--ui-sidebar`: navigation plane.
- `--ui-list`: inbox/list plane.
- `--ui-reader`: reading plane.
- `--ui-surface`: raised control or transient surface.
- `--ui-surface-muted`: muted control group or quiet background.
- `--ui-control-bg` and `--ui-control-hover`: controls and hover state.
- `--ui-border` and `--ui-border-strong`: 1px separators and stronger boundaries.

Persistent panes are opaque. Do not use `backdrop-filter`, decorative translucency, or glass treatment in the workspace. Elevation is reserved for transient menus, dialogs, tooltips, and other surfaces that genuinely float above the workspace.

## 5. Semantic colors

Use semantic roles rather than literal hues:

- **Success:** `--ui-success` and `--ui-success-bg` for completed sync, saved state, and safe confirmation.
- **Warning:** `--ui-warning`, `--ui-warning-bg`, and `--ui-warning-border` for remote images, hidden links, and caution states.
- **Danger:** `--ui-danger`, `--ui-danger-hover`, and `--ui-danger-bg` for irreversible deletion or destructive operations.
- **Accent:** current state and primary action, not generic decoration.
- **Neutral:** ordinary metadata, dividers, empty states, and secondary actions.

Every semantic color state must retain enough contrast in both themes. A status cannot be conveyed by color alone.

## 6. Typography

The default stack is `--ui-font-sans`: Apple system fonts, Segoe UI, then system sans-serif. Use the system stack rather than adding a web font for a desktop utility.

Base rules:

- Body text: 14px with approximately 1.45 line height.
- Secondary labels and sender metadata: 13px.
- Auxiliary metadata, counts, timestamps, and compact controls: 12px to 13px.
- Reader subject: approximately 20px, weight 600. It is important but not a hero.
- Application title and major section title: use weight and spacing before increasing size.
- Use tabular numerals for counts, dates, and progress values where alignment matters.
- Keep body copy at approximately 65 to 75 characters per line when the content is prose.
- Allow long subjects, addresses, and Chinese/English mixtures to wrap or ellipsize without changing pane geometry.
- Do not use all caps as the primary hierarchy mechanism.

Hierarchy comes from size, weight, contrast, and spacing. Adjacent levels should be visibly distinct, but the interface must not become poster-like.

## 7. Spacing and density

The base rhythm is 4px, with common steps of 4, 8, 12, 16, 20, 24, 32, and 40px. Components should consume `--ui-space-*` or component-level semantic spacing derived from it.

Control tiers:

- Dense control: 32px when space is constrained and the target is not isolated.
- Default control: 36px.
- Comfortable control: 40px for primary actions and isolated pointer actions.
- Touch target: 44px where mobile or touch interaction requires it.

Density rules:

- Preserve a usable target even when the visual content is compact.
- Use one clear grouping boundary instead of multiple nested containers.
- Do not compress controls below their semantic target merely to show one more row.
- First content should appear early: toolbars and filters must earn their vertical space.
- Repeated rows should share a stable rhythm. Variation belongs to hierarchy, not arbitrary padding.

## 8. Radius and shadows

Radius tokens:

- `--ui-radius-sm`: compact rows and small controls.
- `--ui-radius-control`: ordinary controls.
- `--ui-radius-panel`: panels that need a distinct edge.
- `--ui-radius-modal`: modal surfaces.
- `--ui-radius-pill`: true pills only, such as compact status or badge shapes.

Use the smallest radius that communicates grouping. A mailbox row is not a pill. A persistent workspace pane is not a card.

Shadow rules:

- Persistent Sidebar, list, and Reader planes use no shadow.
- Popover/menu surfaces may use `--ui-shadow-popover`.
- Dialogs may use `--ui-shadow-float`.
- Tooltips may use `--ui-shadow-tooltip`.
- Do not add shadows to every row, selected state, or warning strip.

## 9. Icons

Use the existing icon library and shared icon sizing. Icons are compact explanations, not illustrations.

- Keep stroke weight and optical size consistent within a control group.
- Align icons to the text baseline or control center, not the bounding box alone.
- Every icon-only button needs an accessible name and a visible focus state.
- Do not use emoji as functional iconography.
- Do not create a new icon when an existing shared primitive communicates the same action.
- A destructive icon needs a text label, tooltip, or confirmation context when its meaning is not unambiguous.

## 10. Desktop shell

### Ordinary mail workspace

Desktop ordinary mail is a three-pane workspace:

1. **Sidebar:** account scope, Compose, folders, tools, settings/shortcut footer.
2. **Inbox/Mail List:** search, scope, list controls, grouped mail rows.
3. **Reader:** mail actions, subject, identity metadata, labels, attachments, security state, body, and Quick Reply.

The default desktop geometry is flexible rather than pixel-locked:

- Sidebar preferred width: approximately 236px.
- List preferred width: approximately 388px.
- Reader receives remaining width.
- Dividers are 1px visual lines with a larger invisible resize hit target.
- At compact widths the shell may collapse resizers and use a list/reader arrangement.
- At phone widths it becomes a single-surface full-screen navigation flow.

Persistent panes remain flat, opaque, and independently scrollable. The Reader must not feel like a floating document card.

### Window chrome

Native window chrome is platform chrome. It may use its own drag behavior and transient treatment, but it must not visually turn the mail workspace into glass.

## 11. Sidebar

The Sidebar is navigation, not a dashboard.

- Brand mark and product name are compact and aligned to the top rhythm.
- Account scope is visible before folder navigation.
- Compose is the primary filled green control, approximately 40px high, with a clear text label.
- Folder rows are approximately 36 to 40px high, flat, and easy to scan.
- Current folder uses green semantic emphasis plus a quiet selected tint. Do not use a large pill or floating card.
- Folder counts align to the trailing edge and use tabular numerals.
- Icons share an optical size and baseline.
- Section labels are quiet, not competing with folder names.
- The footer contains settings and shortcut actions and remains reachable without pushing mail navigation out of view.
- Hover and focus states alter color/surface, not layout or scale.
- The current brand asset must be reused. If a green official variant is unavailable, record the difference rather than filtering or redrawing the mark.

## 12. Inbox header and controls

The Inbox top region contains search, scope, refresh, list summary, mail/thread mode, and view controls.

- Search is the dominant control and should retain enough width for a natural query.
- Scope is compact but explicitly named, for example folder, current account, or all accounts.
- Refresh is icon-compact visually but keeps an accessible name and tooltip.
- The list summary is informative without becoming a large header block.
- Mail, thread, and view controls use quiet text and underline/border emphasis for the active choice, not large colored pills.
- Keep the combined toolbar and control strip close to the current compact desktop target, approximately 112px in the current implementation. Re-evaluate by first-row position, not by a number alone.
- Do not remove a target-size affordance solely to gain vertical density.

## 13. Mail rows

Rows are the primary scanning surface. A standard desktop row is approximately 64px in the current product because it balances sender, subject, preview, timestamp, star, attachment, unread, and selection controls.

Each row should maintain:

- A subdued avatar or sender mark, approximately 30px in the current desktop implementation.
- A small unread dot, approximately 6px, paired with sender/weight changes so it is not color-only.
- Sender and timestamp on one stable baseline.
- Subject and attachment/star affordances on a clear second line.
- One-line preview with ellipsis where the list is dense.
- A quiet separator between rows.
- A quiet selected tint and a thin green leading indicator for the current mail.
- A clear checkbox target that does not compete with the row's open action.

Keep stars and attachment counts legible but subordinate. Avoid nested row cards, hover elevation, or dramatic selection fills. If a reference displays more rows, investigate row height, header height, line height, and group spacing together before shrinking type.

## 14. Reader

The Reader is a reading surface, not a card inside another card.

Order:

1. Mail action toolbar.
2. Subject.
3. Sender identity and recipient metadata.
4. Date and labels.
5. Attachments.
6. Security or blocked-content context.
7. Mail body.
8. Quick Reply.

Rules:

- Actions appear before the subject and remain reachable without scrolling through the body.
- The subject is prominent but compact, approximately 20px at desktop.
- Sender identity is visually clear but not oversized.
- Body content begins as early as the context requires. Warnings and attachments should be compact, direct, and inline.
- Body prose has a readable measure and should not stretch across the entire monitor.
- HTML email content may retain its own content surface, but application chrome must not wrap it in nested decorative cards.
- Remote-image and hidden-link warnings explain the reason and offer explicit actions.
- Attachments expose file type, name, size, download state, and actions.
- Reader scroll position must not be reset by unrelated list or theme changes.

## 15. Quick Reply

Quick Reply is a continuation of the Reader, not a floating composer card.

- Show the recipient context in the header.
- Use a compact textarea with a visible label or placeholder.
- Keep character count and send actions in a quiet footer.
- The primary send action uses the existing semantic action token.
- Disabled, empty, sending, sent, and error states must be explicit.
- Preserve the draft after a failed send.
- The expanded composer remains available for users who need the full writing surface.

## 16. Composer

The Composer is outside the Phase 1.1 visual scope, but its governing rules are fixed:

- It is a focused writing surface with clear account and identity context.
- Recipient, subject, body, attachments, send, save, and close actions keep standard mail semantics.
- Do not introduce gradients, glass, excessive cards, or a new color language.
- Send failures preserve user input and explain the next action.
- Modal focus, escape behavior, and keyboard traversal must remain correct.

## 17. Desktop Settings, mandatory separation rule

### Mandatory Settings Rule

Desktop Settings is an application-level independent interface.

When Settings is open, it must not show:

- Better Email mail navigation Sidebar.
- Write new mail button.
- Inbox.
- Starred mail.
- Sent mail.
- Drafts.
- Folders.
- Labels.
- Message list.
- Reader pane.

Settings may show only:

- App-level or Settings chrome.
- Settings navigation.
- Settings content.

Settings must have an independent page frame, heading, navigation state, content area, loading state, error state, and close/back affordance. It must not be implemented as a mail workspace with the Sidebar hidden by accident. The application-level shell must be testable by absence assertions for mail-only selectors.

Desktop Settings is outside the current Phase 1.1 redesign scope, but this rule is permanent for all future work.

## 18. Secondary Settings pages

Secondary Settings pages preserve the same application-level frame:

- Navigation remains stable while page content changes.
- The active Settings section is indicated by text, surface, and semantic state.
- Page headers explain purpose without repeating the navigation label multiple times.
- Forms use shared controls, clear grouping, inline validation, and explicit save state.
- Long settings pages scroll inside the Settings content region without exposing Inbox or Reader behind them.
- Empty, loading, error, and permission states use the same frame and do not silently fall back to mail content.

## 19. Mobile Inbox

Mobile is a native full-screen navigation mode, not a scaled desktop grid.

- Show one primary surface at a time.
- Provide an explicit path between navigation, list, and Reader.
- Keep the top bar reachable and use touch targets of at least 44px where practical.
- Search, folder scope, selection, and bulk actions remain discoverable without relying on hover.
- Mail rows may be denser in width but must preserve sender, subject, timestamp, unread, and selection semantics.
- Do not keep a hidden three-pane Sidebar or Reader consuming layout space.

## 20. Mobile Reader

- Reader opens as a full-screen surface with a clear back/navigation affordance.
- Actions remain reachable at the top or through a clearly labeled action surface.
- Subject, sender, security state, attachments, body, and Quick Reply preserve the desktop reading order.
- Body measure follows the viewport and never forces horizontal scrolling for ordinary mail.
- Remote content warnings remain inline and actionable.
- Long addresses and subjects wrap safely.

## 21. Mobile Composer

- Composer is full-screen and keyboard-aware.
- The sending account and identity remain visible.
- Recipient entry, subject, body, attachments, save, send, and close actions retain standard semantics.
- The keyboard must not hide the active field or send action.
- Drafts and failures preserve input.

## 22. Mobile Settings

Mobile Settings is also application-level and full-screen. It must not reveal Sidebar, Inbox, message list, or Reader behind its pages. Navigation may use a native push/list pattern, but it must preserve the Settings-only content rule and provide a clear back path.

## 23. Responsive behavior

Breakpoints express interaction changes, not arbitrary device labels:

- Wide desktop: three panes with resizable Sidebar, list, and Reader.
- Compact desktop/tablet: keep list and Reader together, move folder navigation to an explicit drawer or overlay.
- Phone and 200% zoom fallback: one surface at a time, with explicit navigation.

At every breakpoint:

- No horizontal overflow for ordinary content.
- Controls remain keyboard and pointer reachable.
- Long text does not break the shell.
- Focus remains visible.
- Reader and list scroll independently where both are visible.
- The Settings-only shell remains independent of mail layout.

## 24. Dark mode

Dark mode remaps semantic surfaces and keeps the same hierarchy. It is not a simple inversion and must not be optimized only for the light reference.

Check every dark surface for:

- Green that is saturated enough to identify actions but not luminous or abrasive.
- Selected rows that remain distinguishable through surface and text, not only green.
- Dividers that are visible but quiet.
- Correct primary, secondary, and tertiary text hierarchy.
- Quick Reply that stays attached to the Reader instead of becoming a floating card.
- Unread dot that remains visible without looking like a notification beacon.
- Hover and focus states that remain visible.

## 25. Accessibility

WCAG 2.2 AA is the release baseline.

- Every interactive control is keyboard reachable in logical order.
- Every icon-only control has an accessible name.
- `:focus-visible` is visible and does not rely only on color.
- Selection, unread, warning, success, and error states use text, structure, or icon support in addition to color.
- Use real buttons, links, headings, lists, regions, dialogs, and form labels.
- Keep screen-reader-only labels in the accessibility tree. Visual clipping is acceptable only when the accessible name remains available.
- Focus traps return focus to the trigger after modal close.
- Modal backgrounds must not remain `inert` or `aria-hidden` after unmount.
- Search shortcut, selected-mail keyboard traversal, Reader actions, Quick Reply, and modal controls need keyboard coverage.
- Respect `prefers-reduced-motion` and avoid layout movement for status feedback.
- Test with long Chinese and English labels, long addresses, text zoom, and minimum supported window size.

## 26. Loading, error, and empty states

Loading states preserve the surrounding frame and explain what is being loaded. Do not replace the whole workspace with unexplained blank space when a local region can remain stable.

Error states must:

- Name the failed operation.
- Preserve user input and safe context.
- Offer a retry or recovery action when one exists.
- Avoid raw stack traces in user-facing copy.
- Keep destructive or remote failures explicit.

Empty states must:

- Say what is empty.
- Explain the next useful action.
- Avoid decorative illustration as the only information.

## 27. Anti-pattern blacklist

Never introduce:

- Gradients used as decoration or text fill.
- Glassmorphism or persistent backdrop blur.
- Excessive floating cards or nested cards.
- Pill-shaped navigation or controls where a flat row is clearer.
- Giant corner radii.
- Persistent workspace shadows and glow effects.
- Colored side stripes wider than 1px as the primary state mechanism.
- Hero metrics, dashboard tiles, or decorative illustrations in the mail workflow.
- Emoji as functional icons.
- A second ad hoc color system.
- A desktop layout shrunk onto mobile.
- Mail Sidebar or Reader left behind Settings.
- Hidden or disabled assertions used to make visual or UI smoke tests pass.

## 28. Visual regression rules

Every substantial UI change must produce real browser evidence using the same fixture data and selected mail where comparison matters.

Required desktop probes for the ordinary mail workspace:

- 1440×900 light.
- 1280×800 light.
- 1280×800 dark.

Record at least:

- Sidebar, list, and Reader widths.
- Search/header and list-control heights.
- Compose height and navigation row height.
- Average mail-row height.
- Avatar and unread-dot diameter.
- Reader subject size and body measure.

Report `Reference`, `Actual`, and `Delta`. A 2 to 6px difference may be reasonable when caused by font rendering or an intentional target-size rule, but an unexplained difference is not a pass.

Visual checks must include:

- No horizontal overflow.
- First visible mail position.
- Same selected row and Reader message.
- Light and dark semantic state.
- Keyboard focus and modal cleanup.
- Accessibility names for visually compact controls.

Screenshots and browser logs belong in ignored QA output only. Do not commit them or the local reference images.
