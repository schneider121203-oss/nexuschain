/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          deep: '#090D16',
          card: '#111726',
          border: '#1E293B',
          glow: '#38BDF8',
        }
      }
    },
  },
  plugins: [],
}
