import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/itest/**/*.test.js',
  // The dev host opens no workspace; tests create their own temp files.
  launchArgs: ['--disable-extensions'],
  mocha: { ui: 'bdd', timeout: 20000 },
});
