module.exports = {
  apps: [
    {
      name: "http-server",
      script: "./server.js",
      watch: false,
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "cricket-worker",
      script: "./workers/cricketWorker.js",
      watch: false,
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "tennis-worker",
      script: "./workers/tennisWorker.js",
      watch: false,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
