#!/usr/bin/env python3
"""Fake EMG from your keyboard. Run it, press a key, the Teensy 'flexes'.

    1 = flex 80      2 = flex 40 (small)      0 = relax      q = quit

Run in a terminal with the Teensy plugged in:
    python3 tools/key_emg.py
"""
import glob
import sys
import tty

import serial

# find the Teensy's serial port (first /dev/ttyACM*)
ports = sorted(glob.glob("/dev/ttyACM*"))
if not ports:
    sys.exit("no /dev/ttyACM* found - plug in the Teensy (or pass the port as an argument)")
port = sys.argv[1] if len(sys.argv) > 1 else ports[0]
ser = serial.Serial(port, 115200)
print(f"port {port}  ->  1=flex 80  2=flex 40  0=relax  q=quit")

KEYS = {"1": "f80", "2": "f40", "0": "f0"}
tty.setraw(sys.stdin.fileno())          # read each keypress without pressing Enter
try:
    while True:
        key = sys.stdin.read(1)
        if key == "q":
            break
        if key in KEYS:
            ser.write((KEYS[key] + "\n").encode())
            print(f"sent {KEYS[key]}")
finally:
    ser.write(b"f0\n")                 # never leave it flexing
    ser.close()
