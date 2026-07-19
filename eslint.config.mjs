// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.js', '**/*.cjs', '**/*.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': 'warn',
    },
  },
  {
    // ARCHITECTURE RULE: only repositories (and the database/health infrastructure)
    // may touch the Prisma layer. Services depend on repositories, never on the DB.
    files: ['src/**/*.ts'],
    ignores: [
      'src/**/*.repository.ts',
      'src/database/**',
      'src/modules/health/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // PrismaModule wiring in AppModule is fine; the client/token are not
              group: [
                '@/database/prisma.constants',
                '@/database/prisma.extension',
                '**/database/prisma.constants',
                '**/database/prisma.extension',
              ],
              message:
                'Database access is restricted to *.repository.ts files. Put queries in a repository and inject it into your service.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts', 'prisma/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // jest mock assertions access methods unbound / untyped by nature
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  prettier,
);
