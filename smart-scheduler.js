
/*
__   _____ ___ ___        Author: Vincent BESSON
 \ \ / /_ _| _ ) _ \      Release: 0.44
  \ V / | || _ \   /      Date: 20230930
   \_/ |___|___/_|_\      Description: Nodered Heating Scheduler
                2023      Licence: Creative Commons
______________________
*/ 

/*
TODO:
-----

+ now correct date in calendar
+ Put Rules in config setting
+ When changing select param can not published

*/


var moment = require('moment'); // require
const mqtt = require("mqtt");

module.exports = function(RED) {
    'use strict'
    var path = require('path')
    var util = require('util')
    var scheduler = require('./lib/scheduler.js')
 
    var SmartScheduler = function(n) {
        RED.nodes.createNode(this, n)
       
        //this.events = JSON.parse(n.events)
        this.topic = n.topic
        //this.rules = n.rules
        this.defaultSp=n.defaultSp
        this.name=n.name ? n.name : "smartscheduler";
        this.triggerMode = n.triggerMode ? n.triggerMode : 'trigger.statechange.startup'
        this.schedules = n.schedules ? n.schedules : "[]";
        
        
        this.schedules=JSON.parse(n.schedules);
        this.activScheduleId=n.activScheduleId;


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
        this.mqttclient=null;
        this.mqttstack=[];
        var node = this;

        this.mqttSettings = RED.nodes.getNode(n.mqttSettings);
        this.rules = RED.nodes.getNode(n.rules);

        if ( this.mqttSettings?.mqttHost);
            node.log(this.mqttSettings?.mqttHost);
        
            // START OF MQTT
       if (this.mqttPrefix && this.mqttSettings.mqttRootPath)
            this.mqttPrefix=this.mqttSettings.mqttRootPath
       else 
            this.mqttPrefix="homeassistant";
        
        this.uniqueId=n.uniqueId ? n.uniqueId : "SmartScheduler_1";

        this.adv_mode_topic=this.mqttPrefix+"/sensor/"+node.uniqueId+"/mode/config";
        this.state_mode_topic=this.mqttPrefix+"/"+node.uniqueId+"/mode/state";

        this.adv_current_sp_topic=this.mqttPrefix+"/sensor/"+node.uniqueId+"/current_sp/config";
        this.state_current_sp_topic=this.mqttPrefix+"/"+node.uniqueId+"/current_sp/state";

        this.adv_previous_sp_topic=this.mqttPrefix+"/sensor/"+node.uniqueId+"/previous_sp/config";
        this.state_previous_sp_topic=this.mqttPrefix+"/"+node.uniqueId+"/previous_sp/state";

        this.adv_current_event_name_topic=this.mqttPrefix+"/sensor/"+node.uniqueId+"/current_event_name/config";
        this.state_current_event_name_topic=this.mqttPrefix+"/"+node.uniqueId+"/current_event_name/state";

        this.adv_current_event_start_topic=this.mqttPrefix+"/sensor/"+node.uniqueId+"/current_event_start/config";
        this.state_current_event_start_topic=this.mqttPrefix+"/"+node.uniqueId+"/current_event_start/state";

        this.adv_current_event_end_topic=this.mqttPrefix+"/sensor/"+node.uniqueId+"/current_event_end/config";
        this.state_current_event_end_topic=this.mqttPrefix+"/"+node.uniqueId+"/current_event_end/state";

        this.adv_schedule_list_topic=this.mqttPrefix+"/select/"+node.uniqueId+"/schedule_list/config";
        this.state_schedule_list_topic=this.mqttPrefix+"/"+node.uniqueId+"/schedule_list/state";
        this.set_schedule_list_topic=this.mqttPrefix+"/"+node.uniqueId+"/schedule_list/set";

        this.dev={
            ids:[node.uniqueId],
            name:node.name,
            mdl:"Smart-Scheduler",
            mf:"VIBR",
            sw:"0.34",
            hw_version:"1.0"
        }

        // END OF MQTT
        //

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

                if (node.mqttclient!=null && node.mqttstack.length<100){
                    let mqttmsg={topic:node.state_mode_topic,payload:{value:"Override"},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_current_sp_topic,payload:{value:node.overrideSp},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_previous_sp_topic,payload:{value:node.prevSp},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);
                    
                    mqttmsg={topic:node.state_current_event_name_topic,payload:{value:"None"},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_current_event_start_topic,payload:{value:"-"},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_current_event_end_topic,payload:{value:"-"},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    sendMqtt();
                }

                node.status({
                    fill:  'yellow',
                    shape: 'dot',
                    text:("override sp "+node.overrideSp+" °C, "+diff+" min left")
                });               
            }else if (matchingEvent.ruleIdx==-1){

                if (node.mqttclient!=null && node.mqttstack.length<100 ){
                    let mqttmsg={topic:node.state_mode_topic,payload:{value:"Default"},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);
                    
                    mqttmsg={topic:node.state_current_sp_topic,payload:{value:node.defaultSp},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_previous_sp_topic,payload:{value:node.prevSp},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);
                    
                    mqttmsg={topic:node.state_current_event_name_topic,payload:{value:"None"},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);
                
                    mqttmsg={topic:node.state_current_event_start_topic,payload:{value:"-"},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_current_event_end_topic,payload:{value:"-"},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    sendMqtt();
                }

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

                let r=node.rules.find(({ruleIdx}) => parseInt(ruleIdx)==parseInt(matchingEvent.ruleIdx));
                if (r===undefined){
                    node.error("rule should not be undefined");
                    return;
                }

                if (node.mqttclient!=null && node.mqttstack.length<100){
                    let mqttmsg={topic:node.state_mode_topic,payload:{value:"Auto"},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_current_sp_topic,payload:{value:r.spTemp},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);
                    
                    mqttmsg={topic:node.state_previous_sp_topic,payload:{value:node.prevSp},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_current_event_name_topic,payload:{value:r.setName},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_current_event_start_topic,payload:{value:d_s},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_current_event_end_topic,payload:{value:d_e},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    sendMqtt();
                }

                node.status({
                    fill:  'blue',
                    shape: 'dot',
                    text:(r.setName+" "+r.spTemp+" °C "+period)
                });

                node.activeSp=r.spTemp;

                if (parseFloat(node.activeSp)!=parseFloat(node.prevSp))
                    hasSpchanged=true;

                msg.payload={};

                msg.payload={
                    setPoint:parseFloat(r.spTemp),
                    prevSetPoint:parseFloat(node.prevSp),
                    setName:r.setName,
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
            
            node.log("-->setState(matchingEvent) output:");
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
                !isEqual(node.activeSp, node.prevSp) || node.firstEval==true) {
                                
                if (/*!node.firstEval &&*/ !node.noout){
                    node.send([msg,null]);
                    node.log("   output msg:"+JSON.stringify(msg));
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

        function mqttAdvertise(){
            
            var msg={};
        
            msg.payload={
                name:"Mode",
                uniq_id:node.uniqueId+"MODE",
                icon:"mdi:cog-clockwise",
                qos:0,
                retain:true,
                state_topic:node.state_mode_topic,
                value_template:"{{value_json.value}}",
                dev:node.dev
            }


            let arr=[];
            if (node.schedules){
                node.schedules.forEach(function(e){
                    arr.push(e.name); 
                });
            }
            msg.payload={
                name:"Schedule",
                uniq_id:node.uniqueId+"SCHED",
                icon:"mdi:calendar-text-outline",
                qos:0,
                retain:true,
                entity_category: "config",
                state_topic:node.state_schedule_list_topic,
                command_topic:node.set_schedule_list_topic,
                command_template:"{{value_json.value}}",
                options:arr,
                value_template:"{{value_json.value}}",
                dev:node.dev
            }

            let mqttmsg={topic:node.adv_schedule_list_topic,payload:msg.payload,qos:msg.payload.qos,retain:msg.payload.retain};
            node.mqttstack.push(mqttmsg);

            
            msg.payload=node.schedules.find((sched)=>parseInt(sched.idx)==parseInt(node.activScheduleId)).name;
            mqttmsg={topic:node.state_schedule_list_topic,payload:msg.payload,qos:0,retain:false};
            node.mqttstack.push(mqttmsg);
            

            msg.payload={
                name:"Current Setpoint",
                uniq_id:node.uniqueId+"SP",
                icon:"mdi:thermometer",
                qos:0,
                retain:true,
                unit_of_measurement:"°C",
                state_topic:node.state_current_sp_topic,
                value_template:"{{value_json.value}}",
                dev:node.dev
            }

            mqttmsg={topic:node.adv_current_sp_topic,payload:msg.payload,qos:msg.payload.qos,retain:msg.payload.retain};
            node.mqttstack.push(mqttmsg);

            msg.payload={
                name:"Previous Setpoint",
                uniq_id:node.uniqueId+"prevSP",
                icon:"mdi:thermometer",
                qos:0,
                retain:true,
                unit_of_measurement:"°C",
                state_topic:node.state_previous_sp_topic,
                value_template:"{{value_json.value}}",
                dev:node.dev
            }

            mqttmsg={topic:node.adv_previous_sp_topic,payload:msg.payload,qos:msg.payload.qos,retain:msg.payload.retain};
            node.mqttstack.push(mqttmsg);

            msg.payload={
                name:"Current event",
                uniq_id:node.uniqueId+"EVNAME",
                icon:"mdi:calendar-text-outline",
                qos:0,
                retain:true,
                state_topic:node.state_current_event_name_topic,
                value_template:"{{value_json.value}}",
                dev:node.dev 
            }

            mqttmsg={topic:node.adv_current_event_name_topic,payload:msg.payload,qos:msg.payload.qos,retain:msg.payload.retain};
            node.mqttstack.push(mqttmsg);

            msg.payload={
                name:"Event start",
                uniq_id:node.uniqueId+"EVSTART",
                icon:"mdi:clock-time-eight-outline",
                qos:0,
                retain:true,
                state_topic:node.state_current_event_start_topic,
                value_template:"{{value_json.value}}",
                dev:node.dev
            }

            mqttmsg={topic:node.adv_current_event_start_topic,payload:msg.payload,qos:msg.payload.qos,retain:msg.payload.retain};
            node.mqttstack.push(mqttmsg);

            msg.payload={
                name:"Event end",
                uniq_id:node.uniqueId+"EVEND",
                icon:"mdi:clock-time-four-outline",
                qos:0,
                retain:true,
                state_topic:node.state_current_event_end_topic,
                value_template:"{{value_json.value}}",
                dev:node.dev
            }

            mqttmsg={topic:node.adv_current_event_end_topic,payload:msg.payload,qos:msg.payload.qos,retain:msg.payload.retain};
            node.mqttstack.push(mqttmsg);

            sendMqtt();
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
                    node.log("   exceed OverrideDuration");
                    node.log("   override=manual->auto");
                }
            }

            var matchEvent = scheduler.matchSchedule(node)
            console.log("MatchEvent="+matchEvent);
            
            node.activeRuleIdx=parseInt(matchEvent.ruleIdx);

            return setState(matchEvent);
        }

        node.on('input', function(msg) {
            msg.payload = msg.payload.toString() // Make sure we have a string.
            
            if (msg.payload.match(/^(1|on|0|off|auto|override|trigger|schedule)$/i)) {
                
                if (msg.payload == '1' || msg.payload == 'trigger' || msg.payload == 'on'){
                    node.manualTrigger = true;
                }

                if (msg.payload=="auto"){
                    node.override="auto";
                    var now = new Date();
                    node.overrideTs=now.toISOString();
                }

                if (msg.payload=="schedule"){

                    if (msg.id===undefined){
                        node.warn('received schedule missing or invalid msg.id number');
                        return;
                    }

                    let ev=node.schedules.find((sched)=>parseInt(sched.idx)==parseInt(msg.id)).events;
                    
                    if (ev===undefined){
                        node.warn('received schedule id not found');
                        return;
                    }

                    node.events=ev;                     // <------------------ TODO Change input by name and not by id
                    node.activScheduleId=msg.id;
                    node.log("here");

                    msg.payload={value:node.schedules.find((sched)=>parseInt(sched.idx)==parseInt(node.activScheduleId)).name};
                    //node.log(msg.payload);
                    let mqttmsg={topic:node.state_schedule_list_topic,payload:msg.payload,qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    sendMqtt();
                }

                if (msg.payload=="off" || msg.payload == '0'){
                    node.override="off";
                    var now = new Date();
                    node.overrideTs=now.toISOString();
                }

                if (msg.payload=="override"){

                    if (msg.sp=== undefined || isNaN(msg.sp) || parseFloat(msg.sp)<0 || parseFloat(msg.sp)>35){ //<----------- Todo define Max & Min in config
                        node.warn('received trigger missing or invalid msg.sp number');
                        return;
                    }
                       
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
                
                evaluate()
            } else node.warn('Failed to interpret incoming msg.payload. Ignoring it!')
        })

        if (node.activScheduleId)
            node.events=node.schedules.find((sched)=>parseInt(sched.idx)==parseInt(node.activScheduleId)).events;

        // re-evaluate every minute
        node.evalInterval = setInterval(evaluate, 60000)

        // Run initially directly after start / deploy.
        if (node.triggerMode != 'triggerMode.statechange') {
            setTimeout(evaluate, 1000)
        }

        if (node.mqttSettings && node.mqttSettings.mqttHost){
            
            const protocol = 'mqtt'
            const host = node.mqttSettings.mqttHost
            const port = node.mqttSettings.mqttPort
            const clientId=`mqtt_${Math.random().toString(16).slice(3)}`;
            const connectUrl = `${protocol}://${host}:${port}`
           
            //node.log("user:["+node.mqttSettings.mqttUser+"]");
            //node.log("pass:["+node.mqttSettings.mqttPassword+"]");
            //node.log("mqtt.connectUrl:"+connectUrl);
            //node.log("clientId:"+clientId);

            node.mqttclient = mqtt.connect(connectUrl, {
                clientId,
                clean: true,
                keepalive:60,
                connectTimeout: 4000,
                username: node.mqttSettings.mqttUser,
                password: node.mqttSettings.mqttPassword,
                reconnectPeriod: 1000,
            });

            node.mqttclient.on('error', function (error) {
                node.warn("MQTT error:"+error);
            });
        
            node.mqttclient.on('connect', () => {

                node.log('MQTT Connected start dequeuing'); 
                let msg=node.mqttstack.shift();
            
                while (msg!==undefined){
                    if (msg.topic===undefined || msg.payload===undefined)
                        return;
                    node.mqttclient.publish(msg.topic,JSON.stringify(msg.payload),{ qos: msg.qos, retain: msg.retain },(error) => {
                        if (error) {
                            node.error(error)
                            }
                        });
                        msg=node.mqttstack.shift();
                    }
                });
            }
    
            function sendMqtt(){

                if (node.mqttclient==null || node.mqttclient.connected!=true){
                    node.warn("MQTT not connected...");
                    return;
                }

                node.log('MQTT dequeueing'); 

                let msg=node.mqttstack.shift();
                
                while (msg!==undefined){
                    let msgstr=JSON.stringify(msg.payload);
                    if (msg.topic===undefined || msg.payload===undefined)
                        return;
 
                    node.mqttclient.publish(msg.topic.toString(),JSON.stringify(msg.payload),{ qos: msg.qos, retain: msg.retain },(error) => {
                        if (error) {
                            node.error(error)
                        }
                    });
                    msg=node.mqttstack.shift();
                }
            };


        mqttAdvertise();

        node.on('close', function() {
            clearInterval(node.evalInterval)
        })

    }

    RED.nodes.registerType('smart-scheduler', SmartScheduler)
}
