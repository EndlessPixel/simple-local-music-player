import globals from 'globals';
import pluginJs from '@eslint/js';

export default [
    {
        ignores: ['old/**', 'old-2/**', 'eslint.config.js']
    },
    {
        files: ['script.js'],
        languageOptions: {
            globals: {
                ...globals.browser,
                volumeSlider: 'readonly'
            },
            ecmaVersion: 'latest',
            sourceType: 'script'
        }
    },
    {
        files: ['server.js'],
        languageOptions: {
            globals: {
                ...globals.node
            },
            ecmaVersion: 'latest',
            sourceType: 'module'
        }
    },
    pluginJs.configs.recommended,
    {
        rules: {
            'no-unused-vars': ['error', {
                vars: 'all',
                args: 'after-used',
                ignoreRestSiblings: false
            }],
            'no-undef': 'error',
            'no-console': ['warn', { allow: ['error', 'warn'] }],
            'prefer-const': 'warn',
            'no-var': 'warn',
            indent: ['error', 4],
            quotes: ['error', 'single'],
            semi: ['error', 'always'],
            'comma-dangle': ['error', 'never'],
            'space-infix-ops': 'error',
            'space-before-blocks': 'error',
            'object-curly-spacing': ['error', 'always'],
            'array-bracket-spacing': ['error', 'never'],
            'linebreak-style': ['error', 'windows']
        }
    }
];