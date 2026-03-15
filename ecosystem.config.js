module.exports = {
  apps: [
    {
      name: "pokemon-api",
      script: "./apps/server/src/index.js",

      // Dùng hết số vCPU hiện có
      instances: "max",
      exec_mode: "cluster",

      // Không watch trên production Windows VPS
      watch: false,

      // Tự restart nếu process phình RAM quá mức
      max_memory_restart: "1200M",

      // Tăng độ ổn định khi crash/restart
      autorestart: true,
      exp_backoff_restart_delay: 200,
      restart_delay: 1000,
      min_uptime: "20s",
      max_restarts: 20,

      // Gom log theo tên process
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env: {
        NODE_ENV: "production",
        TZ: "Asia/Ho_Chi_Minh"
      }
    }
  ]
};