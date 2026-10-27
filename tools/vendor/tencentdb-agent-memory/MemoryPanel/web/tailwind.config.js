import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /*
         * 语义色 — 全部桥接到 Tea Design Token（--tea-color-*），
         * 不再使用 shadcn 的 HSL 三元组体系。
         * 具体别名映射见 src/index.css 中的 :root 定义。
         * 注：Tailwind v3.4+ 的透明度修饰符（如 bg-primary/50）通过 color-mix()
         * 实现，对任意合法 CSS 颜色值（包含 var() 引用）均生效，无需 <alpha-value> 占位符。
         */
        background: {
          DEFAULT: 'var(--background)',
          deep: 'var(--background-deep)'
        },
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)'
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)'
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)'
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)'
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)'
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          foreground: 'var(--accent-foreground)'
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)'
        },
        success: {
          DEFAULT: 'var(--success)',
          foreground: 'var(--success-foreground)'
        },
        warning: {
          DEFAULT: 'var(--warning)',
          foreground: 'var(--warning-foreground)'
        },
        heavy: {
          DEFAULT: 'var(--heavy)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)'
      },
      borderRadius: {
        /* 对齐 Tea Design 圆角阶梯：2/4/6/8/12/16/20/30/9999px */
        sm: '2px',
        DEFAULT: '4px',
        md: '4px',
        lg: '6px',
        xl: '8px',
        '2xl': '12px',
        '3xl': '16px',
        full: '9999px'
      },
      fontSize: {
        /** 模板对齐：正文 14px/1.6，小字 12-13px */
        'body': ['14px', { lineHeight: '1.6', letterSpacing: '-0.01em' }],
        'body-sm': ['13px', { lineHeight: '1.5', letterSpacing: '-0.006em' }],
        'caption': ['12px', { lineHeight: '1.4' }],
        'label': ['11px', { lineHeight: '1.3' }],
      },
      spacing: {
        /** 模板对齐的常用间隔 */
        '4.5': '1.125rem',
        '5.5': '1.375rem',
        '13': '3.25rem',
        '15': '3.75rem',
      },
      boxShadow: {
        /* 直接引用 Tea 官方阴影 Token（--tea-shadow-*），不再手写 hsl() 阴影 */
        'card': 'var(--tea-shadow-xs)',
        'card-hover': 'var(--tea-shadow-md)',
      },
      transitionDuration: {
        '150': '150ms',
      },
      animation: {
        'press': 'press 0.1s ease-out',
      },
      keyframes: {
        press: {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(0.97)' },
          '100%': { transform: 'scale(1)' },
        },
      },
    }
  },
  plugins: [typography]
};
