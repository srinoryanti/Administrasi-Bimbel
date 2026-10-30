/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#1e3a5f',
          dark: '#14263d',
          deeper: '#0d1b2e',
          soft: '#3b6291',
        },
        mist: '#eef3f9',
        accent: {
          green: '#0f9d58',
          amber: '#d97706',
          red: '#dc2626',
          blue: '#2563eb',
        },
      },
      boxShadow: {
        card: '0 1px 3px rgba(16, 34, 60, 0.08), 0 4px 14px rgba(16, 34, 60, 0.06)',
      },
    },
  },
  plugins: [],
};
