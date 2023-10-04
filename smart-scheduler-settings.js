
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

}
