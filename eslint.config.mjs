const commonGlobals = {
    console: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    TextEncoder: 'readonly',
    TextDecoder: 'readonly',
}

const browserGlobals = {
    ...commonGlobals,
    window: 'readonly',
    document: 'readonly',
    navigator: 'readonly',
    location: 'readonly',
    history: 'readonly',
    localStorage: 'readonly',
    sessionStorage: 'readonly',
    fetch: 'readonly',
    FormData: 'readonly',
    Headers: 'readonly',
    Request: 'readonly',
    Response: 'readonly',
    AbortController: 'readonly',
    Image: 'readonly',
    Audio: 'readonly',
    EventSource: 'readonly',
    WebSocket: 'readonly',
    requestAnimationFrame: 'readonly',
    cancelAnimationFrame: 'readonly',
}

const nodeGlobals = {
    ...commonGlobals,
    process: 'readonly',
    Buffer: 'readonly',
    global: 'readonly',
}

const sharedRules = {
    'no-constant-binary-expression': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-debugger': 'warn',
    'no-dupe-args': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-empty-pattern': 'error',
    'no-redeclare': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
    'no-unused-vars': [
        'warn',
        {
            argsIgnorePattern: '^_',
            caughtErrors: 'all',
            caughtErrorsIgnorePattern: '^_',
            ignoreRestSiblings: true,
            varsIgnorePattern: '^_',
        },
    ],
    'no-var': 'error',
    'prefer-const': [
        'warn',
        {
            destructuring: 'all',
            ignoreReadBeforeAssign: true,
        },
    ],
}

export default [
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            '**/coverage/**',
            'apps/client/public/**',
        ],
    },
    {
        files: ['apps/client/**/*.{js,jsx}', 'apps/server/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
        },
        rules: sharedRules,
    },
    {
        files: [
            'apps/client/**/*.{js,jsx}',
            'apps/client/vite.config.js',
            'apps/client/postcss.config.js',
            'apps/client/tailwind.config.js',
            'apps/client/resize.js',
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: {
                ...browserGlobals,
                importMeta: 'readonly',
            },
        },
    },
    {
        files: ['apps/server/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: nodeGlobals,
        },
    },
]
