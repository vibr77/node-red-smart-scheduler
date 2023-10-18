# Smart Scheduler

WORK IN PROGRESS, close to a stable release, please help me and report any issue

This node is part of a suite of nodes to control heating:
- smart-scheduler: visual &multi schedule management,
- smart-valve: manage valve in a same room in a group and enable auto-recalibration and as well on device override,
- smart-boiler: enable to pilote the boiler with the most relevant temperature according to the valves in the house.

This node have been more than inspired by the excellent work of [node-red-contrib-light-scheduler](https://github.com/niklaswall/node-red-contrib-light-scheduler).

It enables to define heating zones with temperature setPoint. It support multiple schedules and exposes realtime information to home assistant (via MQTT).

Default setpoint feature and multiple execution mode are as well supported.

The Smartscheduler is interfaced with Home assistant and use MQTT to advertise and send update.

<img src="https://github.com/vibr77/node-red-smart-scheduler/blob/main/doc/img/ss_visual_1.png?raw=true" width=450>

## Key features:

- Interface with Home Assistant (adversise, and update),
- Heating zone definition with color,
- Multiple schedule management, activable directly from home assistant
- Visual weekly calendar, copy daily schedule from 1 day to another
- Manual Override mode with duration,
- On / Off / Auto / Override execution mode
- Different output modes (state-change, state-change+startup, every minute)
- External manual trigger
- Default setPoint when there is no event

## Details

### Input 

The input is used to changed to the current execution mode between:
- Off: smart-scheduler is not active (no output)
- Auto: smart-scheduler is following the active schedule
- override: smart-scheduler is in force mode with a defined setpoint for a defined periode of time

Input can be node-red input and MQTT directly from home assistant (see Home Assistant section)

#### Input payload

The following example give the message expected in input:

```
msg:{
    payload:{
		command:"override",				// set the execution mode
		setpoint:25					// set the new setpoint
	}
}
```



| Field | Values  | description  |
|:----------|:----------|:----------|
| command   | [1\|on\|trigger]    | Manual trigger of an execution cycle   |
| command   | [auto]    | set execution mode to auto    |
| command    | [override]    | set execution mode to override     |
| command | [0\|off]| set execution mode to off (no output)|
| setpoint | [Integer 0-35]| define the override setpoint temperature |
| noout	| [true\|false] | flag to avoid output message from the scheduler on the next cycle to avoid endless loop with override message comming from the smart-valve


### Outputs

This node has 1 output to send update to smart-valve,

the tipical msg output is :
```
msg.payload={
    "setpoint":20,                          // target temperature of the valve based on the schedule                     
    "previous_setpoint":0,                  // previous target temperature
    "setname":"Confort",                    // name of the heating zone
    "short_start":"17:00",                  // schedule event start time
    "short_end":"20:00",                    // schedule event end time
    "start":"2018-01-05 17:00:00",          // start iso timestamp
    "end":"2018-01-05 20:00:00",            // end iso timestamp
    "manualtrigger":false,                  // is this the result of a manual trigger
    "triggermode":"triggerMode.statechange.startup",
    "active_ruleidx":3,                      // rule id
    "prev_ruleidx":0,                        // prev rule id
    "executionmode":"auto",                  // execution mode |auto|manual|off
    "hasSpchanged":true                      // has the setpoint changed from the previous cycle
}
```

### Configuration setting

<img src="https://github.com/vibr77/node-red-smart-scheduler/blob/main/doc/img/ss_node_settings?raw=true" width=450>

#### List of settings:

| Setting | Type  | description  |
|:----------|:----------|:----------|
| Name    | [String]   | Name & title of the nonde in Node-red and in Home assistant    |
| Topic	    | [String]   | topic is not used and sent in every output message    |
| UniqueId    | [String]    | uniqueid is used by home assistant for device & entities discovery, it can not be empty and must be unique (be careful)   |
| Set point    | [Integer 0-35]    | default setpoint value that will be output when no active event are defined    |
| Schedule    | [dropdown-list]    | list of definded schedules, the one selected is active    |
| Rules  | [List]    | list of heating zone used in the visual schedule event definition. A rule is defined by the following field [name\| setpoint value\|color]    |
| Schedule Name | [String]| active schedule name|
| Copy | [list] to [list] [button] | enable to copy a daily schedule to another day|
| clean | [button]| wipe out the active schedule|
| Trigger mode | [list: "when state change, when state change+startup | every cycle]|
| Cycle duration | [Integer 1-60]|duration between two execution cycle default|
| Execution override | [true|false]| allow execution override on the schedule, if false, smart-scheduler will not handle override command in input|
| Execution Mode | [list: auto\|manual\|off]| default execution mode at startup, manual=override|
| Duration| [Integer 1-120]| Override duration in min after override input command|
| Execution setpoint | [Integer 0-35]| Default setpoint for override command|
| Debug info| [true|false] | enable output debug to console|  





### Interface with Home Assistant

The smart-scheduler is inteface with home assistant and entities and should be discovered as new device automatically.

The name of the device in Home Assistant is the name of the node in the setting.

<img src="https://github.com/vibr77/node-red-smart-scheduler/blob/main/doc/img/ha_ss.png?raw=true" width=450>


If you like my work, please support me

<a href="https://www.buymeacoffee.com/vincentbe" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>







