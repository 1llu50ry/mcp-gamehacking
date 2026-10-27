# Agentic Glass Design System v2.0

> **Note (2026-09-06, v0.44.1):** Superseded by PRs #104–106 — workspace-first navigation (WorkspaceSwitcher), 9 shared primitives, lazy route splitting (-44%), arena HiDPI. See CHANGELOG 0.44.1. Content below is historical.


This document defines the visual language and tokens used in the Local Memory Dashboard (Svelte 5).

## 1. Visual Philosophy

- **Depth & Transparency**: High usage of backdrop blurs (`28px`) and semi-transparent surfaces to create a "glass" interface.
- **Micro-Glows**: Subtle shadows use colored glows tied to the context (e.g., `--glow-primary` for action buttons).
- **Responsive Motion**: Transitions use custom bezier curves (`--ease-spring`) to feel organic and reactive.
- **Dark Mode First**: Full dark mode support with light mode fallback.

---

## 2. Core Tokens (CSS Variables)

### A. Surface Architecture

| Token Name       | Value                       | Purpose                  |
| :--------------- | :-------------------------- | :----------------------- |
| `--glass-bg`     | `rgba(255, 255, 255, 0.52)` | Main panel background    |
| `--glass-blur`   | `blur(28px) saturate(1.2)`  | Primary backdrop filter  |
| `--panel-dark`   | `rgba(6, 12, 28, 0.70)`     | Dark mode surface        |
| `--radius-2xl`   | `24px`                      | Large container rounding |
| `--glass-border` | `rgba(255, 255, 255, 0.18)` | Subtle glass edge        |

### B. Functional Colors

| Role        | Light Value | Dark Value         |
| :---------- | :---------- | :----------------- |
| **Primary** | `#0ea5e9`   | `#38bdf8`          |
| **Accent**  | `#6366f1`   | `#6366f1` (Static) |
| **Success** | `#10b981`   | (Inherited)        |
| **Danger**  | `#ef4444`   | (Inherited)        |
| **Warning** | `#f59e0b`   | (Inherited)        |

### C. Type System

- **Family**: Inter (Main UI), JetBrains Mono (Code/Data).
- **Weights**: 400 (Regular), 600 (Semibold), 800 (Extra Bold).
- **Scale**: 12px (small), 14px (body), 16px (lead), 20px (h3), 24px (h2), 32px (h1).

---

## 3. UI Patterns

### Glass Card

```css
.glass {
	background: var(--glass-bg);
	border: 1px solid var(--glass-border);
	backdrop-filter: var(--glass-blur);
	border-radius: var(--radius-2xl);
}
```

**Etched Effect**: Each glass panel uses a pseudo-element `::before` to create a "top-light" etched border for increased depth.

### Interactive Glows

Cards and buttons use dynamic box-shadows that expand on hover using the `--glow-*` tokens.
Example: `box-shadow: 0 4px 14px var(--glow-primary)`

### Micro-Animations

- Transitions use `cubic-bezier(0.34, 1.56, 0.64, 1)` spring curve.
- Hover states scale at 1.02 with smooth transitions (200ms).
- Drawer slides use 300ms ease-out with backdrop blur.
