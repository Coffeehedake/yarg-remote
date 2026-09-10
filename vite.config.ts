import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Bundled build: output goes to dist/, which Capacitor packages into the app.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
});