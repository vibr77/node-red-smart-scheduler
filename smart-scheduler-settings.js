const mqtt = require("mqtt");

module.exports = function (RED) {
  function SmartSchedulerSettings(n) {
    RED.nodes.createNode(this, n)
    this.name = n.name
    this.mqttHost = n.mqttHost
    this.mqttPort = n.mqttPort
    this.mqttUser = n.mqttUser
    this.mqttPassword = n.mqttPassword
    this.mqttRootPath = n.mqttRootPath
  }
  RED.nodes.registerType('smart-scheduler-settings', SmartSchedulerSettings)
  RED.httpAdmin.post("/smart-scheduler-settings/testConnection", RED.auth.needsPermission("smart-scheduler-settings.write"), function(req, res) {
      const config = req.body;
      const protocol = 'mqtt';
      const host = config.mqttHost;
      const port = config.mqttPort;
      const rootPath = config.mqttRootPath;
      const connectUrl = `${protocol}://${host}:${port}`;
      
      const options = {
          clientId: `test_${Math.random().toString(16).slice(3)}`,
          clean: true,
          connectTimeout: 4000,
          username: config.mqttUser,
          password: config.mqttPassword,
          reconnectPeriod: 0 
      };
      
      const client = mqtt.connect(connectUrl, options);
      let messageReceived = false;
  
      client.on('connect', () => {
          if (!rootPath) {
              client.end();
              res.json({status: "success", message: "Connected (No Root Path defined)"});
              return;
          }
  
          client.subscribe(`${rootPath}/#`, (err) => {
              if (err) {
                  client.end();
                  res.json({status: "error", message: "Connected but failed to subscribe: " + err.message});
              } else {
                  // Wait a bit to see if we get a message (e.g. retained)
                  setTimeout(() => {
                      client.end();
                      if (messageReceived) {
                          res.json({status: "success", message: "Connected & Root Path Found"});
                      } else {
                          res.json({status: "warning", message: "Connected (No data on Root Path)"});
                      }
                  }, 700);
              }
          });
      });
  
      client.on('message', (topic, message) => {
          messageReceived = true;
      });
  
      client.on('error', (err) => {
          client.end();
          res.json({status: "error", message: "err:"+err.message});
      });
    });
}
