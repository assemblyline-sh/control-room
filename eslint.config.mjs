import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      // Static export with images.unoptimized: next/image adds nothing over <img>.
      '@next/next/no-img-element': 'off',
      // New with eslint-config-next 16 (React Compiler rules); existing code
      // trips them. Warnings until fixed — see docs/wip/nextjs-16-migration.md.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  globalIgnores(['.next/**', 'out/**', 'src-tauri/**', 'next-env.d.ts']),
]);
