import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#fbf8f3',
          100: '#f5efe4',
        },
        teal: {
          50: '#f0f7f6',
          100: '#d6e8e5',
          200: '#a9cdc7',
          300: '#74aea5',
          400: '#4b8f86',
          500: '#2f736b',
          600: '#225c55',
          700: '#1d4944',
          800: '#193b37',
          900: '#15302d',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      maxWidth: {
        prose: '65ch',
      },
    },
  },
  plugins: [],
};

export default config;
