/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#2916ad',
          dark: '#21128a',
          deeper: '#170c63',
          soft: '#5b4bd6',
        },
        mist: '#f0eef9',
        accent: {
          green: '#0f9d58',
          amber: '#d97706',
          red: '#dc2626',
          blue: '#2563eb',
        },
      },
      boxShadow: {
        card: '0 1px 3px rgba(23, 12, 99, 0.08), 0 4px 14px rgba(23, 12, 99, 0.06)',
      },
    },
  },
  plugins: [],
};
