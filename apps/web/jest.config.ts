import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
        allowJs: true,
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        isolatedModules: true,
        resolveJsonModule: true,
        baseUrl: '.',
        paths: {
          '@/*': ['./*'],
        },
      },
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};

export default config;
