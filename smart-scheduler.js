
/*
__   _____ ___ ___        Author: Vincent BESSON
 \ \ / /_ _| _ ) _ \      Release: 0.10
  \ V / | || _ \   /      Date: 20230930
   \_/ |___|___/_|_\      Description: Nodered Heating Scheduler
                2023      Licence: Creative Commons
______________________
*/ 

var moment = require('moment'); // require

module.exports = function(RED) {
    'use strict'
    var path = require('path')
    var util = require('util')
    var scheduler = require('./lib/scheduler.js')
 
    var SmartScheduler = function(n) {
        RED.nodes.createNode(this, n)
        this.settings = RED.nodes.getNode(n.settings) // Get global settings
        this.events = JSON.parse(n.events)
        this.topic = n.topic
        this.rules = n.rules
        this.defaultSp=n.defaultSp
        this.triggerMode = n.triggerMode ? n.triggerMode : 'trigger.statechange.startup'
        
        this.override = n.override ? n.override : 'auto'
        this.overrideTs= n.overrideTs ? n.overrideTs : '0'
        this.overrideDuration=n.overrideDuration ? n.overrideDuration :"120"
        this.overrideSp=n.overrideSp ? n.overrideSp : "5"
        
        this.activeRuleIdx=0
        this.prevRuleIdx=0

        this.activeSp=0;
        this.prevSp=0;
        
        this.defaultSp=n.defaultSp ? n.defaultSp : '5'
        
        this.firstEval = true
        this.manualTrigger = false;
        this.settingChanged=n.settingChanged ? n.settingChanged:"0";
        this.noout=false;

        var node = this

        function isEqual(a, b) {
            // simpler and more what we want compared to RED.utils.compareObjects()
            return JSON.stringify(a) === JSON.stringify(b)
        }

        function evaluateNodeProperty(propName, propValue, propType, node, msg) {
            try {
                return RED.util.evaluateNodeProperty(propValue, propType, node, msg)
            } 
            catch(err) {
                node.warn('Failed to interpret ' + propName + '. Ignoring it!. Reason:' + err)
                return msg.payload
            }
        }

        function setState(matchingEvent) {
            var msg = {
                topic: node.topic,
            }
            let hasSpchanged=false;

            if (node.override=="manual"){
                console.log("node.override==manual");

                let ovrM=moment(node.overrideTs).add(node.overrideDuration,"m")
                let now = moment();
                let diff=ovrM.diff(now,"m")+1;
            
                node.activeSp=node.overrideSp;
                if (parseFloat(node.activeSp)!=parseFloat(node.prevSp))
                    hasSpchanged=true;
                
                msg.payload={
                    setPoint:parseFloat(node.overrideSp),
                    prevSetPoint:parseFloat(node.prevSp),
                    override:node.override,
                    setName:"override",
                    overrideDuration:parseInt(node.overrideDuration),
                    activeRuleIdx:-1,
                    prevRuleIdx: parseInt(node.prevRuleIdx),
                    triggerMode:node.triggerMode,
                    manualTrigger:node.manualTrigger,
                    short_start:0,
                    short_end:0,
                    start:0,
                    end:0,
                    duration:diff,
                    hasSpchanged:hasSpchanged
                }

                node.status({
                    fill:  'yellow',
                    shape: 'dot',
                    text:("override sp "+node.overrideSp+" °C, "+diff+" min left")
                });               
            }else if (matchingEvent.ruleIdx==-1){
                node.activeSp=node.defaultSp;
                
                if (parseFloat(node.activeSp)!=parseFloat(node.prevSp))
                    hasSpchanged=true;
                
                msg.payload={};
                msg.payload={
                    setPoint:parseFloat(node.defaultSp),
                    prevSetPoint:parseFloat(node.prevSp),
                    setName:"default rule",
                    short_start:0,
                    short_end:0,
                    start:0,
                    end:0,
                    manualTrigger:node.manualTrigger,
                    triggerMode:node.triggerMode,
                    activeRuleIdx:parseInt(matchingEvent.ruleIdx),
                    prevRuleIdx: parseInt(node.prevRuleIdx),
                    override:node.override,
                    hasSpchanged:hasSpchanged
                }

                node.status({
                    fill:  'gray',
                    shape: 'ring',
                    text:("Default setpoint: "+node.defaultSp+" °C")
                });
            }else if (matchingEvent.ruleIdx>=0){
                //var event=node.events[matchingEvent.eventId];
                console.log("matchingEvent.eventId:"+matchingEvent.eventId)
                var event=node.events.find((item) => parseInt(item.id)==parseInt(matchingEvent.eventId));
                
                var m_s=moment(event.start);
                var m_e=moment(event.end);
                var d_s=m_s.format('HH:mm');
                var d_e=m_e.format('HH:mm');
                
                var dayStr=["","Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

                var period=dayStr[m_s.days()]+" "+d_s+" - "+dayStr[m_e.days()]+" "+d_e;

                node.status({
                    fill:  'blue',
                    shape: 'dot',
                    text:(node.rules[matchingEvent.ruleIdx].setName+" "+node.rules[matchingEvent.ruleIdx].spTemp+" °C "+period)
                });

                node.activeSp=node.rules[matchingEvent.ruleIdx].spTemp;
                if (parseFloat(node.activeSp)!=parseFloat(node.prevSp))
                    hasSpchanged=true;

                msg.payload={};

                msg.payload={
                    setPoint:parseFloat(node.rules[matchingEvent.ruleIdx].spTemp),
                    prevSetPoint:parseFloat(node.prevSp),
                    setName:node.rules[matchingEvent.ruleIdx].setName,
                    short_start:d_s,
                    short_end:d_e,
                    start:event.start,
                    end:event.end,
                    manualTrigger:node.manualTrigger,
                    triggerMode:node.triggerMode,
                    activeRuleIdx:parseInt(node.activeRuleIdx),
                    prevRuleIdx: parseInt(node.prevRuleIdx),
                    override:node.override,
                    hasSpchanged:hasSpchanged
                }
               
            }

            // Only send anything if the state have changed, on trigger and when configured to output on a minutely basis.
            

            node.log("-->before sending");
            node.log("   node.activeRuleIdx:"+node.activeRuleIdx);
            node.log("   node.prevRuleIdx:"+node.prevRuleIdx);
            node.log("   node.activeSp:"+node.activeSp);
            node.log("   node.prevSp:"+node.prevSp);
            
            if (node.noout==true)
                node.log("   node.noout:true");
            else 
                node.log("   node.noout:false");

            if (node.manualTrigger || 
                node.triggerMode == 'triggerMode.minutely' || 
                !isEqual(node.activeRuleIdx, node.prevRuleIdx) || 
                !isEqual(node.activeSp, node.prevSp)) {
                
                if (!node.firstEval && !node.noout){
                    node.send(msg);
                    node.noout=false;
                }else if (node.noout==true)
                    node.noout=false;
                    
                node.prevPayload = msg.payload
                node.prevSp=    node.activeSp;
                node.prevRuleIdx=node.activeRuleIdx
            }

            node.firstEval = false
            node.manualTrigger = false
        }

        function evaluate() {
        
            if (node.override == 'off') {
                node.status({fill: 'gray', shape: 'dot', text: 'OFF'})
                return
            }
            
            if (node.override == 'manual') {
                // First check if below threshold override duration
                let ovrM=moment(node.overrideTs).add(node.overrideDuration,"m")
                var now = moment();
                if (now> ovrM.add()){
                    node.override='auto';
                }
            }

            var matchEvent = scheduler.matchSchedule(node)
            console.log("MatchEvent="+matchEvent);
            
            node.activeRuleIdx=parseInt(matchEvent.ruleIdx);

            return setState(matchEvent);
        }

        node.on('input', function(msg) {
            msg.payload = msg.payload.toString() // Make sure we have a string.
            
            console.log(msg.payload);

            if (msg.payload.match(/^(1|on|0|off|auto|override|trigger)$/i)) {
                
               
                if (msg.payload == '1' || msg.payload == 'trigger' || msg.payload == 'on'){
                    node.manualTrigger = true;
                }

                if (msg.payload=="auto"){
                    node.override="auto";
                    var now = new Date();
                    node.overrideTs=now.toISOString();
                }

                if (msg.payload=="off" || msg.payload == '0'){
                    node.override="off";
                    var now = new Date();
                    node.overrideTs=now.toISOString();
                }

                if (msg.payload=="override"){
                    node.override="manual";
                    var now = new Date();
                    node.overrideTs=now.toISOString();
                    node.overrideSp=msg.sp;
                    
                    if (msg.noout==true){
                        node.noout=true;
                        node.log("noout==true");
                    }

                    node.log(msg);
                }
                //console.log("manualT:"+node.manualTrigger)
                evaluate()
            } else node.warn('Failed to interpret incoming msg.payload. Ignoring it!')
        })

        // re-evaluate every minute
        node.evalInterval = setInterval(evaluate, 60000)

        // Run initially directly after start / deploy.
        if (node.triggerMode != 'triggerMode.statechange') {
            node.firstEval = false
            setTimeout(evaluate, 1000)
        }

        node.on('close', function() {
            clearInterval(node.evalInterval)
            clearInterval(node.rndInterval)
        })

    }

    RED.nodes.registerType('smart-scheduler', SmartScheduler)

}
