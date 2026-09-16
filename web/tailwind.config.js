/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,jsx}'],
    theme: {
        extend: {
            colors: {
                severity: {
                    debug: '#9ca3af',
                    info: '#3b82f6',
                    warning: '#f59e0b',
                    error: '#ef4444',
                    critical: '#dc2626'
                }
            },
            fontFamily: {
                mono: [
                    'ui-monospace',
                    'SFMono-Regular',
                    'Menlo',
                    'Monaco',
                    'Consolas',
                    'Liberation Mono',
                    'Courier New',
                    'monospace'
                ]
            }
        }
    },
    plugins: []
};