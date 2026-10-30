
/*
__   _____ ___ ___        Author: Vincent BESSON
 \ \ / /_ _| _ ) _ \      Release: 0.82.1
  \ V / | || _ \   /      Date: 20261030
   \_/ |___|___/_|_\      Description: Nodered Heating Scheduler
                2026      Licence: Creative Commons
______________________
*/ 

/* TEST Env
npm install ./modulename (SmartValve / SmartBoiler / SmartSchedule)
node-red -v -D logging.console.level=trace
// Web http://localhost:1880/

Deploy to npmjs
npm publish

*/

/*
TODO:
-----

+ Add local js lib for offline (calendat.js)
*/


var moment = require('moment'); // require
const mqtt = require("mqtt");
const fs = require('fs');
const path = require('path');
const pjson = require('./package.json');

module.exports = function(RED) {
    'use strict'
    const scheduler = require('./lib/scheduler.js')
 
    function SmartScheduler(n) {
        RED.nodes.createNode(this, n)
       
        this.name=n.name ? n.name : "smartscheduler";
        this.triggerMode = n.triggerMode ? n.triggerMode : 'trigger.statechange.startup'
        
        try {
            this.schedules = n.schedules ? JSON.parse(n.schedules) : [];
        } catch (e) {
            this.schedules = [];
            this.error("Error parsing schedules JSON: " + e.message);
        }

        this.rules=n.rules;  
        this.activScheduleId=n.activScheduleId;                                 // ID of the active schedule
        this.defaultSp=n.defaultSp ?  n.defaultSp : '5'                         // When no event, out put the default sp 
        this.allowOverride=n.allowOverride ? n.allowOverride :false;
        this.executionMode = n.executionMode ? n.executionMode : 'auto'         // Current execution mode
        this.overrideTs= n.overrideTs ? n.overrideTs : '0'                      // Timestamp of override mode start 
        this.overrideDuration=n.overrideDuration ? n.overrideDuration :"120"    // Duration of the override periode (set in setting)
        this.overrideSp=n.overrideSp ? n.overrideSp : "5"                       // Override set point by default
        this.cycleDuration=parseInt(n.cycleDuration) > 0 ? parseInt(n.cycleDuration) : 1
        // 0.82 options
        // resendInterval: re-send the current setpoint every N minutes even when unchanged, so a valve
        //                 that missed a message gets it again (0 = only on change, as in 0.81).
        // maxSp:          ceiling for every setpoint sent (schedule, default, manual and overrides).
        this.resendInterval=(n.resendInterval!==undefined && n.resendInterval!=="" && !isNaN(n.resendInterval)) ? parseInt(n.resendInterval) : 15
        this.maxSp=(n.maxSp!==undefined && n.maxSp!=="" && !isNaN(n.maxSp)) ? parseFloat(n.maxSp) : 24
        this.lastSendTs=0
        this.overrideExpiredTs=0                                                // when the last override ended
        this.overrideExpiredSp=undefined                                        // its setpoint (loop guard)
        this.activeRuleIdx=0                                                    // Active Rule ID for the current event
        this.prevRuleIdx=0                                                      // Previous active Rule ID

        this.activeSp=0;                                                        // Active SP
        this.prevSp=0;                                                          // Previous SP
         
        this.firstEval = true                                                   // First iteration loop evaluation
        this.manualTrigger = false;                                             // Manual trigger flag from the input
        this.endOfOverride=false;                                               // Trigger after override period end
    
        this.debugInfo=n.debugInfo? n.debugInfo :"none";                         // Flag to send message to the console
        this.noout=false;
        this.mqttclient=null;
        this.mqttstack=[];
        
        const node = this;

        this.mqttSettings = RED.nodes.getNode(n.mqttSettings);
       
        if ( this.mqttSettings?.mqttHost)
            node.log(this.mqttSettings?.mqttHost);
        
         // START OF MQTT
        if (this.mqttSettings && this.mqttSettings.mqttRootPath)
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

        node.warn("Smart-Scheduler node started, name:"+node.name+", uniqueId:"+node.uniqueId);
        
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

        function nlog(msg, level="debug"){
            const levels = {
                "none": 0,
                "error": 1,
                "warn": 2,
                "info": 3,
                "debug": 4
            };
            const currentLevel = levels[node.debugInfo] || 0;
            const msgLevel = levels[level] || 4;

            if (msgLevel <= currentLevel){
                if (level === "error") {
                    node.error(msg);
                } else if (level === "warn") {
                    node.warn(msg);
                } else {
                    node.log(msg);
                    // Also send to warn if it was previously doing so for debug visibility in sidebar
                    // The original code did node.log AND node.warn for debugInfo=true
                    if (level === "debug" || level === "info") {
                         node.warn(msg); 
                    }
                }
            }
        }

        function saveState() {
            const state = {
                executionMode: node.executionMode,
                overrideTs: node.overrideTs,
                overrideSp: node.overrideSp,
                overrideDuration: node.overrideDuration,
                activScheduleId: node.activScheduleId,
                activeSp: node.activeSp,
                prevSp: node.prevSp,
                activeRuleIdx: node.activeRuleIdx,
                prevRuleIdx: node.prevRuleIdx,
                configKey: configKey,
                timestamp: Date.now()
            };
            
            // Save to both context and file system
            node.context().set("schedulerState", state);
            
            // Save to file for persistence across deploys
            const stateDir = path.join(RED.settings.userDir, '.node-red-state');
            const stateFile = path.join(stateDir, `scheduler-${node.id}.json`);
            
            try {
                if (!fs.existsSync(stateDir)) {
                    fs.mkdirSync(stateDir, { recursive: true });
                }
                fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
                nlog("State saved to file: mode=" + node.executionMode + ", sp=" + node.activeSp, "debug");
            } catch (err) {
                nlog("Error saving state to file: " + err.message, "error");
            }
        }

        // The editor configuration that the saved state may override. If it changed since the state
        // was saved (a deploy with a new active schedule, mode or duration), the editor wins.
        const configKey = JSON.stringify([n.executionMode, n.activScheduleId, n.overrideDuration]);

        // Load saved state at startup
        let savedState = null;
        
        // Try to load from file first (persists across deploys)
        const stateDir = path.join(RED.settings.userDir, '.node-red-state');
        const stateFile = path.join(stateDir, `scheduler-${node.id}.json`);
        
        try {
            if (fs.existsSync(stateFile)) {
                const fileData = fs.readFileSync(stateFile, 'utf8');
                savedState = JSON.parse(fileData);
                nlog("Loaded state from file", "info");
            }
        } catch (err) {
            nlog("Error loading state from file: " + err.message, "warn");
        }
        
        // Fallback to context storage if file doesn't exist
        if (!savedState) {
            savedState = node.context().get("schedulerState");
            if (savedState) {
                nlog("Loaded state from context", "info");
            }
        }
        
        if (savedState && savedState.configKey!==undefined && savedState.configKey!==configKey) {
            nlog("Editor configuration changed since last run: saved mode/schedule ignored", "info");
            node.activeSp = savedState.activeSp || 0;
            node.prevSp = savedState.prevSp || 0;
            savedState = null;
        }
        if (savedState) {
            node.executionMode = savedState.executionMode || node.executionMode;
            node.overrideTs = savedState.overrideTs || node.overrideTs;
            node.overrideSp = savedState.overrideSp || node.overrideSp;
            node.overrideDuration = savedState.overrideDuration || node.overrideDuration;
            node.activScheduleId = savedState.activScheduleId || node.activScheduleId;
            node.activeSp = savedState.activeSp || 0;
            node.prevSp = savedState.prevSp || 0;
            node.activeRuleIdx = savedState.activeRuleIdx || 0;
            node.prevRuleIdx = savedState.prevRuleIdx || 0;
            nlog("Loaded saved state: mode=" + node.executionMode + ", sp=" + node.activeSp, "info");
        }

        // Setpoint sent to the valves: numeric, rounded, capped at maxSp. undefined when invalid.
        function outSp(v) {
            let f=parseFloat(v);
            if (isNaN(f)) return undefined;
            if (f>node.maxSp){
                nlog(`Setpoint ${f}°C above max ${node.maxSp}°C, capped`,"warn");
                f=node.maxSp;
            }
            return parseFloat(f.toFixed(2));
        }

        function isEqual(a, b) {
            // simpler and more what we want compared to RED.utils.compareObjects()
            return JSON.stringify(a) === JSON.stringify(b)
        }

        function setState(matchingEvent=-1) {
            var msg = {};

            let hasSpchanged=false;

            if (node.activScheduleId===undefined){
                node.status({
                    fill:  'yellow',
                    shape: 'dot',
                    text:("Not ready, schedule not defined")
                }); 
                return;
            }

            if (node.executionMode=="off"){
                // 0.81 sent nothing, so every valve kept its last setpoint and kept heating.
                // Off now sends the default setpoint (frost protection) to the valves.
                nlog("scheduler executionMode:off, sending default setpoint","debug");
                node.activeSp=node.defaultSp;
                hasSpchanged = parseFloat(node.activeSp)!=parseFloat(node.prevSp);
                msg.payload={
                    command:"set",
                    setpoint:outSp(node.defaultSp),
                    previous_setpoint:outSp(node.prevSp),
                    setname:"off",
                    executionmode:node.executionMode,
                    manualtrigger:node.manualTrigger,
                    triggermode:node.triggerMode,
                    hasspchanged:hasSpchanged
                }
                if (node.mqttclient!=null && node.mqttstack.length<100){
                    node.mqttstack.push({topic:node.state_mode_topic,payload:{value:"off"},qos:0,retain:false});
                    node.mqttstack.push({topic:node.state_current_sp_topic,payload:{value:parseFloat(node.defaultSp).toFixed(2)},qos:0,retain:false});
                    sendMqtt();
                }
                node.status({
                    fill:  'grey',
                    shape: 'dot',
                    text:("Off, default sp: "+node.defaultSp+" °C")
                });

            }else if (node.executionMode=="manual"){                                            // Manual Execution
                nlog("node.executionMode==manual","debug");
                
                let ovrM=moment(node.overrideTs).add(node.overrideDuration,"m")
                let now = moment();
                let diff=ovrM.diff(now,"m")+1;
            
                node.activeSp=node.overrideSp;
                
                if (parseFloat(node.activeSp)!=parseFloat(node.prevSp))
                    hasSpchanged=true;
                
                msg.payload={
                        command:"set",
                        setpoint:outSp(node.overrideSp),
                        previous_setpoint:parseFloat(parseFloat(node.prevSp).toFixed(2)),
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

                    mqttmsg={topic:node.state_current_sp_topic,payload:{value:parseFloat(node.overrideSp).toFixed(2)},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_previous_sp_topic,payload:{value:parseFloat(node.prevSp).toFixed(2)},qos:0,retain:false};
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
                    text:("Manual sp:"+node.overrideSp+" °C, "+diff+" min left")
                });   

            }else if (matchingEvent.ruleIdx==-1){                                               // No matching event found, output default sp
                nlog("matchingEvent.ruleIdx==-1 no event matched, output default sp","debug");
                if (node.mqttclient!=null && node.mqttstack.length<100 ){
                    
                    let mqttmsg={topic:node.state_current_sp_topic,payload:{value:parseFloat(node.defaultSp).toFixed(2)},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_previous_sp_topic,payload:{value:parseFloat(node.prevSp).toFixed(2)},qos:0,retain:false};
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
                    command:"set",
                    setpoint:outSp(node.defaultSp),
                    previous_setpoint:outSp(node.prevSp),
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
                    text:("Default sp: "+node.defaultSp+" °C")
                });

            }else if (matchingEvent.ruleIdx>=0){                                                // Matching event found
                
                node.prevRuleIdx=node.activeRuleIdx;
                node.activeRuleIdx=parseInt(matchingEvent.ruleIdx);

                nlog("matchingEvent.ruleIdx:"+matchingEvent.ruleIdx + " eventId:"+matchingEvent.eventId,"debug");
               
                var event=(node.events||[]).find((item) => parseInt(item.id)==parseInt(matchingEvent.eventId));
                if (event===undefined){
                    nlog("matching event "+matchingEvent.eventId+" not found in the active schedule","error");
                    return;
                }
                
                var m_s=moment(event.start);
                var m_e=moment(event.end);
                var d_s=m_s.format('HH:mm');
                var d_e=m_e.format('HH:mm');
                
                var dayStr=["","Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

                var period=dayStr[m_s.days()]+" "+d_s+" - "+dayStr[m_e.days()]+" "+d_e;
                if (node.rules===undefined){
                    nlog("error node.rules is undefined","error");
                    return;
                }

                let r=node.rules.find(({ruleIdx}) => parseInt(ruleIdx)==parseInt(matchingEvent.ruleIdx));
                if (r===undefined){
                    nlog("rule should not be undefined","error");
                    return;
                }

                if (node.mqttclient!=null && node.mqttstack.length<100){

                    let mqttmsg={topic:node.state_mode_topic,payload:{value:"auto"},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);

                    mqttmsg={topic:node.state_current_sp_topic,payload:{value:parseFloat(r.spTemp).toFixed(2)},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);
                    
                    mqttmsg={topic:node.state_previous_sp_topic,payload:{value:parseFloat(node.prevSp).toFixed(2)},qos:0,retain:false};
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
                    command:"set",
                    setpoint:outSp(r.spTemp),
                    previous_setpoint:outSp(node.prevSp),
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
            
            nlog(`-->setState(matchingEvent) output: activeRuleIdx:${node.activeRuleIdx}, prevRuleIdx:${node.prevRuleIdx}, activeSp:${node.activeSp}, prevSp:${node.prevSp}, noout:${node.noout}`, "debug");
            
            if (msg.payload===undefined || msg.payload.setpoint===undefined){
                nlog("invalid setpoint, nothing sent","error");
                node.firstEval = false
                node.manualTrigger = false
                return;
            }

            let resendDue = node.resendInterval>0 && Date.now()-node.lastSendTs>=node.resendInterval*60000;

            if (node.manualTrigger || 
                node.triggerMode == 'triggerMode.minutely' || 
                node.activeRuleIdx !== node.prevRuleIdx || 
                String(node.activeSp) !== String(node.prevSp) || node.firstEval==true || resendDue) {
                                
                if (/*!node.firstEval &&*/ !node.noout){
                    node.send(msg);
                    node.lastSendTs=Date.now();
                    node.noout=false;
                }else if (node.noout==true)
                    node.noout=false;
                    
                node.prevPayload = msg.payload
                node.prevSp=    node.activeSp;
                node.prevRuleIdx=node.activeRuleIdx
                saveState();  // Save state after successful update
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
                //node.status({fill: 'gray', shape: 'dot', text: 'OFF'})
                return setState(null);
            }
            
            if (node.executionMode == 'manual') {
                // First check if below threshold override duration
                let ovrM=moment(node.overrideTs).add(node.overrideDuration,"m")
                var now = moment();
                if (now > ovrM){
                    node.executionMode='auto';
                    node.overrideExpiredTs=Date.now();
                    node.overrideExpiredSp=node.overrideSp;
                    nlog("   exceed OverrideDuration, executionMode=manual->auto","debug");
                    node.noout=false;
                    node.endOfOverride=true;
                }
            }

            let s=(node.schedules||[]).find(({idx}) => parseInt(idx)==parseInt(node.activScheduleId));
            if (s===undefined){
                node.activScheduleId=undefined;
                nlog("scheduler is undefined returning","error");
                return setState(null);
            }

            var matchEvent = scheduler.matchSchedule(s)
            nlog("MatchEvent: ruleIdx:"+matchEvent.ruleIdx+", eventId:"+matchEvent.eventId);
            
            return setState(matchEvent);
        }

        node.on('input', function(msg){
           
            if (msg===undefined || msg.payload===undefined || msg.payload===null){
               nlog("invalid msg in input","error");
               return;
            }

            if (msg.payload.command!=undefined && String(msg.payload.command).match(/^(1|on|0|off|auto|override|trigger|schedule)$/i)) {
                
                let command=String(msg.payload.command).toLowerCase();
                if (command == '1' || command == 'trigger' || command== 'on'){
                    node.manualTrigger = true;
                    if (command == 'on' && node.executionMode=="off")
                        node.executionMode="auto";

                    nlog("Command:trigger/on/1 manual trigger evaluation","info");
                }

                else if (command=="auto"){
                    node.executionMode="auto";
                    let now = new Date();
                    node.overrideTs=now.toISOString();
                    nlog("Command:auto set executionMode to auto","info");
                    saveState();  // Save state when mode changes
                }

                else if (command=="schedule"){

                    if (msg.payload.name===undefined){
                        nlog('Command:schedule, missing input parameter:msg.name ','error');
                        return;
                    }
                    let s=node.schedules.find(({name}) => name==msg.payload.name);
                
                    if (s===undefined){
                        nlog('Command:schedule, schedule name:'+msg.payload.name+' not found','error');
                        return;
                    }
                    
                    node.events=s.events;                     // <------------------ TODO Change input by name and not by id
                    node.activScheduleId=s.idx;
                    
                    nlog("Command:schedule change active schedule to name:"+s.name,"info");
                    
                    msg.payload={value:node.schedules.find((sched)=>parseInt(sched.idx)==parseInt(node.activScheduleId)).name};
                    
                    let mqttmsg={topic:node.state_schedule_list_topic,payload:msg.payload,qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);
                    sendMqtt();
                    
                    saveState();  // Save state when schedule changes
                    
                }

                else if (command=="off" || command == '0'){
                    nlog("Command:off set executionMode to off","info");
                    node.executionMode="off";
                    let now = new Date();
                    node.overrideTs=now.toISOString();
                    saveState();  // Save state when mode changes
                }

                else if (command=="override"){
                   
                    if (msg.payload.setpoint=== undefined || isNaN(msg.payload.setpoint) || parseFloat(msg.payload.setpoint)<0 || parseFloat(msg.payload.setpoint)>40){ //<----------- Todo define Max & Min in config
                       nlog('Command:override missing or invalid msg.setpoint number',"error");
                        return;
                    }
                       
                    // The editor's "Override" checkbox was never checked in 0.81.
                    if (!(node.allowOverride===true || node.allowOverride==='true')){
                        nlog("Command:override ignored: Override not allowed on this scheduler","warn");
                        return;
                    }

                    let ovSp=outSp(msg.payload.setpoint);

                    // Loop guard: the same setpoint coming back right after its override expired is not a
                    // person turning a knob, it is a device repeating a stale value (stuck TRV).
                    if (node.overrideExpiredSp!==undefined && Date.now()-node.overrideExpiredTs<10*60000 &&
                        parseFloat(node.overrideExpiredSp)==ovSp){
                        nlog(`Command:override ${ovSp}°C ignored: same value as the override that just expired (stuck device?)`,"warn");
                        return;
                    }

                    node.executionMode="manual";
                    let now = new Date();
                    node.overrideTs=now.toISOString();
                    node.overrideSp=ovSp;
                    
                    if (msg.payload.noout===true || msg.payload.noOut===true){
                        node.noout=true;
                        nlog("noout==true");
                    }

                    nlog("Command:override set executionMode to manual, sp:"+node.overrideSp,"info");
                    saveState();  // Save state when entering override mode
                    
                }
                // Evaluate is done is not returned before by one of the above conditions

                safeEvaluate();
            }
            else{
                if (msg.payload.command!=undefined )
                    nlog("invalid command in input msg.payload.command:"+msg.payload.command,"error"); 
                else
                    nlog("invalid or missing command in input msg.payload","warn");
                return;
            }
        });

        if (node.activScheduleId){
            let foundSchedule = node.schedules.find((sched)=>parseInt(sched.idx)==parseInt(node.activScheduleId));
            if (foundSchedule) {
                node.events = foundSchedule.events;
            } else {
                nlog("Active schedule ID "+node.activScheduleId+" not found in schedules list", "warn");
                node.activScheduleId = undefined;
            }
        }

        // Timer callbacks must never throw: an exception there takes Node-RED down.
        function safeEvaluate(){
            try {
                evaluate();
            } catch (e) {
                node.error("evaluate() failed: "+e.message);
            }
        }

        nlog(`Local time ${moment().format()} (UTC offset ${moment().format('Z')}); schedules use this time zone`,"info");

        // re-evaluate every cycle
        node.evalInterval = setInterval(safeEvaluate, node.cycleDuration *60000)

        // Run initially directly after start / deploy.
        if (node.triggerMode != 'triggerMode.statechange') {
            node.startTimeout = setTimeout(safeEvaluate, 1000)
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
                reconnectPeriod: 5000,
            });

            node.mqttclient.on('error', function (error) {
                if (!node.mqttErrorLogged){                  // once per outage, not every retry
                    node.warn("MQTT error: "+error+" (will keep retrying, logged once)");
                    node.mqttErrorLogged=true;
                }
            });
        
            node.mqttclient.on('connect', () => {
                if (node.mqttErrorLogged) node.log('MQTT connected again');
                node.mqttErrorLogged=false;

                mqttAdvertise();

                // Initial value at startuo
                let mqttmsg={topic:node.state_mode_topic,payload:{value:node.executionMode},qos:0,retain:false};
                node.mqttstack.push(mqttmsg);

                nlog("MQTT node.activScheduleId:"+node.activScheduleId,"debug")
                let s=node.schedules.find(({idx}) => parseInt(idx)==parseInt(node.activScheduleId));
                
                if (s!==undefined){
                    mqttmsg={topic:node.state_schedule_list_topic,payload:{value:s.name},qos:0,retain:false};
                    node.log(JSON.stringify(mqttmsg));
                    node.mqttstack.push(mqttmsg);
                    nlog("MQTT init schedule name:"+s.name,"debug");
                }else{
                    nlog("MQTT init value can not find schedule","error");
                }

                sendMqtt();

                node.mqttclient.subscribe([node.set_mode_topic,node.set_schedule_list_topic], () => {
                    nlog(`MQTT Subscribe to topic: ${node.set_mode_topic}, ${node.set_schedule_list_topic}`, "debug");
                })

                nlog('MQTT Connected start dequeuing',"debug"); 
                sendMqtt();
            });

            node.mqttclient.on('message', (topic, payload) => {
                
                node.log('MQTT Received topic:'+topic,"debug");
                let p=payload.toString();
                node.log('MQTT Received payload:'+p,"debug");

                if (topic==node.set_mode_topic && (p=="auto" || p=="manual" || p=="off")){
                    nlog("MQTT change executionMode mode:"+p,"info");
                    var now = new Date();
                    node.overrideTs=now.toISOString();
                    node.executionMode=p;

                    let mqttmsg={topic:node.state_mode_topic,payload:{value:node.executionMode},qos:0,retain:false};
                    node.mqttstack.push(mqttmsg);
                
                    safeEvaluate(); 

                }else if(topic==node.set_schedule_list_topic){
                    let s=node.schedules.find(({name}) => name==p);
                
                    if (s!==undefined){
                        nlog("MQTT change activeSchedule","info")
                        node.activScheduleId=s.idx;
                        node.events=s.events;

                        let mqttmsg={topic:node.state_schedule_list_topic,payload:{value:p},qos:0,retain:false};
                        node.mqttstack.push(mqttmsg);
                        sendMqtt();

                        safeEvaluate();                     
                    }else{
                        nlog("MQTT received schedule name not found","error");
                    }
                }
            })
        }

    
        function sendMqtt(){

            if (node.mqttclient==null || node.mqttclient.connected!=true){
                if (!node.mqttErrorLogged) nlog("MQTT not connected, messages queued","debug");
                return;
            }

            nlog('MQTT dequeueing',"debug"); 

            let msg=node.mqttstack.shift();
            
            while (msg!==undefined){
                
                if (msg.topic===undefined || msg.payload===undefined){
                    msg=node.mqttstack.shift();
                    continue;
                }

                let msgstr=JSON.stringify(msg.payload);
                node.mqttclient.publish(msg.topic.toString(),msgstr,{ qos: msg.qos, retain: msg.retain },(error) => {
                    if (error) {
                        node.error(error)
                    }
                });
                msg=node.mqttstack.shift();
            }
        };

        node.on('close', function(done) {
            nlog("closing mqtt connexion","debug");
            node.log('MQTT disconnecting',"debug");
            clearInterval(node.evalInterval);
            clearTimeout(node.startTimeout);
            if (node.mqttclient) {
                node.mqttclient.end();
            }
            done();
        })

    }

    RED.nodes.registerType('smart-scheduler', SmartScheduler)

    RED.httpAdmin.post("/smartsched/:id", RED.auth.needsPermission("inject.write"), function(req,res) {
        const node = RED.nodes.getNode(req.params.id);
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
