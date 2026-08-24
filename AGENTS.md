# Better Email UI rules

- UI/UX source of truth: `docs/design/UI_UX_SPEC.md`.
- Visual references live in `docs/design/reference/`; keep them local and ignored.
- Before any UI change, read the specification and the relevant reference image.
- Do not freely redesign. Preserve product behavior, information architecture, and existing shared primitives.
- Desktop ordinary mail is a three-pane workspace: Sidebar, Inbox/Mail List, and Reader.
- Desktop Settings is a separate application-level surface. It must not show the mail Sidebar, Inbox, folders, labels, message list, or Reader.
- Mobile uses native full-screen navigation. Do not scale the desktop three-pane layout onto a phone.
- Avoid gradients, glass, excessive cards, pills, shadows, giant radii, and decorative effects.
- Use the shared green accent tokens consistently; do not add component-local brand colors.
- Mail content has priority over UI chrome. Keep headers, warnings, and actions compact and explicit.
- Reuse shared tokens, primitives, and components before adding new ones.
- Any substantial UI change requires real screenshots at the affected breakpoints and visual comparison against the matching reference.
