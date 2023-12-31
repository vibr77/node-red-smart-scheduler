
/*
__   _____ ___ ___        Author: Vincent BESSON
 \ \ / /_ _| _ ) _ \      Release: 0.66
  \ V / | || _ \   /      Date: 20230930
   \_/ |___|___/_|_\      Description: Nodered Heating Scheduler
                2023      Licence: Creative Commons
______________________
*/ 

/*
TODO:
-----

+ When changing select param can not published
+ HTML when adding a new zone it comes after the bin
*/


var moment = require('moment'); // require
const mqtt = require("mqtt");
var pjson = require('./package.json');

module.exports = function(RED) {
    'use strict'
    var path = require('path')
    var util = require('util')
    var scheduler = require('./lib/scheduler.js')
 
    var SmartScheduler = function(n) {
        RED.nodes.createNode(this, n)
       
        this.topic = n.topic
   
        this.name=n.name ? n.name : "smartscheduler";
        this.triggerMode = n.triggerMode ? n.triggerMode : 'trigger.statechange.startup'
        this.schedules = n.schedules ? n.schedules : "[]";
        this.schedules=JSON.parse(n.schedules);                                 // JSON of the node schedules and schedules.event
        this.rules=n.rules;  
        this.activScheduleId=n.activScheduleId;                                 // ID of the active schedule
        this.defaultSp=n.defaultSp ?  n.defaultSp : '5'                         // When no event, out put the default sp 
        this.allowOverride=n.allowOverride ? n.allowOverride :false;
        this.executionMode = n.executionMode ? n.executionMode : 'auto'                        // Current execution mode
        this.overrideTs= n.overrideTs ? n.overrideTs : '0'                      // Timestamp of override mode start 
        this.overrideDuration=n.overrideDuration ? n.overrideDuration :"120"    // Duration of the override periode (set in setting)
        this.overrideSp=n.overrideSp ? n.overrideSp : "5"                       // Override set point by default
        this.cycleDuration=n.cycleDuration ?n.cycleDuration: 1
        this.activeRuleIdx=0                                                    // Active Rule ID for the current event
        this.prevRuleIdx=0                                                      // Previous active Rule ID

        this.activeSp=0;                                                        // Active SP
        this.prevSp=0;                                                          // Previous SP
         
        this.firstEval = true                                                   // First iteration loop evaluation
        this.manualTrigger = false;                                             // Manual trigger flag from the input
    
        this.debugInfo=n.debugInfo? n.debugInfo :false;                         // Flag to send message to the console
        this.noout=false;
        this.mqttclient=null;
        this.mqttstack=[];
        
        var node = this;

        this.mqttSettings = RED.nodes.getNode(n.mqttSettings);
       

        if ( this.mqttSettings?.mqttHost);
            node.log(this.mqttSettings?.mqttHost);
        
         // START OF MQTT
        if (this.mqttPrefix && this.mqttSettings.mqttRootPath)
            this.mqttPrefix=this.mqttSettings.mqttRootPath
        else 
            this.mqttPrefix="homeassistant";
        
        this.uniqueId=n.uniqueId ? n.uniqueId : "SmartScheduler_1";

        this.adv_mode_topic=this.mqttPrefix+"/select/"+node.uniqueId+"/mode/config";
        this.state_mode_topic=this.mqttPrefix+"/"+node.uniqueId+"/mode/state";
        this.set_mode_topic=this.mqttPrefix+"/"+node.uniqueId+"/mode/set";

        this.adv_current_sp_topic=this.mqttPrefix+"/sensor/"+node.uniqueId+"/current_sp/config";
        this.state_current_sp_topic=this.mqttPrefix+"/"+node.uniqueId+"/current_sp/state";

        this.adv_override_duration_left_topic=this.mqttPrefix+"/sensor/"+node.uniqueId+"/duration_left/config";
        this.state_override_duration_left_topic=this.mqttPrefix+"/"+node.uniqueId+"/duration_left/state";

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

        
        this.ev=function(){
            node.manualTrigger=true;
            evaluate();
        }
        this.dev={
            ids:[node.uniqueId],
            name:node.name,
            mdl:"Smart-Scheduler",
            mf:"VIBR",
            sw:pjson.version,
            hw_version:"1.0"
        }

        function nlog(msg){
            if (node.debugInfo==true){
                node.log(msg);
            }
        }

        function isEqual(a, b) {
            // simpler and more what we want compared to RED.utils.compareObjects()
            return JSON.stringify(a) === JSON.stringify(b)
        }

        function setState(matchingEvent) {
            var msg = {};

            let hasSpchanged=false;

            if (node.executionMode=="off"){
                nlog("scheduler executionMode:off returning");
                
                node.status({
                    fill:  'black',
                    shape: 'dot',
                    text:("executionMode: off, no event")
                });
                return;

            }else if (node.executionMode=="manual"){
                nlog("node.executionMode==manual");
                
                let ovrM=moment(node.overrideTs).add(node.overrideDuration,"m")
                let now = moment();
                let diff=ovrM.diff(now,"m")+1;
            
                node.activeSp=node.overrideSp;
                
                if (parseFloat(node.activeSp)!=parseFloat(node.prevSp))
                    hasSpchanged=true;
                
                msg.payload={
                    topic: node.topic,
                    command:"set",
                    setpoint:parseFloat(node.overrideSp),
                    previous_setpoint:parseFloat(node.prevSp),
                    executionmode:node.executionMode,
                    setname:"override",
                    overrideduration:parseInt(node.overrideDuration),
                    activeruleidx:-1,
                    prevruleidx: parseInt(node.prevRuleIdx),
                    triggermode:node.triggerMode,
                    manualtrigger:node.manualTrigger,
                    short_start:0,
                    short_end:0,
                    start:0,
                    end:0,
                    duration:diff,
                    hasspchanged:hasSpchanged
                }

                if (node.mqttclient!=null && node.mqttstack.length<100){
                    let mqttmsg={topic:node.state_mode_topic,payload:{value:"manual"},qos:0,retain:false};
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

                    mqttmsg={topic:node.state_override_duration_left_topic,payload:{value:diff},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);
                
                    sendMqtt();
                }

                node.status({
                    fill:  'yellow',
                    shape: 'dot',
                    text:("manual sp "+node.overrideSp+" °C, "+diff+" min left")
                });   

            }else if (matchingEvent.ruleIdx==-1){

                if (node.mqttclient!=null && node.mqttstack.length<100 ){
                    
                    let mqttmsg={topic:node.state_current_sp_topic,payload:{value:node.defaultSp},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_previous_sp_topic,payload:{value:node.prevSp},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);
                    
                    mqttmsg={topic:node.state_current_event_name_topic,payload:{value:"None"},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);
                
                    mqttmsg={topic:node.state_current_event_start_topic,payload:{value:"-"},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_current_event_end_topic,payload:{value:"-"},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_override_duration_left_topic,payload:{value:0},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    sendMqtt();
                }

                node.activeSp=node.defaultSp;
                
                if (parseFloat(node.activeSp)!=parseFloat(node.prevSp))
                    hasSpchanged=true;
                
                
                msg.payload={
                    topic: node.topic,
                    command:"set",
                    setpoint:parseFloat(node.defaultSp),
                    previous_setpoint:parseFloat(node.prevSp),
                    setname:"default rule",
                    short_start:0,
                    short_end:0,
                    start:0,
                    end:0,
                    manualtrigger:node.manualTrigger,
                    triggermode:node.triggerMode,
                    active_ruleidx:parseInt(matchingEvent.ruleIdx),
                    previous_ruleidx: parseInt(node.prevRuleIdx),
                    executionmode:node.executionMode,
                    hasspchanged:hasSpchanged
                }

                node.status({
                    fill:  'gray',
                    shape: 'ring',
                    text:("Default setpoint: "+node.defaultSp+" °C")
                });
            }else if (matchingEvent.ruleIdx>=0){
                
                nlog("matchingEvent.eventId:"+matchingEvent.eventId)
                var event=node.events.find((item) => parseInt(item.id)==parseInt(matchingEvent.eventId));
                
                var m_s=moment(event.start);
                var m_e=moment(event.end);
                var d_s=m_s.format('HH:mm');
                var d_e=m_e.format('HH:mm');
                
                var dayStr=["","Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

                var period=dayStr[m_s.days()]+" "+d_s+" - "+dayStr[m_e.days()]+" "+d_e;
                if (node.rules===undefined){
                    node.warn("error node.rules is undefined");
                    return;
                }

                let r=node.rules.find(({ruleIdx}) => parseInt(ruleIdx)==parseInt(matchingEvent.ruleIdx));
                if (r===undefined){
                    node.error("rule should not be undefined");
                    return;
                }

                if (node.mqttclient!=null && node.mqttstack.length<100){

                    let mqttmsg={topic:node.state_mode_topic,payload:{value:"auto"},qos:0,retain:false};
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

                    mqttmsg={topic:node.state_override_duration_left_topic,payload:{value:0},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    sendMqtt();
                }

                node.status({
                    fill:  'green',
                    shape: 'dot',
                    text:(r.setName+" "+r.spTemp+" °C "+period)
                });

                node.activeSp=r.spTemp;

                if (parseFloat(node.activeSp)!=parseFloat(node.prevSp))
                    hasSpchanged=true;

                msg.payload={
                    topic:node.topic,
                    command:"set",
                    setpoint:parseFloat(r.spTemp),
                    previous_setpoint:parseFloat(node.prevSp),
                    setname:r.setName,
                    short_start:d_s,
                    short_end:d_e,
                    start:event.start,
                    end:event.end,
                    manualtrigger:node.manualTrigger,
                    triggermode:node.triggerMode,
                    active_ruleIdx:parseInt(node.activeRuleIdx),
                    previous_ruleIdx: parseInt(node.prevRuleIdx),
                    executionmode:node.executionMode,
                    hasspchanged:hasSpchanged
                }
            }

            // Only send anything if the state have changed, on trigger and when configured to output on a minutely basis.
            
            nlog("-->setState(matchingEvent) output:");
            nlog("   node.activeRuleIdx:"+node.activeRuleIdx);
            nlog("   node.prevRuleIdx:"+node.prevRuleIdx);
            nlog("   node.activeSp:"+node.activeSp);
            nlog("   node.prevSp:"+node.prevSp);
            nlog("   noout:"+node.noout)
            
            if (node.manualTrigger || 
                node.triggerMode == 'triggerMode.minutely' || 
                !isEqual(node.activeRuleIdx, node.prevRuleIdx) || 
                !isEqual(node.activeSp, node.prevSp) || node.firstEval==true) {
                                
                if (/*!node.firstEval &&*/ !node.noout){
                    node.send([msg,null]);
                    //nlog("   output msg:"+JSON.stringify(msg));
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
            
            let msg={};
            msg.payload={
                name:"Mode",
                uniq_id:node.uniqueId+"MODE",
                icon:"mdi:cog-clockwise",
                qos:0,
                retain:true,
                command_topic:node.set_mode_topic,
                options:["off","manual","auto"],
                state_topic:node.state_mode_topic,
                value_template:"{{value_json.value}}",
                dev:node.dev
            }
            let mqttmsg={topic:node.adv_mode_topic,payload:msg.payload,qos:msg.payload.qos,retain:msg.payload.retain};
            node.mqttstack.push(mqttmsg);

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
                state_topic:node.state_schedule_list_topic,
                command_topic:node.set_schedule_list_topic,
                options:arr,
                value_template:"{{value_json.value}}",
                dev:node.dev
            }

            
            mqttmsg={topic:node.adv_schedule_list_topic,payload:msg.payload,qos:0,retain:false};
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
                name:"Duration left",
                uniq_id:node.uniqueId+"MD",
                icon:"mdi:clock-time-eight-outline",
                qos:0,
                retain:true,
                state_topic:node.state_override_duration_left_topic,
                unit_of_measurement:"min",
                value_template:"{{value_json.value}}",
                dev:node.dev 
            }

            mqttmsg={topic:node.adv_override_duration_left_topic,payload:msg.payload,qos:msg.payload.qos,retain:msg.payload.retain};
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

            if (node.executionMode == 'off') {
                node.status({fill: 'gray', shape: 'dot', text: 'OFF'})
                return
            }
            
            if (node.executionMode == 'manual') {
                // First check if below threshold override duration
                let ovrM=moment(node.overrideTs).add(node.overrideDuration,"m")
                var now = moment();
                if (now> ovrM.add()){
                    node.executionMode='auto';
                    nlog("   exceed OverrideDuration");
                    nlog("   executionMode=manual->auto");
                }
            }
            let s=node.schedules.find(({idx}) => parseInt(idx)==parseInt(node.activScheduleId));
            if (s===undefined){
                node.warn("scheduler is undefined returning");
                return;
            }

            var matchEvent = scheduler.matchSchedule(s)
            nlog("MatchEvent: ruleIdx:"+matchEvent.ruleIdx+", eventId:"+matchEvent.eventId);
            
            node.activeRuleIdx=parseInt(matchEvent.ruleIdx);

            return setState(matchEvent);
        }

        node.on('input', function(msg) {
           
            if (msg===undefined || msg.payload===undefined){
                node.warn("invalid msg in input");
            }

            if (msg.payload.command!=undefined && msg.payload.command.match(/^(1|on|0|off|auto|override|trigger|schedule)$/i)) {
                
                let command=msg.payload.command;
                if (command == '1' || command == 'trigger' || command== 'on'){
                    node.manualTrigger = true;
                }

                if (command=="auto"){
                    node.executionMode="auto";
                    let now = new Date();
                    node.overrideTs=now.toISOString();
                }

                if (command=="schedule"){

                    if (msg.payload.name===undefined){
                        node.warn('input received schedule missing msg.name ');
                        return;
                    }
                    let s=node.schedules.find(({name}) => name==msg.payload.name);
                
                    if (s===undefined){
                        node.warn('input received schedule name not found');
                        return;
                    }
                    

                    node.events=s.events;                     // <------------------ TODO Change input by name and not by id
                    node.activScheduleId=s.idx;
                    
                    nlog("input change activeSchedule")
                    nlog("node.activScheduleId:"+node.activScheduleId);
                   
                    msg.payload={value:node.schedules.find((sched)=>parseInt(sched.idx)==parseInt(node.activScheduleId)).name};
                    
                    let mqttmsg={topic:node.state_schedule_list_topic,payload:msg.payload,qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    sendMqtt();
                }

                if (command=="off" || command == '0'){
                    node.executionMode="off";
                    let now = new Date();
                    node.overrideTs=now.toISOString();
                }

                if (command=="override"){
                    nlog("Input received: override");
                    if (msg.payload.setpoint=== undefined || isNaN(msg.payload.setpoint) || parseFloat(msg.payload.setpoint)<0 || parseFloat(msg.payload.setpoint)>35){ //<----------- Todo define Max & Min in config
                        node.warn('received trigger missing or invalid msg.sp number');
                        return;
                    }
                       
                    node.executionMode="manual";
                    let now = new Date();
                    node.overrideTs=now.toISOString();
                    node.overrideSp=msg.payload.setpoint;
                    
                    if (msg.payload.noout || msg.payload.noout==true){
                        node.noout=true;
                        nlog("noout==true");
                    }

                }
                
                evaluate();
            }
        })

        if (node.activScheduleId)
            node.events=node.schedules.find((sched)=>parseInt(sched.idx)==parseInt(node.activScheduleId)).events;

        // re-evaluate every minute
        node.evalInterval = setInterval(evaluate, node.cycleDuration *60000)

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

                mqttAdvertise();

                // Initial value at startuo
                let mqttmsg={topic:node.state_mode_topic,payload:{value:node.executionMode},qos:0,retain:false};
                node.mqttstack.push(mqttmsg);

                nlog("MQTT node.activScheduleId:"+node.activScheduleId)
                let s=node.schedules.find(({idx}) => parseInt(idx)==parseInt(node.activScheduleId));
                
                if (s!==undefined){
                    mqttmsg={topic:node.state_schedule_list_topic,payload:{value:s.name},qos:0,retain:false};
                    node.log(JSON.stringify(mqttmsg));
                    node.mqttstack.push(mqttmsg);
                    nlog("MQTT init schedule name:"+s.name);
                }else{
                    nlog("MQTT init value can not find schedule");
                }

                sendMqtt();

                node.mqttclient.subscribe([node.set_mode_topic,node.set_schedule_list_topic], () => {
                    nlog("MQTT Subscribe to topic:")
                    nlog("  "+node.set_mode_topic);
                    nlog("  "+node.set_schedule_list_topic);
                })

                nlog('MQTT Connected start dequeuing'); 

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

            node.mqttclient.on('message', (topic, payload) => {
                
                node.log('MQTT Received topic:'+topic);
                let p=payload.toString();
                node.log('MQTT Received payload:'+p);

                if (topic==node.set_mode_topic && (p=="auto" || p=="manual" || p=="off")){
                    nlog("MQTT change executionMode mode:"+p);
                    var now = new Date();
                    node.overrideTs=now.toISOString();
                    node.executionMode=p;

                    let mqttmsg={topic:node.state_mode_topic,payload:{value:node.executionMode},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);
                    

                    evaluate(); 
                }else if(topic==node.set_schedule_list_topic){
                    let s=node.schedules.find(({name}) => name==p);
                
                    if (s!==undefined){
                        nlog("MQTT change activeSchedule")
                        node.activScheduleId=s.idx;
                        node.events=s.events;

                        let mqttmsg={topic:node.state_schedule_list_topic,payload:{value:p},qos:0,retain:false};
                        node.mqttstack.push(mqttmsg);
                        sendMqtt();

                        evaluate();                     
                    }else{
                        nlog("MQTT received schedule name not found");
                    }
                }
            })
        }
    
            function sendMqtt(){

                if (node.mqttclient==null || node.mqttclient.connected!=true){
                    node.warn("MQTT not connected...");
                    return;
                }

                nlog('MQTT dequeueing'); 

                let msg=node.mqttstack.shift();
                
                while (msg!==undefined){
                   
                    if (msg.topic===undefined || msg.payload===undefined)
                        return;

                    let msgstr=JSON.stringify(msg.payload).replace(/\\"/g, '"');
                    node.mqttclient.publish(msg.topic.toString(),msgstr,{ qos: msg.qos, retain: msg.retain },(error) => {
                        if (error) {
                            node.error(error)
                        }
                    });
                    msg=node.mqttstack.shift();
                }
            };


        

        node.on('close', function() {
            clearInterval(node.evalInterval)
        })

    }

    RED.nodes.registerType('smart-scheduler', SmartScheduler)

    RED.httpAdmin.post("/smartsched/:id", RED.auth.needsPermission("inject.write"), function(req,res) {
        var node = RED.nodes.getNode(req.params.id);
        if (node != null) {
            try {
               
                node.ev();
                
                res.sendStatus(200);
            } catch(err) {
                res.sendStatus(500);
                node.error(RED._("inject.failed",{error:err.toString()}));
            }
        } else {
            res.sendStatus(404);
        }
    });
}
