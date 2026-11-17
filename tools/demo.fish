#!/usr/bin/env fish
# In-game smoke test (racing): wait, throttle 3 s, steer left 0.5 s, brake 1 s.
#
#   fish tools/demo.fish            # waits 10 s so you can switch to the game
#   fish tools/demo.fish 3          # custom delay in seconds
#   fish tools/demo.fish 10 /dev/ttyACM1

set delay 10
test (count $argv) -ge 1; and set delay $argv[1]
set port (ls /dev/ttyACM* 2>/dev/null)[1]
test (count $argv) -ge 2; and set port $argv[2]
if test -z "$port"
    echo "no /dev/ttyACM* found - plug in the Teensy"
    exit 1
end

function send
    echo $argv[1] >$port
end

echo "starting in $delay s - switch to the game"
sleep $delay

echo "throttle 3 s"
send r100
sleep 3
send r0

echo "steer left 0.5 s"
send x-100
sleep 0.5
send x0

echo "brake 1 s"
send l100
sleep 1
send l0

echo done
