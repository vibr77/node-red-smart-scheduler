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
- State persistence across Node-RED restarts and flow deploys

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

### Business Rules

#### Schedule Activation Condition
A schedule is **ACTIVE** when the current time falls within a defined heating block in the weekly calendar. The node evaluates time-based rules to determine which setpoint to apply.

#### Target Conditions on Input
*   **Command "trigger" or "1"**: Evaluates current schedule and sends setpoint if `executionMode != "off"`
*   **Command "set"**: Updates the active schedule setpoint and triggers evaluation cycle
*   **Command "on" or "auto"**: Sets `executionMode = "auto"`, enables schedule-based control
*   **Command "off" or "0"**: Sets `executionMode = "off"`, disables all output
*   **Command "override"**: 
    *   Sets `executionMode = "override"`
    *   Stores override setpoint and timestamp
    *   Bypasses schedule until override duration expires or cancelled
    *   Override duration is configurable in node settings
    *   Requires `setpoint` value in payload
*   **GroupId matching**: Input messages only processed if `msg.payload.groupId` matches the node's configured Group ID
*   **Schedule selection**: Active schedule is selected either from configuration or via MQTT/input command
*   **Default setpoint**: When no active schedule event exists, the configured default setpoint is used

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

<img src="https://github.com/vibr77/node-red-smart-scheduler/blob/main/doc/img/ss_node_settings.png?raw=true" width=450>

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


<img src="https://github.com/vibr77/node-red-smart-scheduler/blob/main/doc/img/tuto_settings_sched_1.png?raw=true" width=600>

<img src="https://github.com/vibr77/node-red-smart-scheduler/blob/main/doc/img/tuto_settings_sched_2.png?raw=true" width=600>

### Interface with Home Assistant

The smart-scheduler is inteface with home assistant and entities and should be discovered as new device automatically.

The name of the device in Home Assistant is the name of the node in the setting.

<img src="https://github.com/vibr77/node-red-smart-scheduler/blob/main/doc/img/ha_ss.png?raw=true" width=450>

#### MQTT Topics

| Entities | Type |  Description  | topic  |
|:----------|:----------|:----------|:----------|
| Mode | Advertise | Execution Mode | [MQTT_PREFIX/select/[UniqueId]/mode/config ]|
| Mode | Set | Execution Mode | [MQTT_PREFIX/[UniqueId]/mode/set ]|
| Mode | State | Execution Mode | [MQTT_PREFIX/[UniqueId]/mode/state ]|
| Schedule List | Advertise | Dropdown list of schedules | [MQTT_PREFIX/select/[UniqueId]/schedule_list/config ]|
| Schedule List | Set | Dropdown list of schedules | [MQTT_PREFIX/[UniqueId]/schedule_list/set ]|
| Schedule List | State | Dropdown list of schedules | [MQTT_PREFIX/[UniqueId]/schedule_list/state ]|
| setpoint | Advertise | Current setpoint | [MQTT_PREFIX/sensor/[UniqueId]/current_sp/config ]|
| setpoint | Set | Current setpoint | [MQTT_PREFIX/[UniqueId]/current_sp/set ]|
| setpoint  | State | Current setpoint| [MQTT_PREFIX/[UniqueId]/current_sp/state ]|
| Previous setpoint | Advertise | Previous setpoint | [MQTT_PREFIX/sensor/[UniqueId]/previous_sp/config ]|
| Previous setpoint | Set | Previous setpoint | [MQTT_PREFIX/[UniqueId]/previous_sp/set ]|
| Previous setpoint  | State | Previous setpoint | [MQTT_PREFIX/[UniqueId]/previous_sp/state ]|
| Event name | Advertise | Current event name | [MQTT_PREFIX/sensor/[UniqueId]/current_event_name/config ]|
| Event name  | State | Current event name | [MQTT_PREFIX/[UniqueId]/current_event_name/state ]|
| Event start | Advertise | Current event start time | [MQTT_PREFIX/sensor/[UniqueId]/current_event_start/config ]|
| Event start  | State | Current event start time | [MQTT_PREFIX/[UniqueId]/current_event_start/state ]|
| Event end | Advertise | Current event end time | [MQTT_PREFIX/sensor/[UniqueId]/current_event_end/config ]|
| Event end  | State |Current event end time | [MQTT_PREFIX/[UniqueId]/current_event_end/state ]|

## State Persistence

The node automatically saves its complete state to the file system at `~/.node-red/.node-red-state/scheduler-{node-id}.json`. This includes:

*   **executionMode**: Current mode (auto/manual/off)
*   **overrideTs**: Override start timestamp
*   **overrideSp**: Override setpoint
*   **overrideDuration**: Override duration in minutes
*   **activScheduleId**: Currently active schedule ID
*   **activeSp**: Current active setpoint
*   **prevSp**: Previous setpoint
*   **activeRuleIdx**: Current active rule index
*   **prevRuleIdx**: Previous rule index
*   **timestamp**: Last save timestamp

This state is automatically restored when:
*   Node-RED restarts
*   Flows are redeployed
*   Node is reinitialized

The state file persists independently of Node-RED's context storage, ensuring the scheduler remembers its execution mode, active schedule, override settings, and current setpoints even after complete system restarts or redeployments. This prevents heating schedule disruptions and ensures seamless operation continuity.



If you like my work, please support me

i<a href="https://www.buymeacoffee.com/vincentbe" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>






