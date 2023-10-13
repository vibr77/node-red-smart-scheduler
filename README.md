# Smart Scheduler

WORK IN PROGRESS, close to a stable release, please help me and report any issue

This node is part of a suite of nodes to control heating:
    - smart-scheduler: visual, multi schedule management,
    - smart-valve: manage valve in a same room in a group and enable auto-recalibration and as well on device override,
    - smart-boiler: enable to pilote the boiler with the most relevant temperature according to the valves in the house

This node have been more than inspired by the excellent work of node-red-contrib-light-scheduler.

It enables to define heating zones with temperature setPoint. It support multiple schedule and expose realtime information to home assistant.

The Smartscheduler is interface with Home assistant and use MQTT to advertise and send update.

<img src="https://github.com/vibr77/node-red-smart-scheduler/blob/main/doc/img/ss_visual_1.png?raw=true" width=450>

## Key features:

- Interface with Home Assistant (adversise, and update),
- Heating zone definition with color
- Multiple schedule management, switch directly from home assistant
- Visual weekly calendar, copy daily schedule from 1 day to another
- Manual Override mode with duration
- On / Off / Auto mode
- Different output modes (state-change, state-change+startup, every minute)
- External manual trigger
- Default setPoint

## Details

### Input 

Messages in input are:

- switch to auto mode: switch to override to auto mode executing the current schedule
```
msg:{
    payload:"auto"
}
```

- manual trigger: resend the current event to the flow
```
msg:{
    payload:"trigger"|"on"
}
```

- Override: Override the current schedule for a duration defined in settings
```
msg:{
    payload:"override",
    sp:int // between 0 & 35            // override set point (target temperature)
    noout:true|false                    // avoid the scheduler to reissue output and having an endless loop
}
```

- Schedule : change the current active schedule
```
msg:{
    payload:"schedule",
    id:int // schedule ID
}
```

### Outputs

This node has 1 output to send update to smart-valve,

the tipical msg output is :
```
msg.payload={
    "setPoint":20,                          // target temperature of the valve based on the schedule                     
    "prevSetPoint":0,                       // previous target temperature
    "setName":"Confort",                    // name of the heating zone
    "short_start":"17:00",                  // schedule event start time
    "short_end":"20:00",                    // schedule event end time
    "start":"2018-01-05 17:00:00",          // start iso timestamp
    "end":"2018-01-05 20:00:00",            // end iso timestamp
    "manualTrigger":false,                  // is this the result of a manual trigger
    "triggerMode":"triggerMode.statechange.startup",
    "activeRuleIdx":3,                      // rule id
    "prevRuleIdx":0,                        // prev rule id
    "override":"auto",                      // execution mode |auto|manual|off
    "hasSpchanged":true                     // has the setpoint changed from the previous cycle
}
```

### Interface with Home Assistant

The smart scheduler is doing advertising of the entities and should be discovered as new device automatically.
The name of the device in Home Assistant is the name of the node in the setting.

<img src="https://github.com/vibr77/node-red-smart-scheduler/blob/main/doc/img/ha_ss.png?raw=true" width=450>



<a href="https://www.buymeacoffee.com/vincentbe" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>




