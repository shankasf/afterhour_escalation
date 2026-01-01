module.exports = {
    apps: [
        {
            name: 'escalation-frontend',
            cwd: './frontend',
            script: 'npm',
            args: 'run preview',
            env: {
                NODE_ENV: 'production',
                PORT: 5175
            },
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '500M',
            error_file: '../logs/frontend-error.log',
            out_file: '../logs/frontend-out.log',
            log_file: '../logs/frontend-combined.log',
            time: true
        },
        {
            name: 'escalation-backend',
            cwd: './backend',
            script: 'dist/main.js',
            env: {
                NODE_ENV: 'production',
                PORT: 3004
            },
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            error_file: '../logs/backend-error.log',
            out_file: '../logs/backend-out.log',
            log_file: '../logs/backend-combined.log',
            time: true
        },
        {
            name: 'escalation-ai-service',
            cwd: './ai-service',
            script: 'venv/bin/uvicorn',
            args: 'main:app --host 0.0.0.0 --port 8083',
            interpreter: 'none',
            env: {
                NODE_ENV: 'production'
            },
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '2G',
            error_file: '../logs/ai-service-error.log',
            out_file: '../logs/ai-service-out.log',
            log_file: '../logs/ai-service-combined.log',
            time: true
        }
    ]
};
